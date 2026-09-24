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
import {
  verifyEmbeddedSsoToken,
} from "../lib/embedded-sso";

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

function clearSessionCookie(
  res: Response,
): void {
  const isProduction =
    process.env.NODE_ENV === "production";

  const appOrigin =
    process.env.APP_ORIGIN?.trim() || "";

  const isLocalHttp =
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(
      appOrigin,
    );

  const useSecureCookie =
    isProduction && !isLocalHttp;

  res.clearCookie(sessionCookieName, {
    httpOnly: true,

    secure: useSecureCookie,

    sameSite: useSecureCookie
      ? "none"
      : "lax",
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

router.get("/embedded-sso", async (req, res): Promise<void> => {
  const token =
    typeof req.query.token === "string"
      ? req.query.token
      : "";

  const returnTo =
    typeof req.query.returnTo === "string"
      ? req.query.returnTo
      : "/";

  if (!token) {
    res.status(400).send("Missing SSO token.");
    return;
  }

  const identity = verifyEmbeddedSsoToken(
    token,
    "packing-control-board",
  );

  if (!identity) {
    res.status(401).send("Invalid or expired SSO token.");
    return;
  }

  try {
    /*
     * Re-check authorization against Admin Console.
     * The Workspace proves who the user is.
     * Admin Console remains the source of application entitlement.
     */
    const role = await authorizeWithAdminConsole(
      identity.sub,
    );

    await regenerateSession(req);

    req.session.user = {
      entraOid: identity.sub,
      email: identity.email,
      displayName: identity.name,
      role,
    };

    req.session.authorizationCheckedAt = Date.now();

    await saveSession(req);

    const safeReturnTo =
      returnTo.startsWith("/") &&
      !returnTo.startsWith("//") &&
      !returnTo.includes("\\")
        ? returnTo
        : "/";

    res.redirect(safeReturnTo);
  } catch (error) {
    await discardSession(req, res);

    if (error instanceof AccessDeniedError) {
      res.status(403).send(
        "You do not have access to Packing Control Board.",
      );
      return;
    }

    if (error instanceof AuthorizationServiceError) {
      res.status(503).send(
        "Access could not be verified right now.",
      );
      return;
    }

    req.log.error(
      {
        errorName:
          error instanceof Error ? error.name : "unknown",
        errorMessage:
          error instanceof Error
            ? error.message
            : String(error),
      },
      "Embedded SSO failed",
    );

    res.status(500).send(
      "Embedded sign-in could not be completed.",
    );
  }
});  

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
        res.redirect("/");
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