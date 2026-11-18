/**
 * Phase 1 — M1.2 idempotent, index-only migration.
 *
 * Creates the schema/index foundation for the approved M1.2 types. Safe to run
 * more than once: MongoDB `createIndex` with a fixed name is idempotent.
 *
 * SAFETY GATE: before creating ANY index, this script checks for duplicate
 * non-empty string values in orders.enrollmentCode and clients.usiNumber. If
 * duplicates are found it reports every duplicated value and count and exits
 * without creating either unique partial index. It never inserts, updates,
 * deletes, merges, or normalizes existing records.
 *
 * Reads MONGODB_URI and MONGODB_DB from .env / environment. Not executed as
 * part of the M1.2 implementation; run manually only after authorization.
 *
 * Usage: node scripts/migrate-phase-1-m1.mjs
 */

import { MongoClient } from "mongodb";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

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

/**
 * Unique PARTIAL indexes (not sparse): only non-empty string values are
 * indexed. Missing, null, empty-string, and non-string legacy values are left
 * out of the index so they can never conflict. `sparse` is intentionally
 * absent — MongoDB forbids combining it with `partialFilterExpression`.
 */
export const M1_INDEXES = [
  {
    coll: "orders",
    keys: { enrollmentCode: 1 },
    options: {
      name: "uniq_orders_enrollment_code",
      unique: true,
      partialFilterExpression: {
        $and: [
          { enrollmentCode: { $type: "string" } },
          { enrollmentCode: { $gt: "" } },
        ],
      },
    },
  },
  { coll: "orders", keys: { bdc_id: 1 }, options: { name: "idx_orders_bdc_id", unique: false } },
  { coll: "orders", keys: { b2b_agent_id: 1 }, options: { name: "idx_orders_b2b_agent_id", unique: false } },
  { coll: "orders", keys: { channel_type: 1 }, options: { name: "idx_orders_channel_type", unique: false } },
  {
    coll: "clients",
    keys: { usiNumber: 1 },
    options: {
      name: "uniq_clients_usi_number",
      unique: true,
      partialFilterExpression: {
        $and: [
          { usiNumber: { $type: "string" } },
          { usiNumber: { $gt: "" } },
        ],
      },
    },
  },
  // B11: email remains non-unique until the legacy duplicate audit is approved.
  { coll: "clients", keys: { email: 1 }, options: { name: "idx_clients_email", unique: false } },
  { coll: "clients", keys: { referredByStudentId: 1 }, options: { name: "idx_clients_referred_by_student", unique: false } },
];

/** Fields protected by a unique partial index and therefore preflighted. */
export const UNIQUE_PARTIAL_TARGETS = [
  { coll: "orders", field: "enrollmentCode" },
  { coll: "clients", field: "usiNumber" },
];

/**
 * Return [{ value, count }] for values occurring more than once. Only
 * non-empty strings are considered — exactly the documents the unique partial
 * index would cover. Read-only aggregation; no writes.
 */
export async function findDuplicateNonEmptyStrings(db, collName, field) {
  const rows = await db.collection(collName).aggregate([
    { $match: { [field]: { $type: "string", $gt: "" } } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]).toArray();
  return rows.map((row) => ({ value: row._id, count: row.count }));
}

/** Run all duplicate checks before any index is created. */
export async function checkUniquePartialSafety(db) {
  const findings = [];
  for (const { coll, field } of UNIQUE_PARTIAL_TARGETS) {
    const duplicates = await findDuplicateNonEmptyStrings(db, coll, field);
    if (duplicates.length > 0) findings.push({ coll, field, duplicates });
  }
  return findings;
}

function reportDuplicates(findings) {
  console.error("Duplicate non-empty string values detected. No indexes were created.");
  console.error("Existing records were NOT modified, deleted, merged, or normalized.");
  console.error("Resolve the values below with explicit approval, then re-run this migration.");
  for (const { coll, field, duplicates } of findings) {
    console.error(`  ${coll}.${field}:`);
    for (const { value, count } of duplicates) {
      console.error(`    ${JSON.stringify(value)} — ${count} occurrences`);
    }
  }
}

export async function main() {
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    console.log(`Connected to database: ${dbName}`);

    // SAFETY GATE — all checks complete before ANY createIndex call.
    const findings = await checkUniquePartialSafety(db);
    if (findings.length > 0) {
      reportDuplicates(findings);
      process.exitCode = 1;
      return;
    }
    console.log("Duplicate preflight passed for orders.enrollmentCode and clients.usiNumber.");

    for (const { coll, keys, options } of M1_INDEXES) {
      await db.collection(coll).createIndex(keys, options);
      console.log(`Index ensured: ${coll}.${options.name} (unique=${options.unique === true})`);
    }
    console.log("M1.2 migration complete.");
  } finally {
    await client.close();
  }
}

// Only run when invoked directly as a script; importing for tests is inert.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  });
}
