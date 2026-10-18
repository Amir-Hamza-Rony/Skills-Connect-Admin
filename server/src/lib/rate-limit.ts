import { getRedis } from "../config/redis.js";
import { logger } from "./logger.js";

/**
 * Fixed-window rate limiting.
 *
 * ## Redis-backed since B5
 *
 * Earlier phases used the in-process counters below, which kept one Node
 * process healthy but multiplied the effective limit by the replica count once
 * the API ran on more than one instance — four replicas allowed four times the
 * configured attempts. The counters now live in Redis, shared by every
 * instance, which is what makes the limit mean what it says.
 *
 * ## It still degrades rather than fails
 *
 * Redis needs Docker, which the dev machine does not have. Rather than making
 * rate limiting a boot requirement, `createSharedRateLimiter` transparently
 * falls back to the in-process counters when Redis is unreachable — including
 * when it goes down mid-request. The degraded mode is weaker but strictly
 * better than rejecting every login, and the log line says so.
 *
 * ## `hit` is awaited, not assumed synchronous
 *
 * The in-process limiter returns synchronously and the Redis one does not. Both
 * are typed as `RateLimitResult | Promise<RateLimitResult>` so the call sites
 * read the same either way.
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
  hit(key: string): RateLimitResult | Promise<RateLimitResult>;
  reset(key: string): void | Promise<void>;
  /** Test seam. */
  clearAll(): void | Promise<void>;
}

/** Namespaces counters so a limiter change cannot collide with another key. */
const KEY_PREFIX = "ratelimit";

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

/**
 * Redis-backed fixed window.
 *
 * `INCR` then `EXPIRE` only on the first hit is the standard idiom: the expiry
 * is set once per window, and a counter that somehow outlives it (a crashed
 * process between the two calls) self-heals because `pTTL` returning -1 is
 * treated as "no window", which resets it.
 */
function createRedisRateLimiter(options: {
  windowMs: number;
  max: number;
  fallback: RateLimiter;
}): RateLimiter {
  const windowSeconds = Math.max(1, Math.ceil(options.windowMs / 1000));

  return {
    async hit(key: string): Promise<RateLimitResult> {
      const redis = await getRedis();
      if (!redis) return options.fallback.hit(key) as RateLimitResult;

      const redisKey = `${KEY_PREFIX}:${key}`;
      try {
        const count = await redis.incr(redisKey);
        if (count === 1) await redis.expire(redisKey, windowSeconds);

        const ttl = await redis.pttl(redisKey);
        // -2: key gone. -1: no expiry (the crash case above). Either way the
        // window restarts rather than locking the key out forever.
        const effectiveTtl = ttl > 0 ? ttl : windowSeconds * 1000;
        if (ttl <= 0) await redis.expire(redisKey, windowSeconds);

        return {
          allowed: count <= options.max,
          remaining: Math.max(0, options.max - count),
          retryAfterSeconds: Math.max(1, Math.ceil(effectiveTtl / 1000)),
        };
      } catch (err) {
        // Redis went away mid-request. Degrade to the local counter rather than
        // failing the login outright.
        logger.warn({ err, key }, "Rate-limit backend unavailable — using in-process counters");
        return options.fallback.hit(key) as RateLimitResult;
      }
    },

    async reset(key: string): Promise<void> {
      const redis = await getRedis();
      if (redis) {
        try {
          await redis.del(`${KEY_PREFIX}:${key}`);
          return;
        } catch {
          // Fall through to the local reset.
        }
      }
      await options.fallback.reset(key);
    },

    async clearAll(): Promise<void> {
      await options.fallback.clearAll();
    },
  };
}

/**
 * The limiter every call site should use.
 *
 * Redis when it is reachable, the in-process counters when it is not, with no
 * change to the caller.
 */
export function createSharedRateLimiter(options: { windowMs: number; max: number }): RateLimiter {
  return createRedisRateLimiter({
    ...options,
    fallback: createRateLimiter(options),
  });
}