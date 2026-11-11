// Rollback-only checks against the app-owned Azure table; no ERP writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { getAzurePool, getAzureQualifiedTableName } from "@workspace/db/azure";
import { getSharedPackStatuses, saveSharedPackStatus, markSharedOrderPacked, editSharedOrderPacked } from "../src/lib/pack-statuses";

test("PACKED is shared, server-timed, idempotent, and independent of Start Pack", async () => {
  await getSharedPackStatuses(); // Initialize completion column before test transaction.
  const pool = getAzurePool();
  const client = await pool.connect();
  const query = pool.query;
  const ids = [randomUUID(), randomUUID()];
  try {
    await client.query("BEGIN");
    pool.query = client.query.bind(client) as typeof pool.query;
    const start = new Date("2026-01-01T10:00:00.000Z");
    await saveSharedPackStatus(ids[1], start, true);
    const repeatedStart = await saveSharedPackStatus(ids[1], new Date(), true);
    assert.equal(repeatedStart.packStartedAt, start.toISOString(), "viewer Start Pack must atomically preserve an existing start");
    for (const id of ids) {
      const completed = await markSharedOrderPacked(id);
      assert.ok(completed.packedAt);
      assert.ok(Date.now() - Date.parse(completed.packedAt!) < 10_000);
      assert.equal(completed.packStartedAt, id === ids[1] ? start.toISOString() : null);
      const repeat = await markSharedOrderPacked(id);
      assert.equal(repeat.packedAt, completed.packedAt);
      const edited = await saveSharedPackStatus(id, null);
      assert.equal(edited.packedAt, completed.packedAt, "editing/resetting start must not clear completion");
    }
    // Verify a later reprint cannot overwrite an earlier completion.
    const earlier = new Date("2025-12-31T12:00:00.000Z");
    await client.query(`UPDATE ${getAzureQualifiedTableName("pack_statuses")} SET packed_at = $2 WHERE order_id = $1`, [ids[0], earlier]);
    const [repeatA, repeatB] = await Promise.all([markSharedOrderPacked(ids[0]), markSharedOrderPacked(ids[0])]);
    assert.equal(repeatA.packedAt, earlier.toISOString());
    assert.equal(repeatB.packedAt, earlier.toISOString());
    const visible = (await getSharedPackStatuses()).filter(status => ids.includes(status.orderId));
    assert.equal(visible.length, 2);
    assert.ok(visible.every(status => status.packedAt !== null));
    await saveSharedPackStatus(ids[1], start);
    for (const id of ids) {
      const edited = await editSharedOrderPacked(id, earlier);
      assert.equal(edited.packedAt, earlier.toISOString());
      assert.equal(edited.packStartedAt, id === ids[1] ? start.toISOString() : null);
      assert.equal((await markSharedOrderPacked(id)).packedAt, earlier.toISOString(), "reprints preserve corrected time");
      const cleared = await editSharedOrderPacked(id, null);
      assert.equal(cleared.packedAt, null);
      assert.equal(cleared.packStartedAt, edited.packStartedAt, "clearing completion must preserve Start Pack");
      const stored = (await getSharedPackStatuses()).find(status => status.orderId === id)!;
      assert.equal(stored.packedAt, null, "clear persists across shared reads");
      assert.equal((await editSharedOrderPacked(id, null)).packedAt, null, "clear is idempotent");
      const finishedAgain = await markSharedOrderPacked(id);
      assert.ok(Date.now() - Date.parse(finishedAgain.packedAt!) < 10_000, "finishing again after clear records a fresh timestamp");
    }
  } finally {
    pool.query = query;
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
