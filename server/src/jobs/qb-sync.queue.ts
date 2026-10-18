import { Queue, type JobsOptions } from "bullmq";

import { env } from "../config/env.js";
import { getQueueRedis, isQueueAvailable } from "../config/redis.js";
import { logger } from "../lib/logger.js";

/**
 * The QuickBooks sync queue (BACKEND-PLAN §2 `jobs/`).
 *
 * ## Idempotency is enforced twice, deliberately
 *
 * 1. **In MongoDB** — `QBSyncRecord.idempotencyKey` is unique, so one entity
 *    maps to exactly one record no matter how the job is retried.
 * 2. **In Redis** — the BullMQ `jobId` is that same key, so a re-enqueued job
 *    for an entity already waiting is deduplicated by the queue rather than
 *    executed twice.
 *
 * Together they mean a duplicated request, a redelivered job and an operator
 * hammering "retry" all converge on one QuickBooks record.
 *
 * ## Inline fallback
 *
 * Redis needs Docker, which the dev machine does not have. Rather than making
 * the queue a hard dependency, `enqueueQBSync` runs the handler inline when
 * Redis is absent. The sync is slower (it holds the request open) but correct,
 * and the same handler runs either way — so the fallback cannot drift from the
 * queued path.
 */

export const QB_SYNC_QUEUE = "qb-sync";

export interface QBSyncJobData {
  recordId: string;
  entityType: "invoice" | "payment";
  entityId: string;
  /** The stable key, reused as the BullMQ jobId. */
  idempotencyKey: string;
}

let queue: Queue<QBSyncJobData> | null = null;

/** Exponential backoff, capped — a QB outage should not spin the worker. */
const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: 100,
  removeOnFail: 500,
};

/**
 * Returns the queue, or `null` when Redis is not available.
 *
 * Separate from `enqueueQBSync` so a caller that wants to know "is this
 * queued or inline?" can ask without triggering the work.
 */
export async function getQBQueue(): Promise<Queue<QBSyncJobData> | null> {
  const redis = await getQueueRedis();
  if (!redis) return null;

  if (queue) return queue;

  queue = new Queue<QBSyncJobData>(QB_SYNC_QUEUE, {
    connection: redis,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  queue.on("error", (err) => {
    logger.warn({ err }, "QB sync queue error");
  });

  logger.info({ queue: QB_SYNC_QUEUE }, "QB sync queue ready");
  return queue;
}

/** True when jobs will be handled by a worker rather than inline. */
export function isQueueReady(): boolean {
  return isQueueAvailable() && queue !== null;
}

/**
 * Queues a sync attempt.
 *
 * `inline` is the handler to run when Redis is unavailable. It is a parameter
 * rather than an import so this module stays free of a dependency on the sync
 * service, which in turn depends on the job handler — importing it here would
 * be a cycle.
 *
 * Returns how the work was scheduled so the caller can report it.
 */
export async function enqueueQBSync(
  data: QBSyncJobData,
  inline: () => Promise<unknown>,
): Promise<{ queued: boolean; reason?: string }> {
  const q = await getQBQueue();
  if (!q) {
    // Redis is down or absent. Run it now rather than dropping the sync — an
    // unsynced invoice is a bigger problem than a slow request.
    try {
      await inline();
      return { queued: false };
    } catch (err) {
      logger.error({ err, entityId: data.entityId }, "Inline QB sync threw");
      return { queued: false, reason: "inline sync failed" };
    }
  }

  try {
    // The same jobId for the same entity: BullMQ will not enqueue a duplicate
    // while the original is still waiting.
    await q.add("sync", data, { jobId: data.idempotencyKey });
    return { queued: true };
  } catch (err) {
    logger.error({ err, entityId: data.entityId }, "Could not enqueue QB sync — running inline");
    await inline();
    return { queued: false, reason: "enqueue failed, ran inline" };
  }
}

/** Closes the queue on shutdown. Safe when it was never created. */
export async function closeQBQueue(): Promise<void> {
  if (!queue) return;
  try {
    await queue.close();
  } catch (err) {
    logger.warn({ err }, "Error while closing the QB queue");
  } finally {
    queue = null;
  }
}

/** Queue depth, for the health endpoint and the sync screen. */
export async function queueDepth(): Promise<{ waiting: number; active: number; failed: number } | null> {
  const q = await getQBQueue();
  if (!q) return null;
  const counts = await q.getJobCounts("waiting", "active", "failed");
  return { waiting: counts.waiting ?? 0, active: counts.active ?? 0, failed: counts.failed ?? 0 };
}

/** Re-exported so the worker and server boot agree on the connection source. */
export { env as queueEnv };
