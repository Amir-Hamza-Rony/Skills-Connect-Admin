import { Router } from "express";

import { dbState, isDbConnected } from "../config/db.js";
import { env } from "../config/env.js";
import { SERVICE_NAME, VERSION } from "../lib/version.js";

export const healthRouter: Router = Router();

/**
 * GET /health — liveness. Always answers if the process is running, so a
 * container probe cannot be killed merely because the database is briefly
 * unreachable.
 */
healthRouter.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: SERVICE_NAME,
    version: VERSION,
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    db: dbState(),
  });
});

/**
 * GET /health/ready — readiness. 503 until the database is actually reachable,
 * so a rolling deploy never sends traffic to a process without MongoDB.
 */
healthRouter.get("/health/ready", (_req, res) => {
  const state = dbState();
  if (!isDbConnected()) {
    res.status(503).json({ status: "not_ready", service: SERVICE_NAME, db: state });
    return;
  }
  res.json({ status: "ready", service: SERVICE_NAME, db: state });
});