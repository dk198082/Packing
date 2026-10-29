import { randomBytes, timingSafeEqual } from "node:crypto";
import { ConfidentialClientApplication } from "@azure/msal-node";
import connectPgSimple from "connect-pg-simple";
import session from "express-session";
import { getAzurePool, getAzureSchemaName } from "@workspace/db/azure";
import { z } from "zod";

export type ApplicationRole = "viewer" | "editor";

export type AuthenticatedUser = {
  entraOid: string;
  email: string;
  displayName: string;
  role: ApplicationRole;
};

const MICROSOFT_SCOPES = ["openid", "profile", "email"];
const SESSION_COOKIE_NAME = "packing.sid";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_CONSOLE_TIMEOUT_MS = 10_000;
const LEGACY_ADMIN_CONSOLE_EDITOR_ROLE = "packing read / write";

const entraClaimsSchema = z.object({
  oid: z.string().min(1),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  email: z.string().optional(),
});

const adminConsoleResponseSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
  roles: z.array(z.string()),
});

export class AccessDeniedError extends Error {
  constructor(message = "User does not have access to this application.") {
    super(message);
    this.name = "AccessDeniedError";
  }
}

export class AuthorizationServiceError extends Error {
  constructor(message = "The authorization service is unavailable.") {
    super(message);
    this.name = "AuthorizationServiceError";
  }
}

function requiredEnv(primaryName: string, fallbackName?: string): string {
  const value =
    process.env[primaryName]?.trim() ||
    (fallbackName ? process.env[fallbackName]?.trim() : undefined);
  if (!value) {
    throw new Error(
      fallbackName
        ? `${primaryName} or ${fallbackName} is required.`
        : `${primaryName} is required.`,
    );
  }
  return value;
}

function getAppBaseUrl(): string {
  const rawUrl = requiredEnv("APP_BASE_URL");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("APP_BASE_URL must use HTTPS.");
  }
  return url.origin;
}

function getAdminConsoleAppName(): string {
  return process.env.ADMIN_CONSOLE_APP_NAME?.trim() || "Packing Control Board";
}

function getAdminConsoleEditorRoles(): Set<string> {
  return new Set([
    LEGACY_ADMIN_CONSOLE_EDITOR_ROLE,
    "read / write",
    "read/write",
    `${getAdminConsoleAppName()} - Read / Write`.toLowerCase(),
  ]);
}

function getAdminConsoleAccessUrl(entraOid: string): URL {
  const baseUrl = new URL(requiredEnv("ADMIN_CONSOLE_URL"));
  const isLocalhost =
    baseUrl.hostname === "localhost" ||
    baseUrl.hostname === "127.0.0.1" ||
    baseUrl.hostname === "::1";
  if (baseUrl.protocol !== "https:" && !isLocalhost) {
    throw new AuthorizationServiceError("ADMIN_CONSOLE_URL must use HTTPS.");
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/api/access-check`;
  baseUrl.search = "";
  baseUrl.hash = "";
  baseUrl.searchParams.set("entraObjectId", entraOid);
  baseUrl.searchParams.set("app", getAdminConsoleAppName());
  return baseUrl;
}

let msalClient: ConfidentialClientApplication | undefined;

function getMsalClient(): ConfidentialClientApplication {
  if (msalClient) return msalClient;

  const tenantId = requiredEnv("ENTRA_TENANT_ID", "TENANT_ID");
  msalClient = new ConfidentialClientApplication({
    auth: {
      clientId: requiredEnv("ENTRA_CLIENT_ID", "CLIENT_ID"),
      clientSecret: requiredEnv("ENTRA_CLIENT_SECRET", "CLIENT_SECRET"),
      authority: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`,
    },
  });
  return msalClient;
}

export function getRedirectUri(): string {
  return `${getAppBaseUrl()}/api/auth/callback`;
}

export function getMicrosoftLogoutUrl(): string {
  const tenantId = requiredEnv("ENTRA_TENANT_ID", "TENANT_ID");
  const logoutUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/logout`,
  );
  logoutUrl.searchParams.set("post_logout_redirect_uri", `${getAppBaseUrl()}/`);
  return logoutUrl.toString();
}

export function sanitizeReturnTo(value: unknown): string {
  if (typeof value !== "string") return "/";
  const returnTo = value.trim();
  if (
    !returnTo.startsWith("/") ||
    returnTo.startsWith("//") ||
    returnTo.includes("\\")
  ) {
    return "/";
  }

  try {
    const appOrigin = getAppBaseUrl();
    const parsed = new URL(returnTo, appOrigin);
    if (parsed.origin !== appOrigin) return "/";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export function createAuthState(): string {
  return randomBytes(32).toString("hex");
}

export function authStatesMatch(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

export async function createMicrosoftAuthorizationUrl(
  state: string,
): Promise<string> {
  return getMsalClient().getAuthCodeUrl({
    scopes: MICROSOFT_SCOPES,
    redirectUri: getRedirectUri(),
    state,
    prompt: "select_account",
  });
}

export async function authenticateMicrosoftCode(
  code: string,
): Promise<Omit<AuthenticatedUser, "role">> {
  const result = await getMsalClient().acquireTokenByCode({
    code,
    scopes: MICROSOFT_SCOPES,
    redirectUri: getRedirectUri(),
  });

  const claims = entraClaimsSchema.parse(result.idTokenClaims);
  return {
    entraOid: claims.oid,
    email: claims.email || claims.preferred_username || "",
    displayName:
      claims.name ||
      claims.email ||
      claims.preferred_username ||
      "Microsoft user",
  };
}

export async function authorizeWithAdminConsole(
  entraOid: string,
): Promise<ApplicationRole> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ADMIN_CONSOLE_TIMEOUT_MS,
  );

  try {
    const response = await fetch(getAdminConsoleAccessUrl(entraOid), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-API-Key": requiredEnv("ADMIN_CONSOLE_API_KEY"),
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AuthorizationServiceError();
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AuthorizationServiceError();
    }

    const parsed = adminConsoleResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new AuthorizationServiceError();
    }

    if (!parsed.data.allowed) {
      throw new AccessDeniedError(
        parsed.data.reason || "User does not have access to this application.",
      );
    }

    const editorRoles = getAdminConsoleEditorRoles();
    const isReadWrite = parsed.data.roles.some((role) =>
      editorRoles.has(role.trim().toLowerCase()),
    );

    return isReadWrite ? "editor" : "viewer";
  } catch (error) {
    if (
      error instanceof AccessDeniedError ||
      error instanceof AuthorizationServiceError
    ) {
      throw error;
    }
    throw new AuthorizationServiceError();
  } finally {
    clearTimeout(timeout);
  }
}

const PgSessionStore = connectPgSimple(session);
const isDevelopment = process.env.NODE_ENV !== "production";

export const sessionMiddleware = session({
  name: SESSION_COOKIE_NAME,
  store: new PgSessionStore({
    pool: getAzurePool(),
    schemaName: getAzureSchemaName(),
    tableName: "sessions",
    createTableIfMissing: false,
  }),
  secret: requiredEnv("SESSION_SECRET"),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,
    secure: isDevelopment ? true : "auto",
    sameSite: isDevelopment ? "none" : "lax",
  },
});

export const sessionCookieName = SESSION_COOKIE_NAME;
