// Rollback-only Azure integration: privacy, receipts, directory and expiry.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getAzurePool, getAzureQualifiedTableName } from "@workspace/db/azure";
import {
  acknowledgePackingMessage, listPackingMessages, resetPackingMessage, removePackingMessage,
  createPackingMessage, rememberMessageUser, getKnownMessageUsers,
} from "../src/lib/packing-messages";
import type { AuthenticatedUser } from "../src/lib/auth";

test("direct messages stay private, record recipient receipts, and retain seven-day expiry without deletion", async () => {
  const unique = randomUUID();
  const reader: AuthenticatedUser = {
    entraOid: `message-reader-${unique}`, displayName: "Integration recipient",
    email: "message-reader@example.invalid", role: "viewer",
  };
  const author: AuthenticatedUser = {
    ...reader, entraOid: `message-author-${unique}`, displayName: "Integration sender", role: "editor",
  };
  const outsider: AuthenticatedUser = { ...author, entraOid: `message-outsider-${unique}` };
  await listPackingMessages(reader); // Initialize schema before rollback-only fixture transaction.
  const pool = getAzurePool();
  const client = await pool.connect();
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const messageTable = getAzureQualifiedTableName("packing_messages");
  const ackTable = getAzureQualifiedTableName("packing_message_acknowledgments");
  const ids = Array.from({ length: 7 }, () => randomUUID());
  const [unread, recent, boundary, old, multiple, legacy, unrelated] = ids;
  try {
    await client.query("BEGIN");
    pool.query = client.query.bind(client) as typeof pool.query;
    pool.connect = (async () => ({
      query: (sql: string, values?: unknown[]) => client.query(
        sql === "BEGIN" ? "SAVEPOINT message_action" :
        sql === "COMMIT" ? "RELEASE SAVEPOINT message_action" :
        sql === "ROLLBACK" ? "ROLLBACK TO SAVEPOINT message_action" : sql, values,
      ),
      release() {},
    })) as typeof pool.connect;
    await rememberMessageUser(author);
    await rememberMessageUser(reader);
    await rememberMessageUser({ ...reader, displayName: "Updated recipient name" });
    const known = (await getKnownMessageUsers()).filter(user => [author.entraOid, reader.entraOid].includes(user.userId));
    assert.equal(known.length, 2);
    assert.equal(known.find(user => user.userId === reader.entraOid)!.displayName, "Updated recipient name");
    for (const id of ids) {
      await client.query(`
        INSERT INTO ${messageTable} (id, content, author_id, author_name, recipient_id, recipient_name, created_at)
        VALUES ($1, 'Temporary message verification', $2, 'Integration sender', $3, $4, NOW() - INTERVAL '30 days')
      `, [
        id, id === unrelated ? outsider.entraOid : author.entraOid,
        id === legacy ? null : id === unrelated ? outsider.entraOid : reader.entraOid,
        id === legacy ? null : "Integration recipient",
      ]);
    }
    await client.query("SAVEPOINT message_length_check");
    await assert.rejects(client.query(`
      INSERT INTO ${messageTable} (id, content, author_id, author_name)
      VALUES ($1, $2, 'integration', 'Integration')
    `, [randomUUID(), "x".repeat(201)]));
    await client.query("ROLLBACK TO SAVEPOINT message_length_check");
    for (const [id, hours] of [[recent, 167], [boundary, 168], [old, 169], [multiple, 169]] as const) {
      await client.query(`
        INSERT INTO ${ackTable} (message_id, user_id, display_name, acknowledged_at)
        VALUES ($1, $2, 'Integration recipient', NOW() - $3 * INTERVAL '1 hour')
      `, [id, reader.entraOid, hours]);
    }
    await client.query(`INSERT INTO ${ackTable} (message_id, user_id, display_name) VALUES ($1, 'later-reader', 'Later reader')`, [multiple]);
    const visible = (await listPackingMessages(reader)).filter(message => ids.includes(message.id));
    assert.deepEqual(visible.map(message => message.id).sort(), [unread, recent].sort());
    const senderVisible = (await listPackingMessages(author)).filter(message => ids.includes(message.id));
    assert.deepEqual(senderVisible.map(message => message.id).sort(), [unread, recent, legacy].sort());
    assert.equal((await listPackingMessages(outsider)).filter(message => ids.includes(message.id)).length, 1);

    await assert.rejects(acknowledgePackingMessage(unread, author), { status: 403 }, "sender cannot self-confirm");
    for (const action of [acknowledgePackingMessage, resetPackingMessage, removePackingMessage]) {
      await assert.rejects(action(unread, outsider), { status: 404 }, "unrelated editor cannot act on guessed IDs");
    }
    const firstOk = await acknowledgePackingMessage(unread, reader);
    assert.equal(firstOk.acknowledgments[0].userId, reader.entraOid);
    assert.equal(firstOk.acknowledgments[0].displayName, reader.displayName);
    assert.deepEqual((await acknowledgePackingMessage(unread, reader)).acknowledgments, firstOk.acknowledgments);
    const receipt = (await listPackingMessages(author)).find(message => message.id === unread)!;
    assert.deepEqual(receipt.acknowledgments, firstOk.acknowledgments);
    const before = visible.find(message => message.id === recent)!.acknowledgments[0].acknowledgedAt;
    assert.equal((await acknowledgePackingMessage(recent, reader)).acknowledgments[0].acknowledgedAt, before);
    for (const id of [boundary, old, multiple]) {
      for (const action of [acknowledgePackingMessage, resetPackingMessage, removePackingMessage]) {
        await assert.rejects(action(id, author), { status: 404 });
      }
    }
    await assert.rejects(resetPackingMessage(recent, reader), { status: 403 });
    await assert.rejects(removePackingMessage(recent, reader), { status: 403 });
    assert.deepEqual((await resetPackingMessage(recent, author)).acknowledgments, []);
    await assert.rejects(removePackingMessage(recent, author), { status: 409 });
    const newOk = await acknowledgePackingMessage(recent, reader);
    assert.ok(Date.now() - Date.parse(newOk.acknowledgments[0].acknowledgedAt) < 10_000);
    await removePackingMessage(recent, author);
    assert.ok(!(await listPackingMessages(reader)).some(message => message.id === recent));
    assert.ok(!(await listPackingMessages(author)).some(message => message.id === recent));
    await assert.rejects(acknowledgePackingMessage(recent, reader), { status: 404 });

    const created = await createPackingMessage("Private integration message", reader.entraOid, author);
    assert.equal(created.recipientId, reader.entraOid);
    assert.equal(created.recipientName, "Updated recipient name", "recipient identity must be server-owned");
    assert.ok((await listPackingMessages(reader)).some(message => message.id === created.id));
    assert.ok(!(await listPackingMessages(outsider)).some(message => message.id === created.id));
    await assert.rejects(createPackingMessage("No self", author.entraOid, author), { status: 400 });
    await assert.rejects(createPackingMessage("No unknown", "unknown-integration-user", author), { status: 400 });
    const retained = await client.query(`SELECT id FROM ${messageTable} WHERE id = ANY($1::uuid[])`, [ids]);
    assert.equal(retained.rowCount, 7, "expiry and removal hide records, not delete stored content");
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
