import { createServer } from "node:http";

import { createApp } from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { closeRedis } from "./config/redis.js";
import { closeQBQueue } from "./jobs/qb-sync.queue.js";
import { closeQBWorker, startQBWorker } from "./jobs/qb-sync.worker.js";
import { startOverdueSweep } from "./jobs/overdue.job.js";
import { logger } from "./lib/logger.js";

/** Hard cap so a stuck socket cannot block the shutdown forever. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  // Fail fast: an API without a database is worse than no API at all.
  await connectDb();

  // Started after the database and before the listener: a job that starts
  // polling must be able to read its record. Returns null without Redis, in
  // which case the queue module runs those jobs inline instead.
  await startQBWorker();

  // Invoices and instalments go overdue by the calendar passing, not by
  // anything happening in the application, so this cannot be event-driven.
  const stopOverdueSweep = startOverdueSweep();

  const server = createServer(createApp());

  await new Promise<void>((resolve) => {
    server.listen(env.PORT, env.HOST, () => {
      logger.info(
        { host: env.HOST, port: env.PORT, db: env.MONGODB_DB, env: env.NODE_ENV },
        "API listening",
      );
      resolve();
    });
  });

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutdown requested — draining");

    stopOverdueSweep();

    const timer = setTimeout(() => {
      logger.error("Forced exit: shutdown timed out");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    server.close((err) => {
      if (err) logger.error({ err }, "Error while closing HTTP server");
      // Order matters: stop taking new jobs, then drain the worker, then the
      // queue, then Redis, then the database. A worker shut down after its
      // connection would log a connection error for every in-flight job.
      void (async () => {
        await closeQBWorker();
        await closeQBQueue();
        await closeRedis();
        await disconnectDb();
      })()
        .catch((shutdownErr: unknown) => {
          logger.error({ err: shutdownErr }, "Error during shutdown");
        })
        .finally(() => {
          clearTimeout(timer);
          process.exit(err ? 1 : 0);
        });
    });
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  process.on("unhandledRejection", (reason) => {
    logger.fatal({ reason }, "Unhandled promise rejection");
    shutdown("SIGTERM");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
    shutdown("SIGTERM");
  });
}

main().catch((err: unknown) => {
  logger.fatal(
    { err },
    env.NODE_ENV === "production" ? "Server failed to start" : (err as Error)?.message,
  );
  process.exit(1);
});