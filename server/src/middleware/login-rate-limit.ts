import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { createSharedRateLimiter } from "../lib/rate-limit.js";

/**
 * Fixed-window rate limiting on the login route. Stops password spraying and
 * brute force before any database work happens.
 *
 * Backed by Redis so the limit is shared across every API instance (B5). Falls
 * back to in-process counters when Redis is unreachable — see `lib/rate-limit.ts`.
 */
const loginLimiter = createSharedRateLimiter({
  windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: env.LOGIN_RATE_LIMIT_MAX,
});

/** Test seam so a suite can start each case with a clean counter. */
export function resetLoginLimiter(): void {
  void loginLimiter.clearAll();
}

/**
 * Keyed by IP plus the submitted email, so one attacker cannot lock out an
 * entire office behind a shared NAT by hammering one address.
 *
 * Exceeding the limit is REJECTED with 429. It used to set `Retry-After` and
 * call `next()` anyway, which counted attempts without ever refusing one — the
 * only thing that actually throttled a spray was the per-account lockout, so an
 * attacker could keep guessing passwords for accounts that did not exist yet.
 */
export const loginRateLimit: RequestHandler = (req, res, next) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "unknown";
  const key = `${req.ip ?? "unknown"}|${email}`;

  // `hit` may be async now that the counters live in Redis, so the decision is
  // reached in a continuation. Express handles async middleware fine as long as
  // `next` is called exactly once on every path.
  void Promise.resolve(loginLimiter.hit(key)).then(
    (result) => {
      res.setHeader("X-RateLimit-Limit", String(env.LOGIN_RATE_LIMIT_MAX));
      res.setHeader("X-RateLimit-Remaining", String(result.remaining));

      if (!result.allowed) {
        next(
          AppError.tooManyRequests(
            `Too many sign-in attempts. Try again in ${result.retryAfterSeconds} second(s).`,
            result.retryAfterSeconds,
          ),
        );
        return;
      }

      next();
    },
    (err: unknown) => {
      // Never fail a login because the limiter misbehaved.
      req.log?.error?.({ err }, "Rate limiter failed — allowing the attempt");
      next();
    },
  );
};