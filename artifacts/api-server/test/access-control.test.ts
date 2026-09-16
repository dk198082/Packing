import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

process.env.APP_BASE_URL = "https://packing.example.test";
process.env.ADMIN_CONSOLE_URL = "https://admin.example.test";
process.env.ADMIN_CONSOLE_API_KEY = "test-api-key";
process.env.SESSION_SECRET = "test-session-secret";
process.env.TENANT_ID = "test-tenant";
process.env.CLIENT_ID = "test-client";
process.env.CLIENT_SECRET = "test-secret";
// Importing lib/auth.ts also defines `sessionMiddleware` at module scope,
// which eagerly calls getAzurePool() (lib/db/src/azure.ts) as a side
// effect of evaluating the module — not lazily, on first request. These
// fake values only need to satisfy that constructor; no real connection is
// ever attempted in this test file, since nothing here exercises the
// session store itself.
process.env.AZURE_PG_HOST = "localhost";
process.env.AZURE_PG_PORT = "5432";
process.env.AZURE_PG_DATABASE = "test-db";
process.env.AZURE_PG_SP_USER = "test-user";
process.env.AZURE_PG_PASSWORD = "test-password";
process.env.AZURE_PG_SCHEMA = "test_schema";

type AuthModule = typeof import("../src/lib/auth");
type MiddlewareModule = typeof import("../src/middlewares/auth");
type RouteModule = typeof import("../src/routes/auth");

let auth: AuthModule;
let middleware: MiddlewareModule;
let authRoutes: RouteModule;
const originalFetch = globalThis.fetch;

before(async () => {
  auth = await import("../src/lib/auth");
  middleware = await import("../src/middlewares/auth");
  authRoutes = await import("../src/routes/auth");
});

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function adminResponse(body: unknown, status = 200): Response {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }) as unknown as Response;
}

function createResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    redirectUrl: undefined as string | undefined,
    cookieCleared: false,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
    redirect(url: string) {
      this.redirectUrl = url;
      return this;
    },
    clearCookie() {
      this.cookieCleared = true;
      return this;
    },
    set() {
      return this;
    },
  };
  return response;
}

function createSessionRequest(user?: {
  entraOid: string;
  email: string;
  displayName: string;
  role: "viewer" | "editor";
}) {
  let regenerateCount = 0;
  let saveCount = 0;
  let destroyCount = 0;
  const session = {
    user,
    authorizationCheckedAt: user ? Date.now() : undefined,
    authState: undefined as string | undefined,
    returnTo: undefined as string | undefined,
    save(callback: (error?: Error) => void) {
      saveCount += 1;
      callback();
    },
    regenerate(callback: (error?: Error) => void) {
      regenerateCount += 1;
      delete this.user;
      delete this.authorizationCheckedAt;
      callback();
    },
    destroy(callback: (error?: Error) => void) {
      destroyCount += 1;
      delete this.user;
      callback();
    },
  };
  const request = {
    session,
    query: {},
    log: { warn() {}, error() {} },
  };
  return {
    request: request as unknown as Request,
    session,
    counts: {
      get regenerate() {
        return regenerateCount;
      },
      get save() {
        return saveCount;
      },
      get destroy() {
        return destroyCount;
      },
    },
  };
}

function findRouteHandler(
  router: ReturnType<RouteModule["createAuthRouter"]>,
  path: string,
) {
  const layer = (
    router as unknown as { stack: Array<Record<string, any>> }
  ).stack.find((candidate) => candidate.route?.path === path);
  assert.ok(layer, `route ${path} exists`);
  return layer.route.stack.at(-1).handle as (
    req: Request,
    res: Response,
  ) => Promise<void>;
}

describe("Admin Console authorization", () => {
  it("maps only the exact normalized editor role to editor", async () => {
    for (const [roles, expected] of [
      [["Packing Read / Write"], "editor"],
      [["pAcKiNg ReAd / WrItE"], "editor"],
      [["  Packing Read / Write  "], "editor"],
      [["Packing Control Board - Read / Write"], "editor"],
      [["packing control board - read / write"], "editor"],
      [["Read / Write"], "editor"],
      [["Read/Write"], "editor"],
      [["Packing Read"], "viewer"],
      [["Packing Read/Write"], "viewer"],
      [["Packing Read / Write Extended"], "viewer"],
      [["Regional Packing Read / Write"], "viewer"],
      [["Other App - Read / Write"], "viewer"],
      [["Packing Administrator"], "viewer"],
      [["Unrelated Role"], "viewer"],
      [["Packing Read / Write Extended", "Packing Read"], "viewer"],
    ] as const) {
      globalThis.fetch = async () =>
        adminResponse({ allowed: true, reason: null, roles }) as any;
      assert.equal(await auth.authorizeWithAdminConsole("oid-1"), expected);
    }
  });

  it("denies disallowed users and fails closed when Admin Console is unavailable", async () => {
    globalThis.fetch = async () =>
      adminResponse({ allowed: false, reason: "revoked", roles: [] }) as any;
    await assert.rejects(
      auth.authorizeWithAdminConsole("oid-1"),
      auth.AccessDeniedError,
    );

    globalThis.fetch = async () => adminResponse({}, 503) as any;
    await assert.rejects(
      auth.authorizeWithAdminConsole("oid-1"),
      auth.AuthorizationServiceError,
    );
  });
});

