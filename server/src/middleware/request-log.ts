import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { pinoHttp } from "pino-http";

import { logger } from "../lib/logger.js";

const MAX_INBOUND_ID = 100;

/**
 * Emits one structured line per request and assigns an `x-request-id` that is
 * echoed back to the caller and attached to every error body, so a user-reported
 * failure can be traced straight to a log line.
 */
export const requestLogger = pinoHttp({
  logger,
  genReqId: (req: IncomingMessage, res: ServerResponse) => {
    const header = req.headers["x-request-id"];
    const inbound = Array.isArray(header) ? header[0] : header;
    const id =
      typeof inbound === "string" && inbound.length > 0 && inbound.length <= MAX_INBOUND_ID
        ? inbound
        : randomUUID();
    res.setHeader("x-request-id", id);
    return id;
  },
  // Keep liveness probes out of the log stream so polling cannot drown it.
  autoLogging: {
    ignore: (req) => req.url === "/health" || req.url === "/health/ready",
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});