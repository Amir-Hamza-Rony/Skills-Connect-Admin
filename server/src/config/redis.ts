import { Redis, type RedisOptions } from "ioredis";

import { env } from "./env.js";
import { logger } from "../lib/logger.js";

/**
 * Redis clients for the B5 queue and the rate limiter (BACKEND-PLAN §2 `config/redis.ts`).
 *
 * ## Why ioredis and not `redis`
 *
 * BullMQ requires an ioredis-compatible client and rejects `node-redis`
 * outright ("could not load the optional 'ioredis' package"). Passing
 * connection *options* rather than a constructed client does not help in native
 * ESM. The first version of this file used `node-redis`, so the whole BullMQ
 * path — worker startup, enqueue — would have thrown the moment Docker came up.
 * The test suite never caught it because it always ran with Redis absent and
 * fell back to inline execution; `npm run server:verify:queue` caught it.
 *
 * ## Why there are two clients
 *
 * BullMQ demands `maxRetriesPerRequest: null`, because a worker blocks on
 * commands that legitimately wait forever. The rate limiter needs the opposite:
 * a bounded retry, so a Redis stall inside `POST /auth/login` fails fast into
 * the in-process fallback instead of hanging the request. One client cannot be
 * both, so the queue gets its own.
 *
 * ## Redis is optional, and that is deliberate
 *
 * Redis needs Docker, which is not always running. A missing queue must not
 * stop the API serving finance traffic, so this module never throws at import
 * time and never blocks boot: connections are attempted lazily and callers fall
 * back to inline execution.
 *
 * ## Timeouts are short on purpose
 *
 * `connectTimeout` is a few hundred milliseconds because `queueSync` runs
 * inside `POST /invoices` — a slow connect would turn a Redis outage into a
 * slow API. A brief attempt, then fall back.
 */

const CONNECT_TIMEOUT_MS = 500;
/** Commands (rate limiting) must not retry forever; the fallback is better. */
const COMMAND_RETRIES = 1;

function parseRedisUrl(url: string): { host: string; port: number } {
  // The scheme must be stripped *before* splitting on ":", otherwise
  // `redis://localhost:6379`.split(":")[1] is "//localhost" and the port comes
  // out NaN — which is the bug this helper replaced.
  const withoutScheme = url.replace(/^rediss?:\/\//, "");
  const [host, portPart] = withoutScheme.split(":");
  const port = Number(portPart ?? 6379);
  return {
    host: host || "127.0.0.1",
    port: Number.isFinite(port) ? port : 6379,
  };
}

export { parseRedisUrl };

/** Shared shape: connect once, remember failure, never block boot. */
function lazyClient(kind: "commands" | "queue") {
  let client: Redis | null = null;
  let connecting: Promise<Redis | null> | null = null;
  let unreachable = false;

  const build = (): Redis => {
    const options: RedisOptions = {
      ...parseRedisUrl(env.REDIS_URL),
      connectTimeout: CONNECT_TIMEOUT_MS,
      // BullMQ blocks on commands that must wait indefinitely, so it requires
      // this to be null; ordinary commands need the opposite or a Redis stall
      // would hang the request instead of falling back.
      maxRetriesPerRequest: kind === "queue" ? null : COMMAND_RETRIES,
      // Bounded, so an outage degrades to the fallback instead of hanging.
      retryStrategy: (times: number) => (times > 2 ? null : Math.min(times * 100, 500)),
      lazyConnect: true,
    };

    const c = new Redis(options);
    // Without a listener, an error event takes the process down. Every failure
    // here is expected and handled.
    c.on("error", (err: unknown) => {
      logger.warn({ kind, err: (err as Error)?.message }, "Redis client error");
    });
    return c;
  };

  const connect = async (): Promise<Redis | null> => {
    if (client && client.status === "ready") return client;
    if (unreachable) return null;
    if (connecting) return connecting;

    connecting = (async () => {
      try {
        const c = client ?? build();
        client = c;
        await c.connect();
        logger.info({ redis: env.REDIS_URL, kind }, "Redis connected");
        return c;
      } catch (err) {
        unreachable = true;
        logger.warn(
          { kind, err: (err as Error)?.message, redis: env.REDIS_URL },
          "Redis unavailable — running the QB queue inline",
        );
        return null;
      } finally {
        connecting = null;
      }
    })();

    return connecting;
  };

  const reset = (): void => {
    client = null;
    connecting = null;
    unreachable = false;
  };

  const close = async (): Promise<void> => {
    if (!client) return;
    try {
      if (client.status !== "end") await client.quit();
    } catch (err) {
      logger.warn({ kind, err: (err as Error)?.message }, "Error while closing Redis");
    } finally {
      client = null;
      unreachable = false;
    }
  };

  const isReady = (): boolean => client?.status === "ready";

  return { connect, reset, close, isReady };
}

const commands = lazyClient("commands");
const queue = lazyClient("queue");

/** Bounded client for ordinary commands — the rate limiter. */
export const getRedis = commands.connect;

/** Dedicated client for BullMQ, which requires `maxRetriesPerRequest: null`. */
export const getQueueRedis = queue.connect;

/** True when a job can be handed to Redis. Cheap and non-blocking. */
export function isQueueAvailable(): boolean {
  return queue.isReady();
}

/** Test seam — resets module state so a suite can re-evaluate availability. */
export function resetRedisState(): void {
  commands.reset();
  queue.reset();
}

/** Closes both connections on shutdown. Safe when never connected. */
export async function closeRedis(): Promise<void> {
  await Promise.allSettled([commands.close(), queue.close()]);
}