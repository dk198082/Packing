import { GetCurrentUserResponse } from "@workspace/api-zod";
import { Router, type IRouter, type Request, type Response } from "express";

import {
  AccessDeniedError,
  AuthorizationServiceError,
  authStatesMatch,
  authenticateMicrosoftCode,
  authorizeWithAdminConsole,
  createAuthState,
  createMicrosoftAuthorizationUrl,
  getMicrosoftLogoutUrl,
  sanitizeReturnTo,
  sessionCookieName,
} from "../lib/auth";

import { requireLogin } from "../middlewares/auth";

export type AuthRouteDependencies = {
  authenticateMicrosoftCode: typeof authenticateMicrosoftCode;
  authorizeWithAdminConsole: typeof authorizeWithAdminConsole;
};

const defaultDependencies: AuthRouteDependencies = {
  authenticateMicrosoftCode,
  authorizeWithAdminConsole,
};

function queryString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: true,
    sameSite: process.env.NODE_ENV !== "production" ? "none" : "lax",
  });
}

async function discardSession(req: Request, res: Response): Promise<void> {
  await destroySession(req);
  clearSessionCookie(res);
}

declare module "express-session" {
  interface SessionData {
    embeddedLogin?: boolean;
  }
}

export function createAuthRouter(
  dependencies: AuthRouteDependencies = defaultDependencies,
): IRouter {
  const router: IRouter = Router();

  // ------------------------------------------------------------
  // Microsoft Login
  // ------------------------------------------------------------
  router.get("/login", async (req, res): Promise<void> => {
    try {
      const embeddedLogin = req.query.embedded === "1";

      await regenerateSession(req);

      req.session.embeddedLogin = embeddedLogin;

      const state = createAuthState();

      req.session.authState = state;
      req.session.returnTo = sanitizeReturnTo(req.query.returnTo);

      await saveSession(req);

      const authorizationUrl =
        await createMicrosoftAuthorizationUrl(state);

      res.redirect(authorizationUrl);
    } catch (error) {
      await discardSession(req, res);

      req.log.error(
        {
          errorName: error instanceof Error ? error.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
        "Unable to start Microsoft sign-in",
      );

      res.status(500).send("Microsoft sign-in could not be started.");
    }
  });

  // ------------------------------------------------------------
  // Microsoft OAuth Callback
  // ------------------------------------------------------------
  router.get("/callback", async (req, res): Promise<void> => {
    const code = queryString(req.query.code);
    const state = queryString(req.query.state);

    const expectedState = req.session.authState;
    const returnTo = sanitizeReturnTo(req.session.returnTo);
    const embeddedLogin = req.session.embeddedLogin === true;

    delete req.session.authState;
    delete req.session.returnTo;
    delete req.session.embeddedLogin;

    if (
      queryString(req.query.error) ||
      !code ||
      !state ||
      !expectedState ||
      !authStatesMatch(expectedState, state)
    ) {
      await discardSession(req, res);

      res
        .status(400)
        .send("The Microsoft sign-in response was invalid or expired.");

      return;
    }

    let identity:
      | Awaited<
          ReturnType<AuthRouteDependencies["authenticateMicrosoftCode"]>
        >
      | undefined;

    try {
      await saveSession(req);

      identity = await dependencies.authenticateMicrosoftCode(code);

      const role = await dependencies.authorizeWithAdminConsole(
        identity.entraOid,
      );

      await regenerateSession(req);

      req.session.user = {
        ...identity,
        role,
      };

      req.session.authorizationCheckedAt = Date.now();

      await saveSession(req);

      // Embedded login is used when opened from Digital Workspace.
      if (embeddedLogin) {
        res.redirect("/api/auth/embedded-complete");
        return;
      }

      res.redirect(returnTo);
    } catch (error) {
      await discardSession(req, res);

      if (error instanceof AccessDeniedError) {
        req.log.warn(
          {
            denialReason: error.message,
          },
          "Microsoft user denied by Admin Console",
        );

        const identityDetails = identity
          ? `\n\nSigned-in account: ${
              identity.email || "(email unavailable)"
            }\nEntra Object ID received by the app: ${identity.entraOid}`
          : "";

        res
          .status(403)
          .set("Content-Type", "text/plain; charset=utf-8")
          .send(
            `You do not have access to the Packing Control Board.\n\nAdmin Console reason: ${error.message}${identityDetails}`,
          );

        return;
      }

      if (error instanceof AuthorizationServiceError) {
        req.log.error(
          {
            errorName:
              error instanceof Error ? error.name : "unknown",
            errorMessage:
              error instanceof Error
                ? error.message
                : String(error),
          },
          "Admin Console authorization check failed",
        );

        res
          .status(503)
          .send(
            "Access could not be verified. Please try signing in again.",
          );

        return;
      }

      req.log.error(
        {
          errorName:
            error instanceof Error ? error.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
        "Microsoft sign-in callback failed",
      );

      res
        .status(500)
        .send("Microsoft sign-in could not be completed.");
    }
  });

  // ------------------------------------------------------------
  // Current User
  // ------------------------------------------------------------
  router.get("/me", requireLogin, (req, res): void => {
    res.set("Cache-Control", "no-store");

    res.json(
      GetCurrentUserResponse.parse(req.session.user),
    );
  });

  // ------------------------------------------------------------
  // Embedded Authentication Complete
  // ------------------------------------------------------------
  router.get("/embedded-complete", (req, res): void => {
  const workspaceOrigin =
    process.env.WORKSPACE_FRONTEND_URL?.trim();

  if (!workspaceOrigin) {
    res
      .status(500)
      .type("text")
      .send("WORKSPACE_FRONTEND_URL is not configured.");

    return;
  }

  res.type("html").send(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Authentication complete</title>
</head>

<body>
<script>
(function () {
  const workspaceOrigin = ${JSON.stringify(workspaceOrigin)};

  if (window.opener) {
    window.opener.postMessage(
      {
        type: "PACKING_CONTROL_AUTH_COMPLETE"
      },
      workspaceOrigin
    );
  }

  // Give the Workspace a moment to receive the message,
  // then close this authentication window.
  setTimeout(function () {
    window.close();
  }, 300);
})();
</script>

<p>Authentication complete. You can close this window.</p>
</body>
</html>
  `);
});


  // ------------------------------------------------------------
  // Logout
  // ------------------------------------------------------------
  router.post("/logout", async (req, res): Promise<void> => {
    try {
      await destroySession(req);

      clearSessionCookie(res);

      res.redirect(getMicrosoftLogoutUrl());
    } catch (error) {
      req.log.error(
        {
          errorName:
            error instanceof Error ? error.name : "unknown",
          errorMessage:
            error instanceof Error ? error.message : String(error),
        },
        "Logout failed",
      );

      res
        .status(500)
        .send("Sign out could not be completed.");
    }
  });

  return router;
}

export default createAuthRouter();