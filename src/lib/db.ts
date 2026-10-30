/**
 * MongoDB collection access for Next.js API routes.
 * Connects once and caches the db handle.
 */

import { MongoClient, ObjectId } from "mongodb";

let client: MongoClient | null = null;
let db: Awaited<ReturnType<MongoClient["db"]>> | null = null;

export async function getDb() {
  if (!db) {
    if (!client) {
      client = new MongoClient(process.env.MONGODB_URI!);
      await client.connect();
    }
    db = client.db(process.env.MONGODB_DB ?? "skills_connect_admin");
  }
  return db;
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