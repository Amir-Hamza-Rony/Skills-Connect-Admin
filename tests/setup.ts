import fs from "fs";
import path from "path";
import { randomUUID } from "node:crypto";
import { inject } from "vitest";

/**
 * Load .env into process.env (vitest does not load it automatically) and
 * point the MongoDB client at a dedicated test database so tests never mutate
 * production data in `skills_connect_admin`.
 *
 * The in-memory replica set is started once by `tests/global-setup.ts` and its
 * URI is shared with every test worker through Vitest's `provide`/`inject`.
 * Each test file gets a unique database name on that shared replica set, which
 * keeps files isolated without starting a separate mongod per worker.
 * Global teardown awaits `stop()` so temporary MongoDB files are removed after
 * the whole test run instead of being left behind per worker.
 */

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

const uri = inject("mongoMemoryServerUri");
if (!uri) {
  throw new Error("MongoDB Memory Server URI was not provided by globalSetup");
}

const workerId = process.env.VITEST_WORKER_ID ?? "0";
const uniqueSuffix = `${process.pid.toString(36)}_${randomUUID().slice(0, 8)}`;

// Always use a dedicated, per-test-file database; never the production DB.
// MongoDB limits database names to 63 characters, so keep this prefix short.
process.env.MONGODB_DB = `sca_test_w${workerId}_${uniqueSuffix}`;
process.env.MONGODB_URI = uri;
