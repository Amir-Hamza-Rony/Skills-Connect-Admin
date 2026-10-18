import { Worker, type Job } from "bullmq";

import { getQueueRedis } from "../config/redis.js";
import { logger } from "../lib/logger.js";
import { processSyncRecord } from "../services/qb-sync.service.js";
import { QB_SYNC_QUEUE, type QBSyncJobData } from "./qb-sync.queue.js";

/**
 * The QuickBooks sync worker (BACKEND-PLAN §2 `jobs/`).
 *
 * ## Started only when Redis is present
 *
 * Without Redis there is nothing to poll, and the queue module already falls
 * back to running jobs inline. `startQBWorker()` returns `null` in that case
 * rather than throwing, so `server.ts` boots unchanged on a machine with no
 * Docker — the same "degrade, do not fail" rule the queue itself follows.
 *
 * ## Failure is data, not an exception
 *
 * `processSyncRecord` records the failure on the sync record and resolves.
 * Rethrowing here would make BullMQ retry with backoff, which is only useful
 * for infrastructure blips. QuickBooks refusing an unlinked client is not
 * going to fix itself on attempt 3, and retrying it would hammer their API for
 * a problem only a human can resolve.
 */

let worker: Worker<QBSyncJobData> | null = null;

export async function startQBWorker(): Promise<Worker<QBSyncJobData> | null> {
  const redis = await getQueueRedis();
  if (!redis) {
    logger.info("No Redis — QB sync runs inline instead of via a worker");
    return null;
  }
  if (worker) return worker;

  worker = new Worker<QBSyncJobData>(
    QB_SYNC_QUEUE,
    async (job: Job<QBSyncJobData>) => {
      const { recordId, entityType, entityId } = job.data;
      logger.info({ recordId, entityType, entityId, attempt: job.attemptsMade + 1 }, "QB sync job");

      const result = await processSyncRecord(recordId);
      if (!result.ok) {
        // Recorded, not thrown — see the note above.
        logger.warn(
          { recordId, entityType, entityId, error: result.error },
          "QB sync attempt failed",
        );
      }
    },
    // A constructed ioredis client, not connection options — BullMQ cannot
    // build its own client from options in native ESM.
    { connection: redis, concurrency: 4 },
  );

  worker.on("failed", (job, err) => {
    logger.error({ err, jobId: job?.id }, "QB sync job failed");
  });

  worker.on("error", (err) => {
    logger.error({ err }, "QB sync worker error");
  });

  logger.info({ queue: QB_SYNC_QUEUE, concurrency: 4 }, "QB sync worker started");
  return worker;
}

/** Stops the worker on shutdown. Safe when it never started. */
export async function closeQBWorker(): Promise<void> {
  if (!worker) return;
  try {
    await worker.close();
  } catch (err) {
    logger.warn({ err }, "Error while closing the QB worker");
  } finally {
    worker = null;
  }
}

/** True when a worker is polling. Reported by the health endpoint. */
export function isWorkerRunning(): boolean {
  return worker !== null;
}
