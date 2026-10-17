import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-log.js";
import { authRouter } from "./routes/auth.routes.js";
import { clientsRouter } from "./routes/clients.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";
import { healthRouter } from "./routes/health.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { rolesRouter } from "./routes/roles.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { workflowRouter } from "./routes/workflow.routes.js";

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
      // Required so the httpOnly refresh cookie travels with cross-origin calls.
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.use(requestLogger);

  app.use(healthRouter);
  app.use("/auth", authRouter);
  app.use("/clients", clientsRouter);
  app.use("/documents", documentsRouter);
  app.use("/orders", ordersRouter);
  app.use("/roles", rolesRouter);
  app.use("/users", usersRouter);
  app.use("/workflow", workflowRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}