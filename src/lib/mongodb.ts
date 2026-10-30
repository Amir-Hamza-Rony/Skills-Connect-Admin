/**
 * MongoDB connection helper for Next.js API routes.
 *
 * Uses a single global connection so serverless function re-use doesn't open
 * a new database connection on every request.
 */

import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? "skills_connect_admin";

if (!uri) {
  throw new Error("MONGODB_URI environment variable is required.");
}

let client: MongoClient | null = null;
let db: Db | null = null;

if (process.env.NODE_ENV === "development") {
  // In dev, prevent multiple connections during hot reload.
  const globalWithMongo = global as typeof globalThis & {
    _mongoClient?: MongoClient;
    _mongoDb?: Db;
  };
  if (!globalWithMongo._mongoClient) {
    globalWithMongo._mongoClient = new MongoClient(uri);
    globalWithMongo._mongoDb = globalWithMongo._mongoClient.db(dbName);
  }
  client = globalWithMongo._mongoClient ?? null;
  db = globalWithMongo._mongoDb ?? null;
} else {
  client = new MongoClient(uri);
  db = client.db(dbName);
}

export async function connectDb(): Promise<Db> {
  if (!db) {
    if (!client) client = new MongoClient(uri!);
    await client.connect();
    db = client.db(dbName);
  }
  return db;
}

export { db, client };
export default db;
