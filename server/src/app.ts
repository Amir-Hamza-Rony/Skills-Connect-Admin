import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-log.js";
import { healthRouter } from "./routes/health.js";

/**
 * Builds the Express app. Kept separate from `server.ts` so integration tests
 * can mount it without opening a port.
 *
 * Middleware order matters: security headers -> CORS -> body parsing -> request
 * logging -> routes -> not-found -> error handler.
 */
export function createApp(): Express {
  const app = express();

  if (env.TRUST_PROXY !== undefined) app.set("trust proxy", env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(helmet());

  app.use(
    cors({
      // Explicit allowlist — never reflect an arbitrary Origin header back.
      origin: env.CORS_ORIGINS,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT }));

  app.use(requestLogger);

  app.use(healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}