import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import express, { type Request } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { SharedPackStatus } from "../src/lib/pack-statuses";
import type { getPackingOrders } from "../src/lib/packing-source";

let server: Server;
let base: string;
let available = true;
let checks = 0;
let writes = 0;
const statuses = new Map<string, SharedPackStatus>();

before(async () => {
  process.env.APP_BASE_URL ??= "https://packing.example.test";
  process.env.TENANT_ID ??= "test-tenant";
  process.env.CLIENT_ID ??= "test-client";
  process.env.CLIENT_SECRET ??= "test-secret";
  process.env.SESSION_SECRET ??= "test-session-secret";
  const { createAuthMiddleware } = await import("../src/middlewares/auth");
  const { createPackStatusRouter } = await import("../src/routes/pack-status");
  const auth = createAuthMiddleware({
    authorizeWithAdminConsole: async id => { checks++; return id === "editor" ? "editor" : "viewer"; },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("test-user");
    req.log = { error() {} } as unknown as Request["log"];
    req.session = {
      user: id ? { entraOid: id, displayName: id, email: "packed@example.invalid", role: "editor" } : undefined,
      authorizationCheckedAt: Date.now(),
      save(callback: () => void) { callback(); },
      destroy(callback: () => void) { callback(); },
    } as unknown as Request["session"];
    next();
  });
  app.use("/api", createPackStatusRouter({
    login: auth.requireLogin,
    editor: auth.requireRole("editor"),
    completer: auth.requireRole("editor", "viewer"),
    list: async () => [...statuses.values()],
    save: async (id, started, startOnly = false) => {
      const status = { orderId: id, packStartedAt: startOnly
        ? statuses.get(id)?.packStartedAt ?? started?.toISOString() ?? null
        : started?.toISOString() ?? null, packedAt: statuses.get(id)?.packedAt ?? null };
      statuses.set(id, status);
      return status;
    },
    orders: async () => {
      if (!available) throw new Error("offline");
      return {
        source: "salesorderheaderv3staging", fetchedAt: new Date().toISOString(), skippedRows: 0,
        orders: [{ id: "parts", team: "PARTS" }, { id: "system", team: "SYSTEM" }] as Awaited<ReturnType<typeof getPackingOrders>>["orders"],
      };
    },
    complete: async id => {
      writes++;
      const status = statuses.get(id) ?? { orderId: id, packStartedAt: null, packedAt: null };
      status.packedAt ??= new Date().toISOString();
      statuses.set(id, status);
      return status;
    },
    editPacked: async (id, packedAt) => {
      writes++;
      const status = statuses.get(id) ?? { orderId: id, packStartedAt: null, packedAt: null };
      status.packedAt = packedAt?.toISOString() ?? null;
      statuses.set(id, status);
      return status;
    },
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

function request(path: string, method: string, user?: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { "test-user": user } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test("packing writes require login and viewers cannot reset an existing start", async () => {
  assert.equal((await request("/pack-status/parts/packed", "POST", undefined, { trigger: "label" })).status, 401);
  assert.equal((await request("/pack-status/system", "PUT", undefined, { packStartedAt: new Date().toISOString() })).status, 401);
  const before = checks;
  assert.equal((await request("/pack-status/system", "PUT", "reader", { packStartedAt: null })).status, 403);
  assert.ok(checks > before, "cached access must be freshly rechecked");
  assert.equal(writes, 0);
});

test("only PARTS label events and SYSTEM manual finishes are accepted for live orders", async () => {
  for (const [id, trigger] of [["parts", "manual"], ["system", "label"], ["parts", "unknown"]]) {
    assert.equal((await request(`/pack-status/${id}/packed`, "POST", "editor", { trigger })).status, 400);
  }
  assert.equal((await request("/pack-status/parts/packed", "POST", "editor", {})).status, 400);
  assert.equal((await request("/pack-status/missing/packed", "POST", "editor", { trigger: "label" })).status, 404);
  assert.equal(writes, 0);
});

test("Parts printing and System Finish Pack persist a server timestamp without altering Start Pack", async () => {
  const beforeChecks = checks;
  const started = await request("/pack-status/system", "PUT", "reader", { packStartedAt: "2000-01-01T10:00:00.000Z" });
  assert.equal(started.status, 200, "Read users can Start Pack");
  const start = (await started.json()).packStartedAt;
  assert.ok(Date.now() - Date.parse(start) < 10_000, "Read start time comes from server");
  const repeatedStart = await request("/pack-status/system", "PUT", "reader", { packStartedAt: "2025-01-01T10:00:00.000Z" });
  assert.equal((await repeatedStart.json()).packStartedAt, start, "Read users cannot replace the original start time");
  for (const [id, trigger] of [["parts", "label"], ["system", "manual"]]) {
    const response = await request(`/pack-status/${id}/packed`, "POST", "reader", { trigger, packedAt: "2000-01-01" });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.ok(Date.now() - Date.parse(result.packedAt) < 10_000);
    assert.equal(result.packStartedAt, id === "system" ? start : null);
    const repeat = await (await request(`/pack-status/${id}/packed`, "POST", "editor", { trigger })).json();
    assert.equal(repeat.packedAt, result.packedAt, "reprint/repeated finish preserves first completion");
  }
  assert.ok(checks >= beforeChecks + 6, "Start, Finish, and label writes all reauthorize access");
  const savedPacked = statuses.get("system")!.packedAt;
  await request("/pack-status/system", "PUT", "editor", { packStartedAt: null });
  assert.equal(statuses.get("system")!.packedAt, savedPacked, "Start Pack editing must not clear PACKED");
  const list = await request("/pack-status", "GET", "editor");
  assert.equal(list.headers.get("cache-control"), "no-store");
  assert.equal((await list.json()).statuses.length, 2);
});

test("source outage fails explicitly without saving PACKED", async () => {
  const before = writes;
  available = false;
  assert.equal((await request("/pack-status/parts/packed", "POST", "editor", { trigger: "label" })).status, 503);
  assert.equal(writes, before);
  available = true;
});

test("packed corrections require authentication, valid timestamps, and a current board order", async () => {
  const before = writes;
  assert.equal((await request("/pack-status/parts/packed", "PUT", undefined, { packedAt: null })).status, 401);
  for (const body of [{}, { packedAt: "" }, { packedAt: "not-a-date" }, { packedAt: 123 }, { packedAt: "2026-15-45T12:00:00Z" }]) {
    assert.equal((await request("/pack-status/parts/packed", "PUT", "reader", body)).status, 400);
  }
  assert.equal((await request("/pack-status/missing/packed", "PUT", "reader", { packedAt: null })).status, 404);
  assert.equal(writes, before);
});

test("Read and Read/Write users can edit and clear shared PACKED on both tabs without changing Start Pack", async () => {
  for (const id of ["parts", "system"]) {
    for (const user of ["reader", "editor"]) {
      const startBefore = statuses.get(id)!.packStartedAt;
      const beforeChecks = checks;
      const response = await request(`/pack-status/${id}/packed`, "PUT", user, { packedAt: "2026-01-02T09:30:00-05:00" });
      assert.equal(response.status, 200);
      const edited = await response.json();
      assert.equal(edited.packedAt, "2026-01-02T14:30:00.000Z");
      assert.equal(edited.packStartedAt, startBefore);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const list = await (await request("/pack-status", "GET", user)).json();
      assert.equal(list.statuses.find((status: SharedPackStatus) => status.orderId === id).packedAt, edited.packedAt);
      const clearedResponse = await request(`/pack-status/${id}/packed`, "PUT", user, { packedAt: null });
      assert.equal(clearedResponse.status, 200);
      const cleared = await clearedResponse.json();
      assert.equal(cleared.packedAt, null);
      assert.equal(cleared.packStartedAt, startBefore);
      assert.ok(checks >= beforeChecks + 2, "both editing and clearing must freshly authorize access");
      const newFinish = await (await request(`/pack-status/${id}/packed`, "POST", user, { trigger: id === "parts" ? "label" : "manual" })).json();
      assert.ok(Date.now() - Date.parse(newFinish.packedAt) < 10_000);
    }
  }
});

test("packed correction outage does not report success or change stored timestamps", async () => {
  const before = writes;
  const previous = structuredClone(statuses.get("parts"));
  available = false;
  try {
    assert.equal((await request("/pack-status/parts/packed", "PUT", "reader", { packedAt: null })).status, 503);
    assert.equal(writes, before);
    assert.deepEqual(statuses.get("parts"), previous);
  } finally {
    available = true;
  }
});
