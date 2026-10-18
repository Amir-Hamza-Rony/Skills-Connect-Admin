import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { globalRateLimit } from "./middleware/global-rate-limit.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { requestLogger } from "./middleware/request-log.js";
import { authRouter } from "./routes/auth.routes.js";
import { clientsRouter } from "./routes/clients.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";
import { healthRouter } from "./routes/health.js";
import {
  agentsRouter,
  qualificationsRouter,
  rtosRouter,
  supplierRoutesRouter,
} from "./routes/masters.routes.js";
import {
  financeRouter,
  invoicesRouter,
  paymentsRouter,
  plansRouter,
} from "./routes/finance.routes.js";
import { ordersRouter } from "./routes/orders.routes.js";
import { qbWebhookRouter, quickbooksRouter } from "./routes/quickbooks.routes.js";
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

  // The QuickBooks webhook signs the RAW request body, so this path must be
  // mounted with `express.raw()` BEFORE `express.json()`. Once the body is
  // parsed into an object, re-serialising it does not reproduce the exact bytes
  // Intuit signed and the HMAC can never match. Everything below gets the usual
  // JSON parsing.
  app.use("/integrations/quickbooks/webhook", express.raw({ type: "*/*", limit: "1mb" }), qbWebhookRouter);

  app.use(express.json({ limit: env.JSON_BODY_LIMIT }));
  app.use(express.urlencoded({ extended: false, limit: env.JSON_BODY_LIMIT }));
  app.use(cookieParser());

  app.use(requestLogger);

  // Backstop against runaway loops on any non-public route (§6). Mounted before
  // the routers so it also covers unauthenticated traffic; the per-route login
  // limiter stays in front of `POST /auth/login` as well.
  app.use(globalRateLimit());

  app.use(healthRouter);
  app.use("/auth", authRouter);
  app.use("/agents", agentsRouter);
  app.use("/clients", clientsRouter);
  app.use("/documents", documentsRouter);
  app.use("/finance", financeRouter);
  app.use("/invoices", invoicesRouter);
  app.use("/orders", ordersRouter);
  app.use("/payment-plans", plansRouter);
  app.use("/payments", paymentsRouter);
  app.use("/qualifications", qualificationsRouter);
  app.use("/rtos", rtosRouter);
  app.use("/supplier-routes", supplierRoutesRouter);
  app.use("/integrations/quickbooks", quickbooksRouter);
  app.use("/roles", rolesRouter);
  app.use("/users", usersRouter);
  app.use("/workflow", workflowRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}