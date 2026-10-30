/**
 * In-memory fixed-window rate limiter for Next.js API routes.
 *
 * Used on POST /api/auth/login to slow password-spraying and brute-force
 * attempts before any database work happens. Keyed by IP + email so one
 * attacker behind a shared NAT cannot lock out an entire office.
 *
 * This is intentionally in-memory (no Redis dependency in the Next.js
 * process). For multi-instance deployments, back this with Redis or use the
 * Express backend's login rate limiter.
 */

interface Window {
  hits: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

function now(): number {
  return Date.now();
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
}) {
  const { windowMs, max } = options;

  return {
    hit(key: string): RateLimitResult {
      const n = now();
      let w = windows.get(key);
      if (!w || n >= w.resetAt) {
        w = { hits: 0, resetAt: n + windowMs };
        windows.set(key, w);
      }
      w.hits += 1;

      const remaining = Math.max(0, max - w.hits);
      const retryAfterSeconds = Math.ceil((w.resetAt - n) / 1000);

      return {
        allowed: w.hits <= max,
        remaining,
        retryAfterSeconds: remaining <= 0 ? retryAfterSeconds : 0,
      };
    },

    clearAll(): void {
      windows.clear();
    },
  };
}

export function rateLimitKey(req: { ip?: string | null; body?: unknown }): string {
  const email =
    typeof req.body === "object" && req.body !== null && "email" in req.body
      ? String((req.body as { email?: unknown }).email ?? "unknown").trim().toLowerCase()
      : "unknown";
  return `${req.ip ?? "unknown"}|${email}`;
}
