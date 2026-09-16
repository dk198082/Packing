import type { NextFunction, Request, Response } from "express";
import {
  AccessDeniedError,
  AuthorizationServiceError,
  authorizeWithAdminConsole,
  sessionCookieName,
  type ApplicationRole,
} from "../lib/auth";

const AUTHORIZATION_RECHECK_MS = 5 * 60 * 1000;

export type AuthMiddlewareDependencies = {
  authorizeWithAdminConsole: typeof authorizeWithAdminConsole;
};

const defaultDependencies: AuthMiddlewareDependencies = {
  authorizeWithAdminConsole,
};

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve) => {
    req.session.destroy(() => resolve());
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    secure: true,
    sameSite: process.env.NODE_ENV !== "production" ? "none" : "lax",
  });
}

async function refreshAuthorization(
  req: Request,
  res: Response,
  force: boolean,
  dependencies: AuthMiddlewareDependencies,
): Promise<boolean> {
  const user = req.session.user;
  if (!user) {
    res.status(401).json({ message: "Login required" });
    return false;
  }

  const lastCheckedAt = req.session.authorizationCheckedAt ?? 0;
  if (!force && Date.now() - lastCheckedAt < AUTHORIZATION_RECHECK_MS) {
    return true;
  }

  try {
    user.role = await dependencies.authorizeWithAdminConsole(user.entraOid);
    req.session.authorizationCheckedAt = Date.now();
    await saveSession(req);
    return true;
  } catch (error) {
    await destroySession(req);
    clearSessionCookie(res);

    if (error instanceof AccessDeniedError) {
      req.log.warn("Existing session revoked by Admin Console");
      res.status(403).json({ message: "Access denied" });
      return false;
    }

    if (error instanceof AuthorizationServiceError) {
      req.log.error("Admin Console session revalidation failed");
      res.status(503).json({ message: "Access could not be verified" });
      return false;
    }

    throw error;
  }
}

export function createAuthMiddleware(
  dependencies: AuthMiddlewareDependencies = defaultDependencies,
) {
  async function requireLogin(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    if (!(await refreshAuthorization(req, res, false, dependencies))) return;
    next();
  }

  function requireRole(...roles: ApplicationRole[]) {
    return async function requireApplicationRole(
      req: Request,
      res: Response,
      next: NextFunction,
    ): Promise<void> {
      if (!(await refreshAuthorization(req, res, true, dependencies))) return;

      const user = req.session.user!;
      if (!roles.includes(user.role)) {
        res.status(403).json({ message: "Access denied" });
        return;
      }

      next();
    };
  }

  return { requireLogin, requireRole };
}

export const { requireLogin, requireRole } = createAuthMiddleware();
