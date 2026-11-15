/**
 * Idempotent master-data migration script.
 *
 * Creates the database indexes required by Phase 1 master data management.
 * Safe to run more than once: MongoDB `createIndex` is idempotent and will
 * not recreate an existing identical index.
 *
 * Reads MONGODB_URI and MONGODB_DB from .env / environment. Never deletes or
 * modifies existing business records.
 *
 * Usage: node scripts/migrate-master-data.mjs
 */

import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";

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

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB ?? "skills_connect_admin";

if (!uri) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

const indexes = [
  { coll: "qualifications", keys: { code: 1 }, unique: true, name: "uniq_qualification_code" },
  { coll: "rtos", keys: { rtoCode: 1 }, unique: true, name: "uniq_rto_code" },
  {
    coll: "agents",
    keys: { name: 1, contact: 1 },
    unique: true,
    name: "uniq_agent_name_contact",
  },
  {
    coll: "supplier-routes",
    keys: { qualificationId: 1, sourceAgentId: 1, rtoId: 1 },
    unique: false,
    name: "idx_supplier_route_triple",
  },
  {
    coll: "qualification-rto-mappings",
    keys: { qualificationId: 1, rtoId: 1 },
    unique: true,
    name: "uniq_qualification_rto_mapping",
  },
  {
    coll: "qualification-rto-mappings",
    keys: { qualificationId: 1 },
    unique: false,
    name: "idx_mapping_qualification",
  },
  {
    coll: "qualification-rto-mappings",
    keys: { rtoId: 1 },
    unique: false,
    name: "idx_mapping_rto",
  },
];

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    console.log(`Connected to database: ${dbName}`);
    for (const { coll, keys, unique, name } of indexes) {
      await db.collection(coll).createIndex(keys, { unique, name });
      console.log(`Index ensured: ${coll}.${name} (unique=${unique})`);
    }
    console.log("Migration complete.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
