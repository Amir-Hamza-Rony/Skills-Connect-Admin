/**
 * Idempotent RBAC permission synchronization script.
 *
 * Permissions are derived from `ROLE_PERMISSIONS[role]` at login time and
 * embedded in the JWT access token — they are NOT stored per-user in the
 * database. Consequently there is no per-user permission table to sync.
 *
 * This script performs two safe, idempotent repairs:
 *
 * 1. Role-name normalization — the seed script previously wrote
 *    `roleNames: ["Super Admin"]` (invalid casing). Any existing user record
 *    whose `roleNames` contains a non-standard role name is normalized to the
 *    canonical `RoleName` values so that future logins produce correct tokens
 *    and the server-side SUPER_ADMIN bypass matches.
 *
 * 2. SUPER_ADMIN role-name backfill — any user whose `role` field is
 *    `SUPER_ADMIN` but whose `roleNames` array does not contain "SUPER_ADMIN"
 *    gets "SUPER_ADMIN" appended to `roleNames`.
 *
 * Neither operation touches passwords, password hashes, or any field other
 * than `roleNames`. Both are idempotent: re-running changes nothing after the
 * first successful pass.
 *
 * Usage: node scripts/sync-rbac-permissions.mjs
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

// Canonical RoleName values, in priority order.
const ROLE_NAME_NORMALIZATION: Record<string, string> = {
  "super admin": "SUPER_ADMIN",
  "super_admin": "SUPER_ADMIN",
  "Super Admin": "SUPER_ADMIN",
  "SUPER ADMIN": "SUPER_ADMIN",
  admin: "ADMIN",
  bdc: "BDC",
  "b2b_agent": "B2B_AGENT",
  "b2b agent": "B2B_AGENT",
};

const CANONICAL_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "BDC",
  "B2B_AGENT",
]);

async function main() {
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    const users = db.collection("users");

    let scanned = 0;
    let normalized = 0;
    let backfilled = 0;

    const cursor = users.find({});
    while (await cursor.hasNext()) {
      const user = await cursor.next();
      if (!user) break;
      scanned += 1;

      const updates: Record<string, unknown> = {};
      const roleNames: string[] = Array.isArray(user.roleNames)
        ? user.roleNames.map(String)
        : [];

      // 1. Normalize any non-canonical role names.
      const normalizedNames = roleNames.map((rn) => {
        const key = rn.trim();
        return ROLE_NAME_NORMALIZATION[key] ?? key;
      });
      const deduped = [...new Set(normalizedNames)];
      if (JSON.stringify(deduped) !== JSON.stringify(roleNames)) {
        updates.roleNames = deduped;
        normalized += 1;
      }

      // 2. SUPER_ADMIN backfill: ensure roleNames contains "SUPER_ADMIN".
      const role = String(user.role ?? "");
      if (role === "SUPER_ADMIN" && !deduped.includes("SUPER_ADMIN")) {
        updates.roleNames = [...deduped, "SUPER_ADMIN"];
        backfilled += 1;
      }

      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date();
        await users.updateOne({ _id: user._id }, { $set: updates });
      }
    }

    console.log("RBAC permission sync complete.");
    console.log(`  users scanned   : ${scanned}`);
    console.log(`  roleNames normalized : ${normalized}`);
    console.log(`  SUPER_ADMIN backfilled : ${backfilled}`);
    console.log(`  No permissions, password hashes, or credentials were modified.`);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  const msg = String(err.message).split("\n")[0];
  console.error(`Sync failed: ${err.name}: ${msg}`);
  process.exit(1);
});
