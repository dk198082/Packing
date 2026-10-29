// Explicit Azure integration check; all fixtures are rolled back, never published.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getAzurePool, getAzureQualifiedTableName } from "@workspace/db/azure";
import { acknowledgePackingMessage, listPackingMessages } from "../src/lib/packing-messages";
import type { AuthenticatedUser } from "../src/lib/auth";

test("messages expire seven elapsed days after their first OK without deletion", async () => {
  // Initialize app-owned tables before routing this process's queries into a transaction.
  await listPackingMessages();
  const pool = getAzurePool();
  const client = await pool.connect();
  const originalQuery = pool.query;
  const messageTable = getAzureQualifiedTableName("packing_messages");
  const ackTable = getAzureQualifiedTableName("packing_message_acknowledgments");
  const ids = Array.from({ length: 5 }, () => randomUUID());
  const [unread, recent, boundary, old, multiple] = ids;
  const reader: AuthenticatedUser = {
    entraOid: "expiry-integration-reader",
    displayName: "Expiry integration reader",
    email: "expiry-test@example.invalid",
    role: "viewer",
  };
  try {
    await client.query("BEGIN");
    pool.query = client.query.bind(client) as typeof pool.query;
    for (const id of ids) {
      await client.query(`
        INSERT INTO ${messageTable} (id, content, author_id, author_name, created_at)
        VALUES ($1, 'Temporary expiry verification', 'expiry-test-author', 'Expiry test', NOW() - INTERVAL '30 days')
      `, [id]);
    }
    await client.query("SAVEPOINT message_length_check");
    await assert.rejects(client.query(`
      INSERT INTO ${messageTable} (id, content, author_id, author_name)
      VALUES ($1, $2, 'expiry-test-author', 'Expiry test')
    `, [randomUUID(), "x".repeat(201)]));
    await client.query("ROLLBACK TO SAVEPOINT message_length_check");
    for (const [id, hours] of [[recent, 167], [boundary, 168], [old, 169], [multiple, 169]] as const) {
      await client.query(`
        INSERT INTO ${ackTable} (message_id, user_id, display_name, acknowledged_at)
        VALUES ($1, 'first-reader', 'First reader', NOW() - $2 * INTERVAL '1 hour')
      `, [id, hours]);
    }
    await client.query(`
      INSERT INTO ${ackTable} (message_id, user_id, display_name)
      VALUES ($1, 'later-reader', 'Later reader')
    `, [multiple]);
    const visible = (await listPackingMessages()).filter(message => ids.includes(message.id));
    assert.deepEqual(visible.map(message => message.id).sort(), [unread, recent].sort());
    assert.equal(visible.find(message => message.id === unread)!.acknowledgments.length, 0);

    const author: AuthenticatedUser = {
      ...reader,
      entraOid: "expiry-test-author",
      displayName: "Expiry test",
      role: "editor",
    };
    await assert.rejects(acknowledgePackingMessage(unread, { ...author, role: "viewer" }), { status: 403 });
    const firstOk = await acknowledgePackingMessage(unread, author);
    assert.equal(firstOk.acknowledgments.length, 1);
    assert.equal(firstOk.acknowledgments[0].userId, firstOk.authorId);
    const repeatedOk = await acknowledgePackingMessage(unread, author);
    assert.deepEqual(repeatedOk.acknowledgments, firstOk.acknowledgments);

    const before = visible.find(message => message.id === recent)!.acknowledgments[0].acknowledgedAt;
    const anotherOk = await acknowledgePackingMessage(recent, reader);
    assert.equal(anotherOk.acknowledgments[0].acknowledgedAt, before);
    assert.equal(anotherOk.acknowledgments.length, 2);
    for (const id of [boundary, old, multiple]) {
      await assert.rejects(acknowledgePackingMessage(id, reader), { status: 404 });
    }
    const retained = await client.query(`SELECT id FROM ${messageTable} WHERE id = ANY($1::uuid[])`, [ids]);
    assert.equal(retained.rowCount, 5, "expiry must hide messages, not delete stored records");
  } finally {
    pool.query = originalQuery;
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
