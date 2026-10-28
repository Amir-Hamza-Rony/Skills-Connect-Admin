/**
 * Skills Connect Admin — Background Worker (BullMQ + overdue sweep).
 *
 * Use this as the start command for a Render "Background Worker" (or any
 * worker service). It connects to MongoDB + Redis, starts the QB sync worker
 * and the hourly overdue sweep, and does NOT start an HTTP server.
 *
 * Deploy separately from the web service so background jobs stay alive
 * 24/7 (serverless platforms like Vercel cannot run long-lived workers).
 *
 * Required env vars: MONGODB_URI, REDIS_URL, NODE_ENV=production,
 * COOKIE_SECURE=true, plus all JWT / rate-limit / QuickBooks vars.
 */

import { connectDb, disconnectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { closeRedis } from "./config/redis.js";
import { closeQBQueue } from "./jobs/qb-sync.queue.js";
import { closeQBWorker, startQBWorker } from "./jobs/qb-sync.worker.js";
import { startOverdueSweep } from "./jobs/overdue.job.js";
import { logger } from "./lib/logger.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  await connectDb();

  await startQBWorker();
  const stopOverdueSweep = startOverdueSweep();

  logger.info("Background worker started — QB worker + overdue sweep active");

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Worker shutdown requested — draining");

    stopOverdueSweep();

    const timer = setTimeout(() => {
      logger.error("Forced exit: worker shutdown timed out");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    void (async () => {
      await closeQBWorker();
      await closeQBQueue();
      await closeRedis();
      await disconnectDb();
    })()
      .catch((shutdownErr: unknown) => {
        logger.error({ err: shutdownErr }, "Error during worker shutdown");
      })
      .finally(() => {
        clearTimeout(timer);
        process.exit(0);
      });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled promise rejection in worker");
    shutdown("SIGTERM");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception in worker");
    shutdown("SIGTERM");
  });
}

main().catch((err: unknown) => {
  logger.fatal(
    { err },
    env.NODE_ENV === "production" ? "Worker failed to start" : (err as Error)?.message,
  );
  process.exit(1);
});
