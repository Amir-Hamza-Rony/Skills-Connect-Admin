/**
 * Phase 5 migration script — idempotent index creation.
 *
 * Creates database indexes required by Phase 5 (Excel migration and reports).
 * Safe to run more than once: MongoDB createIndex is idempotent.
 *
 * Reads MONGODB_URI and MONGODB_DB from .env / environment. Never deletes or
 * modifies existing business records.
 *
 * Usage: node scripts/migrate-phase-5.mjs
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
  // Excel import collections
  { coll: "excel_import_templates", keys: { name: 1 }, unique: true, name: "uniq_excel_import_template_name" },
  { coll: "excel_imports", keys: { startedBy: 1 }, unique: false, name: "idx_excel_imports_startedBy" },
  { coll: "excel_imports", keys: { status: 1 }, unique: false, name: "idx_excel_imports_status" },
  { coll: "excel_imports", keys: { createdAt: -1 }, unique: false, name: "idx_excel_imports_createdAt" },
  { coll: "excel_import_rows", keys: { importId: 1 }, unique: false, name: "idx_excel_import_rows_importId" },
  { coll: "excel_import_rows", keys: { status: 1 }, unique: false, name: "idx_excel_import_rows_status" },

  // Report query performance indexes
  { coll: "orders", keys: { clientId: 1 }, unique: false, name: "idx_orders_clientId" },
  { coll: "orders", keys: { qualificationId: 1 }, unique: false, name: "idx_orders_qualificationId" },
  { coll: "orders", keys: { rtoId: 1 }, unique: false, name: "idx_orders_rtoId" },
  { coll: "orders", keys: { status: 1 }, unique: false, name: "idx_orders_status" },
  { coll: "orders", keys: { createdAt: -1 }, unique: false, name: "idx_orders_createdAt" },
  { coll: "invoices", keys: { orderId: 1 }, unique: false, name: "idx_invoices_orderId" },
  { coll: "invoices", keys: { status: 1 }, unique: false, name: "idx_invoices_status" },
  { coll: "invoices", keys: { createdAt: -1 }, unique: false, name: "idx_invoices_createdAt" },
  { coll: "invoices", keys: { currency: 1 }, unique: false, name: "idx_invoices_currency" },
  { coll: "payments", keys: { orderId: 1 }, unique: false, name: "idx_payments_orderId" },
  { coll: "payments", keys: { invoiceId: 1 }, unique: false, name: "idx_payments_invoiceId" },
  { coll: "payments", keys: { status: 1 }, unique: false, name: "idx_payments_status" },
  { coll: "payments", keys: { createdAt: -1 }, unique: false, name: "idx_payments_createdAt" },
  { coll: "commission_records", keys: { agentId: 1, periodMonth: 1, periodYear: 1 }, unique: true, name: "uniq_commission_records_agent_period" },
  { coll: "commission_payouts", keys: { commissionRecordId: 1 }, unique: false, name: "idx_commission_payouts_recordId" },
  { coll: "rto-processing", keys: { orderId: 1 }, unique: false, name: "idx_rto_processing_orderId" },
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
    console.log("Phase 5 migration complete.");
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
