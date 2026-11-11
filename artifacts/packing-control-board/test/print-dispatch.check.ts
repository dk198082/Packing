import assert from "node:assert/strict";
import { test } from "node:test";
import { printDymo30336Labels } from "../src/lib/print-label";
import type { Order } from "../src/lib/types";

const order = { salesOrder: "PRINT-TEST", customer: "Test packing", isRetailOrder: false } as Order;
const boxes = [{ boxNumber: "BOX-1", weightLbs: "1", dimensions: { length: "", width: "", height: "" } }];
const picks = ["IPR091555"];

test("label print succeeds only after print dispatch, and failures cannot trigger PACKED", async () => {
  const original = globalThis.window;
  let printed = 0;
  let fail = false;
  let blocked = false;
  let schedule: (() => void) | undefined;
  const popup = {
    closed: false,
    document: { open() {}, write() {}, close() {}, fonts: { ready: Promise.resolve() } },
    focus() {},
    print() { if (fail) throw new Error("Printer unavailable"); printed++; },
    close() {},
    requestAnimationFrame(callback: () => void) { schedule = callback; },
    setTimeout(callback: () => void) { callback(); },
  };
  globalThis.window = { open: () => blocked ? null : popup } as unknown as Window & typeof globalThis;
  try {
    let settled = false;
    const pending = printDymo30336Labels(order, picks, boxes).then(result => { settled = true; return result; });
    // Wait for QR generation and scheduled rendering, not a real browser/printer.
    for (let i = 0; i < 100 && !schedule; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(schedule);
    assert.equal(settled, false, "generating QR alone must not report print success");
    assert.equal(printed, 0);
    schedule!();
    assert.deepEqual(await pending, { ok: true });
    assert.equal(printed, 1);

    blocked = true;
    assert.deepEqual(await printDymo30336Labels(order, picks, boxes), { ok: false, reason: "POPUP_BLOCKED" });
    blocked = false;
    assert.deepEqual(await printDymo30336Labels(order, ["IPR"], boxes), { ok: false, reason: "NO_PICK_IDS" });
    assert.deepEqual(await printDymo30336Labels(order, picks, []), { ok: false, reason: "NO_BOXES" });
    assert.equal(printed, 1);

    fail = true;
    schedule = undefined;
    const failed = printDymo30336Labels(order, picks, boxes);
    for (let i = 0; i < 100 && !schedule; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(schedule);
    schedule!();
    assert.deepEqual(await failed, { ok: false, reason: "PRINT_ERROR" });
    assert.equal(printed, 1);
  } finally {
    globalThis.window = original;
  }
});
