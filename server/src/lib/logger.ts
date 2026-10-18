import pino from "pino";

import { env } from "../config/env.js";

/**
 * Structured JSON logger.
 *
 * `redact` is a hard requirement from architecture.md §4 — credentials,
 * cookies and connection strings must never reach a log sink, including
 * inside request logs. New secret-bearing fields must be added here.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "skills-connect-admin-api" },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers[\"set-cookie\"]",
      "*.password",
      "*.passwordHash",
      "*.accessToken",
      "*.refreshToken",
      "*.token",
      "*.secret",
      "*.mongodbUri",
      "config.mongodbUri",
    ],
    censor: "[REDACTED]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});