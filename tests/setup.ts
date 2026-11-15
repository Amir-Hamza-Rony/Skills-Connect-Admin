import fs from "fs";
import path from "path";
import { MongoMemoryReplSet } from "mongodb-memory-server";

/**
 * Load .env into process.env (vitest does not load it automatically) and
 * point the MongoDB client at a dedicated test database so tests never mutate
 * production data in `skills_connect_admin`.
 *
 * Always uses mongodb-memory-server (replica set) for local testing to avoid
 * the MongoDB Atlas 500-collection free-tier limit, to support MongoDB
 * transactions (commission payouts), and to never touch production data.
 * Any MONGODB_URI/MONGODB_DB from .env is overridden for the test run.
 */

let replSet: Awaited<ReturnType<typeof MongoMemoryReplSet.create>> | null = null;

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

process.env.NODE_ENV = "test";

// Always use a dedicated test database, never the production database.
process.env.MONGODB_DB = "skills_connect_admin_test";

// Always start an in-memory MongoDB replica set for tests so we never
// connect to Atlas (avoids the 500-collection free-tier limit) and never
// touch the production skills_connect_admin database.
if (!globalThis.__MONGODB_MEMORY_REPLSET__) {
  replSet = await MongoMemoryReplSet.create({
    replSet: {
      name: "rs0",
      dbName: "skills_connect_admin_test",
    },
  });
  globalThis.__MONGODB_MEMORY_REPLSET__ = replSet;
} else {
  replSet = globalThis.__MONGODB_MEMORY_REPLSET__;
}
const uri = replSet!.getUri("skills_connect_admin_test");
process.env.MONGODB_URI = uri;
