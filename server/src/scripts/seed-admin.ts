/**
 * First-run seed (BACKEND-PLAN §2 `scripts/seed-admin.ts`).
 *
 * Creates the seven system roles and one Super Admin so a fresh Atlas database
 * can be signed into. Idempotent: re-running updates roles and leaves an
 * existing admin alone.
 *
 *   npm run server:seed
 *
 * Credentials come from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` /
 * `SEED_ADMIN_NAME` in `server/.env`. Never hard-code them here.
 */
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { connectDb, disconnectDb } from "../config/db.js";
import { env } from "../config/env.js";
import { hashPassword, PASSWORD_MIN_LENGTH } from "../lib/password.js";
import { logger } from "../lib/logger.js";
import { Role } from "../models/role.model.js";
import { User } from "../models/user.model.js";
import { recordAuditLog } from "../models/audit-log.model.js";
import {
  ROLE_DESCRIPTIONS,
  ROLE_NAMES,
  ROLE_PERMISSIONS,
} from "../services/permissions.js";

export async function seed(): Promise<{ roles: number; adminCreated: boolean }> {
  // Roles are system-owned: upsert so the matrix stays in step with the code.
  for (const name of ROLE_NAMES) {
    await Role.updateOne(
      { name },
      { $set: { description: ROLE_DESCRIPTIONS[name], permissions: [...ROLE_PERMISSIONS[name]] }, $setOnInsert: { isSystem: true } },
      { upsert: true },
    );
  }
  logger.info({ roles: ROLE_NAMES.length }, "Roles seeded");

  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    logger.warn(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — roles seeded, admin skipped.",
    );
    return { roles: ROLE_NAMES.length, adminCreated: false };
  }

  if (env.SEED_ADMIN_PASSWORD.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`SEED_ADMIN_PASSWORD must be at least ${PASSWORD_MIN_LENGTH} characters.`);
  }

  const email = env.SEED_ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email });
  if (existing) {
    logger.info({ email }, "Admin already exists — left untouched");
    return { roles: ROLE_NAMES.length, adminCreated: false };
  }

  const superAdmin = await Role.findOne({ name: "Super Admin" });
  if (!superAdmin) throw new Error("Super Admin role missing — cannot create the admin account.");

  const admin = await User.create({
    email,
    name: env.SEED_ADMIN_NAME ?? "Super Admin",
    phone: "",
    passwordHash: await hashPassword(env.SEED_ADMIN_PASSWORD),
    passwordChangedAt: new Date(),
    roleIds: [superAdmin._id],
    active: true,
  });

  // Audit the bootstrap itself — the first privileged account should be traceable.
  await recordAuditLog({
    actorId: admin._id,
    actorEmail: email,
    action: "user.seed_admin",
    entityType: "user",
    entityId: admin.id,
    after: { email, role: "Super Admin" },
  });

  logger.info({ email, id: admin.id }, "Super Admin created");
  return { roles: ROLE_NAMES.length, adminCreated: true };
}

/**
 * True when this file is the process entry point.
 *
 * Compared by basename on purpose: on Windows the repo path contains a space,
 * so `import.meta.url` percent-encodes it while `process.argv[1]` does not, and
 * a full-path comparison silently fails — the script would import fine and then
 * quietly do nothing.
 */
function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry === "") return false;
  try {
    return basename(entry) === basename(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/* Run directly: `npm run server:seed` */
if (invokedDirectly()) {
  void (async () => {
    await connectDb();
    try {
      const result = await seed();
      logger.info(result, "Seed complete");
    } finally {
      await disconnectDb();
    }
  })().catch((err: unknown) => {
    logger.fatal({ err }, "Seed failed");
    process.exit(1);
  });
}
