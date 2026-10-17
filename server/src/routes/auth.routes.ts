import { Router } from "express";
import { z } from "zod";

import { AppError } from "../lib/app-error.js";
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from "../lib/cookies.js";
import { User } from "../models/user.model.js";
import { loginRateLimit } from "../middleware/login-rate-limit.js";
import { requireAuth } from "../middleware/require-auth.js";
import {
  login,
  logout,
  revokeAllSessions,
  rotateRefreshToken,
  type RequestMeta,
} from "../services/auth.service.js";
import { auditContextFrom } from "../services/audit.service.js";
import { PERMISSIONS, resolvePermissions } from "../services/permissions.js";

export const authRouter: Router = Router();

const credentials = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(1).max(200),
});

function meta(req: Parameters<typeof auditContextFrom>[0]): RequestMeta {
  return {
    ip: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
    requestId: typeof req.id === "string" ? req.id : null,
  };
}

/**
 * POST /auth/login
 *
 * Returns the short-lived access token in the body (the SPA keeps it in memory
 * only) and sets the rotating refresh token as an httpOnly cookie.
 */
authRouter.post("/login", loginRateLimit, async (req, res) => {
  const body = credentials.parse(req.body);

  const result = await login(body.email, body.password, meta(req));
  setRefreshCookie(res, result.refreshToken);

  res.status(200).json({
    user: result.user,
    accessToken: result.accessToken,
    tokenType: "Bearer",
    expiresIn: result.accessTokenExpiresInSeconds,
    refreshExpiresAt: result.refreshExpiresAt.toISOString(),
  });
});

/**
 * POST /auth/refresh
 *
 * Rotates the refresh cookie and issues a new access token. Presenting an
 * already-used token revokes the entire session family and returns 401.
 */
authRouter.post("/refresh", async (req, res) => {
  const raw = readRefreshCookie(req);
  if (!raw) throw AppError.unauthorized("No session cookie. Please sign in.");

  const result = await rotateRefreshToken(raw, meta(req));
  setRefreshCookie(res, result.refreshToken);

  res.status(200).json({
    user: result.user,
    accessToken: result.accessToken,
    tokenType: "Bearer",
    expiresIn: result.accessTokenExpiresInSeconds,
    refreshExpiresAt: result.refreshExpiresAt.toISOString(),
  });
});

/** POST /auth/logout — revokes the current session family and clears the cookie. */
authRouter.post("/logout", async (req, res) => {
  await logout(readRefreshCookie(req), meta(req));
  clearRefreshCookie(res);
  res.status(204).end();
});

/** GET /auth/me — current principal, used by the SPA to restore a session on load. */
authRouter.get("/me", requireAuth, (req, res) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();
  res.json({
    user: {
      id: auth.userId,
      email: auth.email,
      name: auth.name,
      roleNames: auth.roleNames,
      permissions: auth.permissions,
    },
  });
});

/**
 * GET /auth/permissions — the RBAC matrix as the server defines it.
 * The SPA uses this instead of its local copy so there is one source of truth.
 */
authRouter.get("/permissions", requireAuth, (_req, res) => {
  res.json({ permissions: PERMISSIONS });
});

/** POST /auth/logout-all — signs the user out of every device. */
authRouter.post("/logout-all", requireAuth, async (req, res) => {
  const auth = req.auth;
  if (!auth) throw AppError.unauthorized();
  const revoked = await revokeAllSessions(auth.userId, "user-logout-all", meta(req));
  clearRefreshCookie(res);
  res.json({ revoked });
});

/**
 * Convenience alias used by the store layer's `permissionsFor`, kept so the
 * frontend contract matches the plan's `permissionsFor(user)` signature.
 */
export async function permissionsForUser(userId: string): Promise<string[]> {
  const user = await User.findById(userId);
  if (!user) return [];
  const roles = (await user.populate<{
    roleIds: Array<{ name: string; permissions: never[] }>;
  }>("roleIds")).roleIds as unknown as Array<{ name: string; permissions: never[] }>;
  return resolvePermissions(roles.map((r) => r.permissions));
}