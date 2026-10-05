import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAutomaticSystemOrderPriorities } from "../src/lib/system-order-priorities";

function order(salesOrder: string, confirmedShipDate: string, team = "SYSTEM") {
  return { id: salesOrder, salesOrder, confirmedShipDate, team };
}

describe("automatic System Top 5 priorities", () => {
  const queue = [
    order("SO-30", "2026-10-05"),
    order("SO-10", "2026-10-02"),
    order("SO-2", "2026-10-02"),
    order("SO-20", "2026-10-03"),
    order("SO-40", "2026-10-06"),
    order("SO-50", "2026-10-07"),
    order("PARTS-1", "2026-10-01", "PARTS"),
  ];

  it("sorts by Ship Date then numeric Sales Order and assigns only System Top 5", () => {
    assert.deepEqual([...getAutomaticSystemOrderPriorities(queue)], [
      ["SO-2", 1], ["SO-10", 2], ["SO-20", 3], ["SO-30", 4], ["SO-40", 5],
    ]);
  });

  it("resets contiguous priorities and promotes the next order when a Top 5 order leaves", () => {
    assert.deepEqual([...getAutomaticSystemOrderPriorities(queue.filter(o => o.id !== "SO-10"))], [
      ["SO-2", 1], ["SO-20", 2], ["SO-30", 3], ["SO-40", 4], ["SO-50", 5],
    ]);
  });

  it("reranks arrivals and Ship Date changes rather than preserving manual ranks", () => {
    const earlier = { ...order("SO-50", "2026-10-01"), priority: 99 };
    const changed = queue.map(o => o.id === earlier.id ? earlier : { ...o, priority: 1 });
    assert.deepEqual([...getAutomaticSystemOrderPriorities(changed)], [
      ["SO-50", 1], ["SO-2", 2], ["SO-10", 3], ["SO-20", 4], ["SO-30", 5],
    ]);
  });

  it("handles fewer than five orders and an empty queue", () => {
    assert.deepEqual([...getAutomaticSystemOrderPriorities(queue.slice(0, 2))], [
      ["SO-10", 1], ["SO-30", 2],
    ]);
    assert.equal(getAutomaticSystemOrderPriorities([]).size, 0);
  });

  it("does not mutate the source queue and is independent of source ordering", () => {
    const original = queue.map(o => ({ ...o }));
    assert.deepEqual([...getAutomaticSystemOrderPriorities([...queue].reverse())],
      [...getAutomaticSystemOrderPriorities(queue)]);
    assert.deepEqual(queue, original);
  });

  it("retains the existing missing-date ordering policy", () => {
    assert.deepEqual([...getAutomaticSystemOrderPriorities([
      order("SO-3", ""), order("SO-2", "2026-10-03"), order("SO-1", "1900-01-01"),
    ])], [["SO-1", 1], ["SO-2", 2], ["SO-3", 3]]);
  });
});