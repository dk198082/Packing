import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import express, { type Request } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { PackingMessage } from "../src/lib/packing-messages";

let server: Server;
let baseUrl: string;
let messages: PackingMessage[] = [];
let available = true;
let authorizationChecks = 0;
const messageId = "79c50cab-c808-4327-a6ab-4589208fd682";

before(async () => {
  process.env.APP_BASE_URL ??= "https://packing.example.test";
  process.env.TENANT_ID ??= "test-tenant";
  process.env.CLIENT_ID ??= "test-client";
  process.env.CLIENT_SECRET ??= "test-secret";
  process.env.SESSION_SECRET ??= "test-session-secret";
  // Importing middlewares/auth also defines `sessionMiddleware` at module
  // scope, which eagerly calls getAzurePool() (lib/db/src/azure.ts) as a
  // side effect of evaluating the module — not lazily, on first request.
  // These fake values only need to satisfy that constructor; no real
  // connection is attempted in this test file, since dependencies.list/
  // create/acknowledge are injected fakes, not the real DB-backed ones.
  process.env.AZURE_PG_HOST ??= "localhost";
  process.env.AZURE_PG_PORT ??= "5432";
  process.env.AZURE_PG_DATABASE ??= "test-db";
  process.env.AZURE_PG_SP_USER ??= "test-user";
  process.env.AZURE_PG_PASSWORD ??= "test-password";
  process.env.AZURE_PG_SCHEMA ??= "test_schema";
  const { createAuthMiddleware } = await import("../src/middlewares/auth");
  const { createPackingMessagesRouter } = await import("../src/routes/packing-messages");
  const { MessageBoardError } = await import("../src/lib/packing-messages");
  const middleware = createAuthMiddleware({
    authorizeWithAdminConsole: async (id) => {
      authorizationChecks++;
      return id === "author" ? "editor" : "viewer";
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("test-user");
    req.log = { error() {}, warn() {} } as unknown as Request["log"];
    req.session = {
      user: id ? {
        entraOid: id,
        displayName: id === "author" ? "Test Author" : "Test Reader",
        email: "test@example.invalid",
        role: req.header("test-role") || (id === "author" ? "editor" : "viewer"),
      } : undefined,
      authorizationCheckedAt: Date.now(),
      save(callback: () => void) { callback(); },
      destroy(callback: () => void) { callback(); },
    } as unknown as Request["session"];
    next();
  });
  app.use("/api", createPackingMessagesRouter({
    login: middleware.requireLogin,
    editor: middleware.requireRole("editor"),
    acknowledger: middleware.requireRole("editor", "viewer"),
    list: async () => {
      if (!available) throw new Error("offline");
      return messages;
    },
    create: async (content, user) => {
      if (!available) throw new Error("offline");
      const message = {
        id: messageId, content, authorId: user.entraOid, authorName: user.displayName,
        createdAt: new Date().toISOString(), acknowledgments: [],
      };
      messages = [message, ...messages];
      return message;
    },
    acknowledge: async (id, user) => {
      if (!available) throw new Error("offline");
      const message = messages.find((item) => item.id === id);
      if (!message) throw new MessageBoardError(404, "Message not found.");
      if (message.authorId === user.entraOid && user.role !== "editor") {
        throw new MessageBoardError(403, "Read/Write access is required to OK your own message.");
      }
      if (!message.acknowledgments.some((ack) => ack.userId === user.entraOid)) {
        message.acknowledgments.push({
          userId: user.entraOid, displayName: user.displayName, acknowledgedAt: new Date().toISOString(),
        });
      }
      return message;
    },
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(() => new Promise<void>((resolve, reject) => {
  server?.close((error) => error ? reject(error) : resolve());
}));

async function request(path: string, method = "GET", user?: string, body?: unknown, role?: string) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "test-user": user } : {}),
      ...(role ? { "test-role": role } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("shared packing messages API", () => {
  it("requires authentication for listing, posting, and OK", async () => {
    for (const [path, method] of [
      ["/messages", "GET"], ["/messages", "POST"],
      [`/messages/${messageId}/acknowledgments`, "POST"],
    ]) assert.equal((await request(path, method)).status, 401);
  });

  it("allows viewers to read but rejects posting, including a stale editor role", async () => {
    assert.equal((await request("/messages", "GET", "reader")).status, 200);
    const before = authorizationChecks;
    assert.equal((await request("/messages", "POST", "reader", { content: "denied" }, "editor")).status, 403);
    assert.ok(authorizationChecks > before);
    assert.equal(messages.length, 0);
  });

  it("validates empty, whitespace, and overlong messages", async () => {
    for (const content of ["", " \n ", "a".repeat(201)]) {
      assert.equal((await request("/messages", "POST", "author", { content })).status, 400);
    }
  });

  it("saves trimmed plain text with session author, server time, ignoring spoofed fields", async () => {
    const response = await request("/messages", "POST", "author", {
      content: "  Check packing station\nbefore shipment.  ",
      authorId: "spoofed", authorName: "Spoofed", createdAt: "2000-01-01",
    });
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.equal(result.content, "Check packing station\nbefore shipment.");
    assert.equal(result.authorId, "author");
    assert.equal(result.authorName, "Test Author");
    assert.ok(Date.now() - Date.parse(result.createdAt) < 10_000);
    assert.deepEqual(result.acknowledgments, []);

    const exactLimit = await request("/messages", "POST", "author", { content: "x".repeat(200) });
    assert.equal(exactLimit.status, 201);
    messages = [result];
  });

  it("rejects invalid or nonexistent message IDs", async () => {
    assert.equal((await request("/messages/invalid/acknowledgments", "POST", "reader")).status, 400);
    assert.equal((await request("/messages/00000000-0000-4000-8000-000000000000/acknowledgments", "POST", "reader")).status, 404);
  });

  it("lets a viewer OK another user's message once and returns it on subsequent reads", async () => {
    const before = authorizationChecks;
    const first = await request(`/messages/${messageId}/acknowledgments`, "POST", "reader");
    assert.equal(first.status, 200);
    const result = await first.json();
    const repeated = await (await request(`/messages/${messageId}/acknowledgments`, "POST", "reader")).json();
    assert.deepEqual(repeated.acknowledgments, result.acknowledgments);
    assert.equal(result.acknowledgments.length, 1);
    assert.equal(result.acknowledgments[0].displayName, "Test Reader");
    assert.ok(authorizationChecks >= before + 2);
    const list = await request("/messages", "GET", "author");
    assert.equal(list.headers.get("cache-control"), "no-store");
    assert.deepEqual((await list.json()).messages[0], result);
  });

  it("lets Read/Write users OK their own message once without changing earlier OKs", async () => {
    const earlierOks = structuredClone(messages[0].acknowledgments);
    const response = await request(`/messages/${messageId}/acknowledgments`, "POST", "author");
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.acknowledgments.slice(0, earlierOks.length), earlierOks);
    assert.equal(result.acknowledgments.length, 2);
    assert.equal(result.acknowledgments[1].userId, "author");
    assert.equal(result.acknowledgments[1].displayName, "Test Author");
    const repeated = await (await request(`/messages/${messageId}/acknowledgments`, "POST", "author")).json();
    assert.deepEqual(repeated.acknowledgments, result.acknowledgments);
  });

  it("no longer exposes archive or history endpoints", async () => {
    for (const user of ["author", "reader"]) {
      assert.equal((await request("/messages/history", "GET", user)).status, 404);
      assert.equal((await request(`/messages/${messageId}/archive`, "POST", user)).status, 404);
    }
    assert.equal(messages.length, 1);
  });

  it("fails explicitly on storage outage without reporting a successful save or OK", async () => {
    available = false;
    try {
      assert.equal((await request("/messages", "GET", "reader")).status, 503);
      assert.equal((await request("/messages", "POST", "author", { content: "Not saved" })).status, 503);
      assert.equal((await request(`/messages/${messageId}/acknowledgments`, "POST", "reader")).status, 503);
      assert.equal(messages.length, 1);
    } finally {
      available = true;
    }
  });
});
