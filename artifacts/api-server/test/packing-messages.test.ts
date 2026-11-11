import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import express, { type Request } from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { MessageRecipient, PackingMessage } from "../src/lib/packing-messages";

let server: Server;
let baseUrl: string;
let messages: PackingMessage[] = [];
let available = true;
let recipientAccessAvailable = true;
let authorizationChecks = 0;
let recipientChecks = 0;
let users: MessageRecipient[] = [];
const messageId = "79c50cab-c808-4327-a6ab-4589208fd682";

before(async () => {
  process.env.APP_BASE_URL ??= "https://packing.example.test";
  process.env.TENANT_ID ??= "test-tenant";
  process.env.CLIENT_ID ??= "test-client";
  process.env.CLIENT_SECRET ??= "test-secret";
  process.env.SESSION_SECRET ??= "test-session-secret";
  const { createAuthMiddleware } = await import("../src/middlewares/auth");
  const { createPackingMessagesRouter } = await import("../src/routes/packing-messages");
  const { MessageBoardError } = await import("../src/lib/packing-messages");
  const { AccessDeniedError, AuthorizationServiceError } = await import("../src/lib/auth");
  const auth = createAuthMiddleware({
    authorizeWithAdminConsole: async id => {
      authorizationChecks++;
      if (id === "revoked") throw new AccessDeniedError("Revoked");
      return id === "author" || id === "editor-recipient" ? "editor" : "viewer";
    },
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const id = req.header("test-user");
    req.log = { error() {}, warn() {} } as unknown as Request["log"];
    req.session = {
      user: id ? {
        entraOid: id, displayName: `Test ${id}`, email: `${id}@example.invalid`,
        role: req.header("test-role") || (id === "author" || id === "editor-recipient" ? "editor" : "viewer"),
      } : undefined,
      authorizationCheckedAt: Date.now(),
      save(callback: () => void) { callback(); },
      destroy(callback: () => void) { callback(); },
    } as unknown as Request["session"];
    next();
  });
  function visible(id: string, userId: string) {
    if (!available) throw new Error("offline");
    const message = messages.find(item => item.id === id && (item.authorId === userId || item.recipientId === userId));
    if (!message) throw new MessageBoardError(404, "Message not found.");
    return message;
  }
  app.use("/api", createPackingMessagesRouter({
    login: auth.requireLogin, editor: auth.requireRole("editor"),
    acknowledger: auth.requireRole("editor", "viewer"),
    remember: async user => {
      if (!available) throw new Error("offline");
      if (!users.some(item => item.userId === user.entraOid)) {
        users.push({ userId: user.entraOid, displayName: user.displayName, email: user.email });
      }
    },
    users: async () => {
      if (!available) throw new Error("offline");
      return users;
    },
    authorizeRecipient: async id => {
      recipientChecks++;
      if (!recipientAccessAvailable) throw new AuthorizationServiceError();
      if (id === "revoked") throw new AccessDeniedError("Revoked");
      return id === "editor-recipient" ? "editor" : "viewer";
    },
    list: async user => {
      if (!available) throw new Error("offline");
      return messages.filter(item => item.authorId === user.entraOid || item.recipientId === user.entraOid);
    },
    create: async (content, recipientId, user) => {
      if (!available) throw new Error("offline");
      const recipient = users.find(item => item.userId === recipientId)!;
      const message: PackingMessage = {
        id: messageId, content, authorId: user.entraOid, authorName: user.displayName,
        recipientId, recipientName: recipient.displayName,
        createdAt: new Date().toISOString(), acknowledgments: [],
      };
      messages = [message];
      return message;
    },
    acknowledge: async (id, user) => {
      const message = visible(id, user.entraOid);
      if (message.recipientId !== user.entraOid && !(message.recipientId === null && user.role === "editor")) {
        throw new MessageBoardError(403, "Only the recipient may OK.");
      }
      if (!message.acknowledgments.some(ack => ack.userId === user.entraOid)) {
        message.acknowledgments.push({ userId: user.entraOid, displayName: user.displayName, acknowledgedAt: new Date().toISOString() });
      }
      return message;
    },
    reset: async (id, user) => {
      const message = visible(id, user.entraOid);
      if (!message.acknowledgments.length) throw new MessageBoardError(409, "Message is not DONE.");
      message.acknowledgments = [];
      return message;
    },
    remove: async (id, user) => {
      const message = visible(id, user.entraOid);
      if (!message.acknowledgments.length) throw new MessageBoardError(409, "Message is not DONE.");
      messages = messages.filter(item => item.id !== id);
    },
  }));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

beforeEach(() => {
  messages = [];
  available = recipientAccessAvailable = true;
  users = ["author", "reader", "editor-recipient", "revoked"].map(id => ({
    userId: id, displayName: `Test ${id}`, email: `${id}@example.invalid`,
  }));
});
after(() => new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve())));

