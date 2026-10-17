import mongoose from "mongoose";
import { ZodError } from "zod";

import { AppError, type ErrorBody } from "../lib/app-error.js";
import { logger } from "../lib/logger.js";
import { env } from "../config/env.js";
import type { ErrorRequestHandler, Request, Response } from "express";

/** Pulls the id attached by `request-log` so the client can quote it. */
function requestIdOf(req: Request): string | undefined {
  const id: unknown = (req as Request & { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}

function send(res: Response, status: number, body: ErrorBody): void {
  res.status(status).json(body);
}

/**
 * Terminal error middleware (Express 5 forwards rejected async handlers here
 * automatically, so throwing inside a route is enough).
 *
 * Order of checks: known operational errors first, then library-specific
 * validation errors, then an opaque 500. An unexpected error is logged in full
 * server-side and never echoed to the caller in production.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = requestIdOf(req);

  // 1. Deliberate, client-facing failures.
  if (err instanceof AppError) {
    logger.warn(
      { requestId, code: err.code, status: err.status, path: req.originalUrl },
      err.message,
    );
    send(res, err.status, {
      error: { code: err.code, message: err.message, details: err.details, requestId },
    });
    return;
  }

  // 2. Request-body / query validation.
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    logger.warn({ requestId, path: req.originalUrl }, "Validation failed");
    send(res, 400, {
      error: { code: "VALIDATION_ERROR", message: "Request validation failed.", details, requestId },
    });
    return;
  }

  // 3. Malformed JSON body.
  if (err instanceof SyntaxError && "type" in err && err.type === "entity.parse.failed") {
    logger.warn({ requestId, path: req.originalUrl }, "Malformed JSON body");
    send(res, 400, {
      error: { code: "MALFORMED_JSON", message: "Request body is not valid JSON.", requestId },
    });
    return;
  }

  // 4. Mongoose schema validation / bad ObjectId.
  if (err instanceof mongoose.Error.ValidationError) {
    const details = Object.entries(err.errors).map(([field, issue]) => ({
      path: field,
      message: issue.message,
    }));
    logger.warn({ requestId, path: req.originalUrl }, "Mongoose validation failed");
    send(res, 400, {
      error: { code: "VALIDATION_ERROR", message: "Document validation failed.", details, requestId },
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    logger.warn({ requestId, path: req.originalUrl }, `Mongoose cast error on ${err.path}`);
    send(res, 400, {
      error: {
        code: "INVALID_IDENTIFIER",
        message: `\`${err.path}\` is not a valid ${err.kind}.`,
        requestId,
      },
    });
    return;
  }

  // 5. Unknown — log everything, reveal nothing.
  logger.error(
    { requestId, path: req.originalUrl, method: req.method, err },
    "Unhandled error",
  );
  send(res, 500, {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      ...(env.NODE_ENV === "production" ? {} : { details: err instanceof Error ? err.message : String(err) }),
      requestId,
    },
  });
};