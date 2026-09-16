import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";

const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = "packing.sid";

const sessionSecret = process.env.SESSION_SECRET?.trim();

if (!sessionSecret) {
  throw new Error("SESSION_SECRET is required.");
}

const sessionSchema =
  process.env.AZURE_PG_SCHEMA?.trim() || "public";

const PgSessionStore = connectPgSimple(session);

const isDevelopment = process.env.NODE_ENV !== "production";

const appOrigin = process.env.APP_ORIGIN?.trim() || "";

const isLocalHttp =
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(appOrigin);

export const sessionMiddleware = session({
  store: new PgSessionStore({
    pool,
    schemaName: sessionSchema,
    tableName: "sessions",
    createTableIfMissing: false,
  }),

  name: SESSION_COOKIE_NAME,

  secret: sessionSecret,

  resave: false,

  saveUninitialized: false,

  rolling: true,

  cookie: {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_MS,

    secure: !isLocalHttp,

    sameSite:
      isDevelopment && !isLocalHttp
        ? "none"
        : "lax",
  },
});