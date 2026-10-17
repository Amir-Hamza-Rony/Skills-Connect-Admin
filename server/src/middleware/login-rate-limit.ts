import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { createRateLimiter } from "../lib/rate-limit.js";

/**
 * Fixed-window rate limiting on the login route. Stops password spraying and
 * brute force before any database work happens.
 *
 * Backed by the in-process limiter (see `lib/rate-limit.ts` for the
 * multi-instance caveat); B5 moves it to Redis.
 */
const loginLimiter = createRateLimiter({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX,
});

/** Test seam so a suite can start each case with a clean counter. */
export function resetLoginLimiter(): void {
  loginLimiter.clearAll();
}

/**
 * Keyed by IP plus the submitted email, so one attacker cannot lock out an
 * entire office behind a shared NAT by hammering one address.
 */
export const loginRateLimit: RequestHandler = (req, res, next) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "unknown";
  const key = `${req.ip ?? "unknown"}|${email}`;

  const result = loginLimiter.hit(key);

  res.setHeader("X-RateLimit-Limit", String(env.LOGIN_RATE_LIMIT_MAX));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));

  if (!result.allowed) {
    res.setHeader("Retry-After", String(result.retryAfterSeconds));
    next();
    return;
  }

  next();
};