/**
 * Transport-agnostic error carrying an HTTP status and a stable machine code.
 * Anything thrown that is NOT an AppError is treated as a bug and reported as
 * a generic 500 — internal messages never reach the client in production.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(code: string, message: string, details?: unknown): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = "Authentication required."): AppError {
    return new AppError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "You do not have permission to perform this action."): AppError {
    return new AppError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found."): AppError {
    return new AppError(404, "NOT_FOUND", message);
  }

  static conflict(message: string): AppError {
    return new AppError(409, "CONFLICT", message);
  }

  /** Semantic rejection — the request was understood but cannot be honoured. */
  static unprocessable(code: string, message: string, details?: unknown): AppError {
    return new AppError(422, code, message, details);
  }
}

/** Single response envelope so clients never have to guess the shape. */
export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}