async function request(path: string, method = "GET", user?: string, body?: unknown, role?: string) {
  return fetch(`${baseUrl}${path}`, {
    method, headers: {
      "Content-Type": "application/json", ...(user ? { "test-user": user } : {}), ...(role ? { "test-role": role } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function send(recipientId = "reader") {
  const response = await request("/messages", "POST", "author", { content: "Check packing station.", recipientId });
  assert.equal(response.status, 201);
  return response.json();
}

test("requires login for every message read, recipient directory, and write", async () => {
  for (const [path, method] of [
    ["/messages", "GET"], ["/messages", "POST"], ["/messages/recipients", "GET"],
    [`/messages/${messageId}/acknowledgments`, "POST"],
    [`/messages/${messageId}/acknowledgments`, "DELETE"], [`/messages/${messageId}`, "DELETE"],
  ]) assert.equal((await request(path, method)).status, 401);
});

test("viewer can read and gets registered, but cannot send or list recipients despite stale editor role", async () => {
  await request("/messages", "GET", "new-reader");
  assert.ok(users.some(user => user.userId === "new-reader"));
  const before = authorizationChecks;
  assert.equal((await request("/messages", "POST", "reader", { content: "denied", recipientId: "author" }, "editor")).status, 403);
  assert.equal((await request("/messages/recipients", "GET", "reader", undefined, "editor")).status, 403);
  assert.ok(authorizationChecks >= before + 2);
  assert.equal(messages.length, 0);
});

test("recipients include known authorized accounts only, excluding sender and revoked users", async () => {
  const result = await request("/messages/recipients", "GET", "author");
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual((await result.json()).recipients.map((user: MessageRecipient) => user.userId), ["reader", "editor-recipient"]);
});

test("validates content, required recipient, self-send, and unknown or revoked recipients", async () => {
  for (const content of ["", " \n ", "a".repeat(201)]) {
    assert.equal((await request("/messages", "POST", "author", { content, recipientId: "reader" })).status, 400);
  }
  for (const recipientId of [undefined, "", "author", "unknown", "revoked"]) {
    assert.equal((await request("/messages", "POST", "author", { content: "Test", recipientId })).status, 400);
  }
  assert.equal(messages.length, 0);
});

test("saves trimmed 200-character content with server/session identity, recipient name, and timestamp", async () => {
  const before = recipientChecks;
  const response = await request("/messages", "POST", "author", {
    content: `  ${"x".repeat(196)}  `, recipientId: "reader",
    authorId: "spoof", authorName: "spoof", recipientName: "spoof", createdAt: "2000-01-01",
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(result.content, "x".repeat(196));
  assert.equal(result.authorId, "author");
  assert.equal(result.recipientId, "reader");
  assert.equal(result.recipientName, "Test reader");
  assert.ok(Date.now() - Date.parse(result.createdAt) < 10_000);
  assert.ok(recipientChecks > before, "recipient must be freshly checked when sending");
  assert.deepEqual(result.acknowledgments, []);
});

test("only sender and recipient can list the message; unrelated editors get no message", async () => {
  const sent = await send();
  for (const user of ["author", "reader"]) {
    assert.deepEqual((await (await request("/messages", "GET", user)).json()).messages, [sent]);
  }
  for (const user of ["outsider", "editor-recipient"]) {
    assert.deepEqual((await (await request("/messages", "GET", user)).json()).messages, []);
  }
});

test("only recipient can OK, and sender sees named/timestamped idempotent confirmation", async () => {
  await send();
  assert.equal((await request(`/messages/${messageId}/acknowledgments`, "POST", "author")).status, 403);
  for (const user of ["outsider", "editor-recipient"]) {
    assert.equal((await request(`/messages/${messageId}/acknowledgments`, "POST", user)).status, 404);
  }
  const first = await request(`/messages/${messageId}/acknowledgments`, "POST", "reader");
  assert.equal(first.status, 200);
  const result = await first.json();
  const repeated = await (await request(`/messages/${messageId}/acknowledgments`, "POST", "reader")).json();
  assert.deepEqual(repeated.acknowledgments, result.acknowledgments);
  assert.equal(result.acknowledgments[0].displayName, "Test reader");
  assert.ok(result.acknowledgments[0].acknowledgedAt);
  assert.deepEqual((await (await request("/messages", "GET", "author")).json()).messages[0], result);
});

test("editor recipients may OK, but an editor sender may not self-confirm", async () => {
  await send("editor-recipient");
  assert.equal((await request(`/messages/${messageId}/acknowledgments`, "POST", "author")).status, 403);
  assert.equal((await request(`/messages/${messageId}/acknowledgments`, "POST", "editor-recipient")).status, 200);
});

test("legacy broadcast records are visible only to their original sender", async () => {
  const legacy = await send();
  messages[0] = { ...legacy, recipientId: null, recipientName: null };
  assert.equal((await (await request("/messages", "GET", "author")).json()).messages.length, 1);
  assert.deepEqual((await (await request("/messages", "GET", "reader")).json()).messages, []);
});

test("reset/remove require DONE plus current editor access and message participation", async () => {
  await send();
  assert.equal((await request(`/messages/${messageId}/acknowledgments`, "DELETE", "author")).status, 409);
  await request(`/messages/${messageId}/acknowledgments`, "POST", "reader");
  for (const suffix of ["", "/acknowledgments"]) {
    assert.equal((await request(`/messages/${messageId}${suffix}`, "DELETE", "reader", undefined, "editor")).status, 403);
    assert.equal((await request(`/messages/${messageId}${suffix}`, "DELETE", "editor-recipient")).status, 404);
  }
  const reset = await request(`/messages/${messageId}/acknowledgments`, "DELETE", "author");
  assert.equal(reset.status, 200);
  assert.deepEqual((await reset.json()).acknowledgments, []);
  await request(`/messages/${messageId}/acknowledgments`, "POST", "reader");
  assert.equal((await request(`/messages/${messageId}`, "DELETE", "author")).status, 204);
  assert.deepEqual((await (await request("/messages", "GET", "reader")).json()).messages, []);
});

test("invalid/missing IDs are rejected without resurrecting archive/history routes", async () => {
  assert.equal((await request("/messages/invalid/acknowledgments", "POST", "reader")).status, 400);
  assert.equal((await request(`/messages/${messageId}/acknowledgments`, "POST", "reader")).status, 404);
  assert.equal((await request("/messages/history", "GET", "author")).status, 404);
  assert.equal((await request(`/messages/${messageId}/archive`, "POST", "author")).status, 404);
});

test("storage or central authorization outages fail explicitly without saving or returning false receipts", async () => {
  await send();
  available = false;
  assert.equal((await request("/messages", "GET", "reader")).status, 503);
  assert.equal((await request("/messages", "POST", "author", { content: "not saved", recipientId: "reader" })).status, 503);
  assert.equal((await request(`/messages/${messageId}/acknowledgments`, "POST", "reader")).status, 503);
  available = true;
  recipientAccessAvailable = false;
  assert.equal((await request("/messages/recipients", "GET", "author")).status, 503);
  assert.equal((await request("/messages", "POST", "author", { content: "not saved", recipientId: "reader" })).status, 503);
  assert.equal(messages[0].content, "Check packing station.");
});
