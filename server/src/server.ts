import { createServer } from "node:http";

import { createApp } from "./app.js";
import { connectDb, disconnectDb } from "./config/db.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

/** Hard cap so a stuck socket cannot block the shutdown forever. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  // Fail fast: an API without a database is worse than no API at all.
  await connectDb();

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

    const timer = setTimeout(() => {
      logger.error("Forced exit: shutdown timed out");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();

    server.close((err) => {
      if (err) logger.error({ err }, "Error while closing HTTP server");
      void disconnectDb().finally(() => {
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