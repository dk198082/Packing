# Deploying Packing Control Board to Azure

This app was already built with Azure in mind — Entra ID login via
`@azure/msal-node`, a native Azure Postgres connection helper
(`lib/db/src/azure.ts`, discrete `AZURE_PG_*` fields rather than a
connection string, avoiding the special-character/percent-encoding issue
documented elsewhere in this project's other apps), and it already
integrates with the Data Admin Suite's `/api/access-check` for
authorization — the same centralized entitlement system Field Service
Calendar and Production Calendar use. The changes here (`Dockerfile`,
`.dockerignore`, and the `STATIC_DIR` block added to
`artifacts/api-server/src/app.ts`) make it deployable as a single container.

**No auth, session, or authorization code changes were needed** — this is
the most "already Azure-ready" app of this whole project family so far.
`trust proxy` was already set, the auth middleware already re-checks
authorization with the Admin Console every 5 minutes (revoking access
promptly if it changes there), and every data route was already correctly
gated (`requireLogin`/`requireRole("editor")`) — no wiring gap to fix, unlike
a couple of the earlier apps in this family.

## Recommended shape: one container, one Azure resource

`Dockerfile` builds the API server and the `packing-control-board` frontend,
and the API server serves the built frontend itself (`STATIC_DIR` env var —
see the block in `app.ts`). One Azure resource to run.

## 1. Azure resources to create

| Resource | Purpose |
|---|---|
| Azure Container Registry (ACR) | Stores the built image |
| Azure App Service (Linux, "Web App for Containers") **or** Azure Container Apps | Runs the container |
| Azure Database for PostgreSQL – Flexible Server | Application data + session store |
| Azure App Registration (Entra ID) | This app's own login |

This app calls the Data Admin Suite's `/api/access-check` for authorization
— that app (and its own Azure deployment) must already exist and be
reachable before this app's users can log in.

## 2. Build & push the image

```bash
az acr login --name <your-acr-name>
docker build -t <your-acr-name>.azurecr.io/packing-control-board:latest .
docker push <your-acr-name>.azurecr.io/packing-control-board:latest
```

## 3. Environment variables (App Settings / Container Apps secrets)

| Variable | Required | Notes |
|---|---|---|
| `AZURE_PG_HOST` / `AZURE_PG_PORT` / `AZURE_PG_DATABASE` / `AZURE_PG_SP_USER` / `AZURE_PG_PASSWORD` | Yes | Discrete Azure Postgres connection fields — `lib/db/src/azure.ts` builds the pool from these directly, not a connection string, specifically to avoid special-character password issues |
| `AZURE_PG_SCHEMA` | Yes | Must be a valid Postgres identifier (validated) — the schema this app's tables (and its `sessions` table) live in |
| `AZURE_PG_SSLMODE` | No | Defaults to `require`; setting it to `disable` throws on startup — TLS is mandatory by design, not optional |
| `SESSION_SECRET` | Yes | Signs the session cookie |
| `APP_BASE_URL` | Yes | This app's own public HTTPS URL (e.g. `https://packing.yourorg.com`) — must use HTTPS, checked at startup (localhost is exempted for local dev). Used to build the Entra ID redirect URI and the post-logout redirect. |
| `ENTRA_TENANT_ID` / `TENANT_ID` | Yes | From this app's own Azure App Registration — **must be the same tenant** as the Data Admin Suite and every other app that shares single sign-on |
| `ENTRA_CLIENT_ID` / `CLIENT_ID` | Yes | This app's own App Registration client ID |
| `ENTRA_CLIENT_SECRET` / `CLIENT_SECRET` | Yes | This app's own App Registration client secret |
| `ADMIN_CONSOLE_URL` | Yes | Base URL of the deployed Data Admin Suite — must use HTTPS (checked at startup; localhost exempted). No fallback if unset or unreachable: every login attempt fails closed. |
| `ADMIN_CONSOLE_API_KEY` | Yes | Matches an API key configured on that Data Admin Suite deployment for its `/api/access-check` endpoint |
| `ADMIN_CONSOLE_APP_NAME` | No | Defaults to `"Packing Control Board"` — only change this if the app is registered under a different name in the Admin Console's `apps` table; it must match exactly (case-insensitive) or every access check will fail to find a matching entitlement |
| `LOG_LEVEL` | No | Pino log level |
| `PORT` | No | Azure sets this for you; the Dockerfile defaults it to `8080` |
| `STATIC_DIR` | No | Already set by the Dockerfile |

## 4. Register the app in Entra ID

Same steps as every other app in this project family:

1. Azure Portal → Microsoft Entra ID → App registrations → New registration.
2. Redirect URI (Web platform): `https://<your-domain>/api/auth/callback`.
3. Grant admin consent for the requested scopes (`openid`, `profile`,
   `email`) so users never see a one-time consent prompt.
4. Store the client secret in Key Vault / App Settings.
5. **Confirm the tenant ID matches** the Data Admin Suite's own tenant —
   if this app is meant to participate in the workspace's single sign-on,
   a mismatched tenant means users will always be prompted to log in again
   when opening this app, with no error message pointing at why.

## 5. Onboard this app in the Data Admin Suite

Before anyone can log in here, the Data Admin Suite needs:
1. An `apps` row named **exactly** `Packing Control Board` (or whatever
   `ADMIN_CONSOLE_APP_NAME` is set to) — case-insensitive match, but it must
   match, or `/api/access-check` will always report "no permissions for
   this app" regardless of role assignments.
2. At least one role for that app, with users assigned to it.
3. An editor-capable role should be named so it matches one of:
   `"read / write"`, `"read/write"`, or `"<app name> - Read / Write"`
   (case-insensitive) — see `getAdminConsoleEditorRoles()` in `lib/auth.ts`
   — anything else is treated as `viewer`, not `editor`.

If this app is being added to the Digital Workspace shell described
elsewhere in this project, see that project's own `ADDING_NEW_APPS.md` for
the tile/launch-URL/iframe-embedding steps — those are independent of
everything above.

## 6. Push the Drizzle schema

**Important, easy to miss:** the running app connects using the discrete
`AZURE_PG_*` fields above (specifically to avoid the password
percent-encoding problem a plain connection string has — see
`lib/db/src/azure.ts`), but `drizzle-kit push` itself is configured
differently (`lib/db/drizzle.config.ts`) and requires a plain
`DATABASE_URL` connection string instead. If your actual Azure Postgres
password contains special characters, you'll hit exactly the encoding
problem the runtime connection was built to avoid — but only when running
this migration step. Percent-encode the password yourself for this one
command if that's the case (verified working here with `-csearch_path=`
in the URL's `options` query param to target the same non-public schema):

```bash
export DATABASE_URL="postgres://<user>:<percent-encoded-password>@<host>:5432/<database>?options=-csearch_path%3D<schema>"
pnpm --filter @workspace/db run push
```

This creates the `sessions` table (Drizzle-managed here, unlike a couple of
the earlier apps in this family where it needed manual SQL — `sessions.ts`
is a real schema file in `lib/db/src/schema`) along with the application's
own tables (`in_packing_entries`, `pack_statuses`) — confirmed by running
this against a real local Postgres instance and checking the resulting
tables landed in the intended schema, not `public`.

## 7. Health check

`GET /api/healthz` — point Azure's health probe at it. Confirmed exempt
from auth (mounted before `requireLogin` in `routes/index.ts`).

## Things found while validating this export

- **Fixed (blocked the test suite):** `test/access-control.test.ts` stubbed
  every env var `lib/auth.ts` needs — except `AZURE_PG_*`. Importing
  `lib/auth.ts` also defines `sessionMiddleware` at module scope, which
  eagerly calls `getAzurePool()` (`lib/db/src/azure.ts`) as a side effect of
  loading the module, not lazily on first request — so the whole test file
  failed at the `before()` hook with "AZURE_PG_HOST is required," before any
  actual test logic ran. Fixed by adding the same style of fake env var
  stubs already used for everything else in this file. Confirmed: 8/8 tests
  now pass (previously 0/8, all cancelled).
- **Confirmed by testing directly, not just reading the code:** the runtime
  connection (`lib/db/src/azure.ts`) hard-enforces TLS with no bypass —
  `AZURE_PG_SSLMODE=disable` doesn't skip TLS, it throws an explicit error
  refusing to start at all. This is secure-by-default behavior, not a bug —
  confirmed by actually booting the compiled server against a real
  Postgres instance with TLS enabled locally (self-signed cert) end-to-end:
  the app starts, serves the frontend, and correctly gates its API.
- **Minor cleanup, not a functional issue:** `cors` is listed as a runtime
  dependency in `artifacts/api-server/package.json` but isn't imported or
  used anywhere in the source — dead weight, safe to remove from
  `package.json` whenever convenient. Not removed here since it's a
  harmless no-op either way, and might be intentionally kept for a
  near-term split-deployment plan — not this tool's call to make silently.
- If a split deployment (frontend and API on different origins) is ever
  needed, this app doesn't currently have the `CORS_ORIGIN`-configurable
  pattern used elsewhere in this project family — `cors` being an
  already-listed but unused dependency suggests this was anticipated but
  not finished. Add it following the same pattern documented in Field
  Service Calendar's own `AZURE_DEPLOYMENT.md` if that becomes a
  requirement.

## 🆕 New in this export: machine model shown for SYSTEM-team orders

The board's card, table, and drawer views now show each order's machine
model alongside the customer name — but only for orders where
`team === 'SYSTEM'`; other teams' cards/rows are unaffected. Also tightened
card spacing/padding slightly. No deployment changes needed — purely a
frontend display change, no new routes, no new environment variables.
