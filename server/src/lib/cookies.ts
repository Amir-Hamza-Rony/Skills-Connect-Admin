import type { CookieOptions, Response } from "express";

import { env } from "../config/env.js";

/**
 * Name and transport rules for the refresh cookie.
 *
 * httpOnly  — JavaScript (including any XSS payload) cannot read it, which is
 *             the entire reason this cookie exists.
 * SameSite  — `lax` for same-site deployments (API and SPA on one site, which
 *             includes localhost:5173 -> localhost:4000). Cross-site hosting
 *             requires COOKIE_SAME_SITE=none, and browsers then also require
 *             Secure, which is why COOKIE_SECURE is forced true in production.
 * path      — scoped to /auth so the cookie is not attached to every API call.
 */

export const REFRESH_COOKIE_NAME = "sc_refresh";

const BASE: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAME_SITE,
  path: "/auth",
};

export function setRefreshCookie(res: Response, rawToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    ...BASE,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, BASE);
}

/** Reads the refresh token without assuming it is present. */
export function readRefreshCookie(req: { cookies?: Record<string, unknown> }): string | null {
  const value = req.cookies?.[REFRESH_COOKIE_NAME];
  return typeof value === "string" && value.length > 0 ? value : null;
}