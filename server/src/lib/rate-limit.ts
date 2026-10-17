/**
 * In-process fixed-window rate limiter.
 *
 * SCOPE NOTE: this keeps a single Node process healthy. With more than one
 * instance (the staging/prod deploy), each process would keep its own counter
 * and the effective limit would multiply by the replica count. B5 swaps this for
 * a Redis-backed limiter using the already-provisioned `REDIS_URL`; the
 * interface below is deliberately small so that change is a single file.
 *
 * Deliberately dependency-free so B2 does not require Docker (Redis is not
 * installed on the dev machine yet).
 */

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. Sent as `Retry-After`. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  hit(key: string): RateLimitResult;
  reset(key: string): void;
  /** Test seam. */
  clearAll(): void;
}

export function createRateLimiter(options: { windowMs: number; max: number }): RateLimiter {
  const buckets = new Map<string, Bucket>();

  // Bounds memory if an attacker cycles through unique keys.
  const sweep = (): void => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  return {
    hit(key: string): RateLimitResult {
      const now = Date.now();
      if (buckets.size > 10_000) sweep();

      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + options.windowMs };
        buckets.set(key, bucket);
      }
      bucket.count += 1;

      const allowed = bucket.count <= options.max;
      return {
        allowed,
        remaining: Math.max(0, options.max - bucket.count),
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
      };
    },

    reset(key: string): void {
      buckets.delete(key);
    },

    clearAll(): void {
      buckets.clear();
    },
  };
}