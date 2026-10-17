import type { RequestHandler } from "express";

import { AppError } from "../lib/app-error.js";

/** Catch-all for unmatched routes; runs before `errorHandler`. */
export const notFoundHandler: RequestHandler = (req) => {
  throw AppError.notFound(`No route matches ${req.method} ${req.originalUrl}.`);
};