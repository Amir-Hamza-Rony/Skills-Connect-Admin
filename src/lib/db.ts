/**
 * MongoDB collection access for Next.js API routes.
 * Connects once and caches the db handle.
 */

import { MongoClient, ObjectId } from "mongodb";

let client: MongoClient | null = null;
let db: Awaited<ReturnType<MongoClient["db"]>> | null = null;

async function ensureClient(): Promise<MongoClient> {
  if (!client) {
    client = new MongoClient(process.env.MONGODB_URI!);
    await client.connect();
  }
  return client;
}

export async function getDb() {
  const c = await ensureClient();
  if (!db) db = c.db(process.env.MONGODB_DB ?? "skills_connect_admin");
  return db;
}

/** Returns the cached (and connected) MongoClient, usable for sessions/transactions. */
export async function getClient(): Promise<MongoClient> {
  return ensureClient();
}

/**
 * Gets a collection, ensuring the DB is connected first.
 * Returns `any` to avoid TypeScript strictness issues with Document types.
 */
export async function collection(name: string): Promise<any> {
  const d = await getDb();
  return d.collection(name);
}

export { ObjectId } from "mongodb";
export type { ObjectId as ObjectIdType } from "mongodb";

export function toObjectId(id: any) {
  return new ObjectId(String(id));
}

/**
 * Parse an id to ObjectId, returning `null` instead of throwing when the id is
 * malformed. Routes should use this and return 400 `INVALID_ID` on null.
 */
export function safeObjectId(id: any): import("mongodb").ObjectId | null {
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}