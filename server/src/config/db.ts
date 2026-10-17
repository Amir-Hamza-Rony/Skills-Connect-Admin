import mongoose from "mongoose";

import { env } from "./env.js";
import { logger } from "../lib/logger.js";

export type DbState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "disconnecting"
  | "uninitialized";

const READY_STATE: Record<number, DbState> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
  99: "uninitialized",
};

export function dbState(): DbState {
  return READY_STATE[mongoose.connection.readyState] ?? "uninitialized";
}

export function isDbConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Opens the Mongoose connection. Throws on failure — the server must not come
 * up pretending it has a database (BACKEND-PLAN B1 "done when: /health green").
 */
export async function connectDb(): Promise<void> {
  // Fail fast instead of silently buffering queries for 10s.
  mongoose.set("bufferCommands", false);
  mongoose.set("strictQuery", true);

  await mongoose.connect(env.MONGODB_URI, {
    dbName: env.MONGODB_DB,
    serverSelectionTimeoutMS: env.MONGODB_TIMEOUT_MS,
    maxPoolSize: 10,
    minPoolSize: 1,
    autoIndex: env.NODE_ENV !== "production",
  });

  logger.info({ db: env.MONGODB_DB }, "MongoDB connected");
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  logger.info("MongoDB disconnected");
}