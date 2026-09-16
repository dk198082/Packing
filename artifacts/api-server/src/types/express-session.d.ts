import type { AuthenticatedUser } from "../lib/auth";

declare module "express-session" {
  interface SessionData {
    authState?: string;
    returnTo?: string;
    user?: AuthenticatedUser;
    authorizationCheckedAt?: number;
  }
}