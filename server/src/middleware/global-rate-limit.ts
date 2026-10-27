import type { RequestHandler } from "express";

import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { createSharedRateLimiter } from "../lib/rate-limit.js";

/**
 * Global API rate limit (BACKEND-PLAN §6, "login + global rate limits").
 *
 * ## Why the login limiter is not enough
 *
 * The login limiter is keyed by IP+email and only guards `POST /auth/login`.
 * Every other route was previously unthrottled, including the ones that are
 * expensive or have side effects — a `GET /orders` fan-out, or a
 * `qb.retry` that calls out to QuickBooks. One client with a bug loop could
 * saturate the API or burn the QuickBooks quota without ever touching login.
 *
 * ## Deliberately generous
 *
 * This is a backstop against runaway loops and obvious abuse, not a throttle on
 * legitimate use. The default allows 300 requests per minute per IP, which a
 * busy dashboard polling every few seconds never reaches. Tighten it per
 * environment via env rather than lowering the default and breaking the UI.
 *
 * ## Authenticated callers are keyed by user, not IP
 *
 * Keying only by IP punishes an office behind one NAT — every user would share
 * a single budget. Where a user id is available it becomes part of the key, so
 * one user's runaway loop cannot exhaust their colleagues' allowance.
 */

const globalLimiter = createSharedRateLimiter({
  windowMs: env.GLOBAL_RATE_LIMIT_WINDOW_MIN * 60 * 1000,
  max: env.GLOBAL_RATE_LIMIT_MAX,
});

/** Test seam so a suite can start each case with a clean counter. */
export function resetGlobalLimiter(): void {
  void globalLimiter.clearAll();
}

/**
 * Builds the limiter middleware.
 *
 * Mounted globally, before the routers — which means it runs *before*
 * `requireAuth`, so `req.auth` is not yet populated and requests are keyed by
 * IP. That is the nginx-style behaviour and is the right default here: the point
 * is a cheap backstop, and it must not be possible to skip by not being
 * authenticated. The `req.auth` branch is kept so the limiter can be mounted
 * after auth in future where a per-user budget is wanted.
 */
export function globalRateLimit(): RequestHandler {
  return (req, res, next) => {
    // Health checks are load-balancer probes, not client traffic. Throttling
    // them turns a traffic spike into an outage by making the balancer think
    // the instance is unhealthy.
    if (req.path === "/health" || req.path === "/health/ready") {
      next();
      return;
    }

    const userId = req.auth?.userId;
    const key = userId ? `u:${userId}` : `ip:${req.ip ?? "unknown"}`;

    void Promise.resolve(globalLimiter.hit(key)).then(
      (result) => {
        res.setHeader("X-RateLimit-Limit", String(env.GLOBAL_RATE_LIMIT_MAX));
        res.setHeader("X-RateLimit-Remaining", String(result.remaining));

        if (!result.allowed) {
          next(
            AppError.tooManyRequests(
              `Too many requests. Try again in ${result.retryAfterSeconds} second(s).`,
              result.retryAfterSeconds,
            ),
          );
          return;
        }
        next();
      },
      (err: unknown) => {
        // A limiter outage must not become an API outage.
        req.log?.error?.({ err }, "Global rate limiter failed — allowing the request");
        next();
      },
    );
  };
}