describe("Microsoft callback", () => {
  it("rejects invalid OAuth state without exchanging the code", async () => {
    let exchanged = false;
    const router = authRoutes.createAuthRouter({
      authenticateMicrosoftCode: async () => {
        exchanged = true;
        throw new Error("must not run");
      },
      authorizeWithAdminConsole: async () => "editor",
    });
    const { request } = createSessionRequest();
    request.query = { code: "code", state: "wrong" };
    request.session.authState = "expected";
    const response = createResponse();

    await findRouteHandler(router, "/auth/callback")(
      request,
      response as unknown as Response,
    );

    assert.equal(response.statusCode, 400);
    assert.equal(exchanged, false);
  });

  it("regenerates the session after an allowed Microsoft exchange", async () => {
    const router = authRoutes.createAuthRouter({
      authenticateMicrosoftCode: async () => ({
        entraOid: "oid-1",
        email: "editor@example.test",
        displayName: "Editor",
      }),
      authorizeWithAdminConsole: async () => "editor",
    });
    const { request, counts } = createSessionRequest();
    request.query = { code: "code", state: "expected" };
    request.session.authState = "expected";
    request.session.returnTo = "/orders";
    const response = createResponse();

    await findRouteHandler(router, "/auth/callback")(
      request,
      response as unknown as Response,
    );

    assert.equal(counts.regenerate, 1);
    assert.equal(request.session.user?.role, "editor");
    assert.equal(response.redirectUrl, "/orders");
  });

  it("returns 403 for denied users and 503 when authorization is unavailable", async () => {
    for (const [error, expectedStatus] of [
      [new auth.AccessDeniedError(), 403],
      [new auth.AuthorizationServiceError(), 503],
    ] as const) {
      const router = authRoutes.createAuthRouter({
        authenticateMicrosoftCode: async () => ({
          entraOid: "oid-1",
          email: "",
          displayName: "User",
        }),
        authorizeWithAdminConsole: async () => {
          throw error;
        },
      });
      const { request } = createSessionRequest();
      request.query = { code: "code", state: "expected" };
      request.session.authState = "expected";
      const response = createResponse();

      await findRouteHandler(router, "/auth/callback")(
        request,
        response as unknown as Response,
      );
      assert.equal(response.statusCode, expectedStatus);
    }
  });
});

describe("session and write authorization", () => {
  const editor = {
    entraOid: "oid-1",
    email: "editor@example.test",
    displayName: "Editor",
    role: "editor" as const,
  };

  it("returns 401 when a session is missing or expired", async () => {
    const { requireLogin } = middleware.createAuthMiddleware({
      authorizeWithAdminConsole: async () => "editor",
    });
    const { request } = createSessionRequest();
    const response = createResponse();
    let continued = false;

    await requireLogin(
      request,
      response as unknown as Response,
      (() => {
        continued = true;
      }) as NextFunction,
    );

    assert.equal(response.statusCode, 401);
    assert.equal(continued, false);
  });

  it("destroys revoked sessions with 403 and unavailable checks with 503", async () => {
    for (const [error, expectedStatus] of [
      [new auth.AccessDeniedError(), 403],
      [new auth.AuthorizationServiceError(), 503],
    ] as const) {
      const { requireRole } = middleware.createAuthMiddleware({
        authorizeWithAdminConsole: async () => {
          throw error;
        },
      });
      const { request, counts } = createSessionRequest({ ...editor });
      const response = createResponse();
      let continued = false;

      await requireRole("editor")(
        request,
        response as unknown as Response,
        (() => {
          continued = true;
        }) as NextFunction,
      );

      assert.equal(response.statusCode, expectedStatus);
      assert.equal(counts.destroy, 1);
      assert.equal(response.cookieCleared, true);
      assert.equal(continued, false);
    }
  });

  it("rechecks access before a write and blocks an editor downgraded to viewer", async () => {
    const { requireRole } = middleware.createAuthMiddleware({
      authorizeWithAdminConsole: async () => "viewer",
    });
    const { request, counts } = createSessionRequest({ ...editor });
    const response = createResponse();
    let writeRan = false;

    await requireRole("editor")(
      request,
      response as unknown as Response,
      (() => {
        writeRan = true;
      }) as NextFunction,
    );

    assert.equal(request.session.user?.role, "viewer");
    assert.equal(counts.save, 1);
    assert.equal(response.statusCode, 403);
    assert.equal(writeRan, false);
  });
});
