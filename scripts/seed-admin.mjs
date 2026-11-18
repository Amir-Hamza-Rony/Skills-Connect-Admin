/**
 * Idempotent Super Admin seed script (Next.js layer).
 *
 * Replaces the Express-era `npm run server:seed` referenced in HANDOVER.md:
 * the `server/` directory no longer exists, but `.env` / `.env.example` still
 * define the documented first-run seed variables:
 *
 *   SEED_ADMIN_EMAIL    e.g. admin@skillsconnect.example
 *   SEED_ADMIN_PASSWORD 12+ character password (NEVER hardcoded here)
 *   SEED_ADMIN_NAME     display name, e.g. "Super Admin"
 *
 * Behaviour:
 * - Reads credentials from .env / environment only. Nothing is hardcoded and
 *   the password/hash is never printed or logged.
 * - Creates a unique index on `users.email` so duplicate admin accounts are
 *   impossible (createIndex is idempotent).
 * - If a user with SEED_ADMIN_EMAIL already exists, it does NOTHING to that
 *   user (no credential reset, no role change) and exits successfully.
 * - Otherwise inserts exactly one Super Admin user, hashed with argon2id via
 *   the same `argon2` package (and defaults) the API's `hashPassword` uses.
 * - Never deletes users, collections, or any other data.
 *
 * Usage: npm run seed:admin   (or: node scripts/seed-admin.mjs)
 */

import { MongoClient } from "mongodb";
import argon2 from "argon2";
import fs from "fs";
import path from "path";

const MIN_PASSWORD_LENGTH = 12; // matches .env.example guidance

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
const email = (process.env.SEED_ADMIN_EMAIL ?? "").toLowerCase().trim();
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const name = process.env.SEED_ADMIN_NAME?.trim() || "Super Admin";

if (!uri) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}
if (!email || !email.includes("@")) {
  console.error("SEED_ADMIN_EMAIL is missing or invalid in .env / environment.");
  process.exit(1);
}
if (!password) {
  console.error("SEED_ADMIN_PASSWORD is missing in .env / environment.");
  process.exit(1);
}
if (password.length < MIN_PASSWORD_LENGTH) {
  console.error(
    `SEED_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters (see .env.example).`,
  );
  process.exit(1);
}

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const users = db.collection("users");

    // Idempotent: guarantees at most one account per email at the database
    // level, so re-running this script can never create a duplicate admin.
    await users.createIndex({ email: 1 }, { unique: true, name: "uniq_user_email" });
    console.log(`Index ensured: users.uniq_user_email (unique)`);

    const existing = await users.findOne({ email });
    if (existing) {
      // Never touch an existing account: no password reset, no role overwrite.
      console.log(`Admin account already present: ${email} — nothing changed.`);
      console.log(`  active    : ${existing.active === undefined ? "(undefined)" : existing.active}`);
      console.log(`  roleNames : ${JSON.stringify(existing.roleNames ?? [])}`);
      console.log(`  hasPasswordHash: ${typeof existing.passwordHash === "string"}`);
      return;
    }

    // Same package and defaults as `hashPassword` in src/lib/api-auth.ts, so
    // `verifyPassword` (argon2.verify) accepts the seeded hash.
    const passwordHash = await argon2.hash(password);

    const now = new Date();
    // Document shape mirrors POST /api/users (src/app/api/users/route.ts).
    const result = await users.insertOne({
      email,
      name,
      phone: "",
      passwordHash,
      roleNames: ["SUPER_ADMIN"],
      active: true,
      failedLoginCount: 0,
      lockedUntil: null,
      createdAt: now,
      updatedAt: now,
    });

    console.log(`Super Admin seeded successfully.`);
    console.log(`  database : ${dbName}`);
    console.log(`  email     : ${email}`);
    console.log(`  name      : ${name}`);
    console.log(`  roleNames : ["Super Admin"]`);
    console.log(`  userId    : ${result.insertedId}`);
    console.log(`  (Password is NOT printed. Sign in with SEED_ADMIN_PASSWORD from .env.)`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  // Print only the error class/first line — URIs may embed credentials.
  const msg = String(err.message).split("\n")[0];
  console.error(`Seed failed: ${err.name}: ${msg}`);
  process.exit(1);
});
