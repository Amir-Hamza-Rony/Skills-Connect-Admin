import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

import type { RoleLean } from "../../src/models/role.model.js";

/**
 * Integration harness for B2 (BACKEND-PLAN §7).
 *
 * Auth is the one area where mocks would prove nothing: rotation chains,
 * reuse detection and argon2 hashing all need real behaviour. So these suites
 * run against a real MongoDB (in-memory) with the real Mongoose models — no
 * stubbing of the database layer.
 */

let mongo: MongoMemoryServer | undefined;

export async function startTestDb(): Promise<string> {
  mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri();
  mongoose.set("bufferCommands", false);
  await mongoose.connect(uri, { dbName: "sc_test" });
  return uri;
}

export async function stopTestDb(): Promise<void> {
  await mongoose.disconnect();
  await mongo?.stop();
  mongo = undefined;
}

/**
 * Wipes every collection between tests without tearing down the server. Keeps
 * the suite fast while guaranteeing no state leaks between cases.
 */
export async function clearTestDb(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/* ---- automatic lifecycle for any suite that opts in ---- */

/**
 * Opts a suite into the in-memory Mongo lifecycle.
 *
 * Named `setup…` rather than `use…` on purpose: `useTestDatabase` trips
 * `react/rules-of-hooks` in oxlint, because a top-level call looks like a hook
 * being called outside a component.
 */
export function setupTestDatabase(): void {
  beforeAll(async () => {
    await startTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  afterEach(async () => {
    // Rate-limit counters are module state, not database state.
    const { resetLoginLimiter } = await import("../../src/middleware/login-rate-limit.js");
    const { resetAccountLimiter } = await import("../../src/services/auth.service.js");
    resetLoginLimiter();
    resetAccountLimiter();
  });

  afterAll(async () => {
    await stopTestDb();
  });
}

/** Finds a value in an array of cookies by name. */
export function cookieValue(setCookie: string | undefined, name: string): string | undefined {
  if (!setCookie) return undefined;
  for (const part of setCookie.split(/,\s*(?=[^;,]+=)/)) {
    const [rawName, ...rest] = part.split(";");
    if (rawName?.trim() === name) return decodeURIComponent(rest.join(";").split("=").slice(1).join("="));
  }
  return undefined;
}

/** Minimal cookie jar so a suite can replay the rotation chain. */
export class CookieJar {
  private cookies = new Map<string, string>();

  capture(res: { headers: Record<string, unknown> }): this {
    const header = res.headers["set-cookie"];
    const list = Array.isArray(header) ? header : typeof header === "string" ? [header] : [];
    for (const raw of list) {
      const [pair] = raw.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) this.cookies.set(pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1)));
    }
    return this;
  }

  header(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  clear(): void {
    this.cookies.clear();
  }
}

/** Seeds the seven roles. Most authenticated suites need them. */
export async function seedRoles(): Promise<void> {
  const { Role } = await import("../../src/models/role.model.js");
  const { ROLE_DESCRIPTIONS, ROLE_NAMES, ROLE_PERMISSIONS } = await import(
    "../../src/services/permissions.js"
  );
  await Role.insertMany(
    ROLE_NAMES.map((name) => ({
      name,
      description: ROLE_DESCRIPTIONS[name],
      permissions: [...ROLE_PERMISSIONS[name]],
      isSystem: true,
    })),
  );
}

export async function createUser(options: {
  email: string;
  name?: string;
  password?: string;
  roleNames?: string[];
  active?: boolean;
}): Promise<{ id: string; email: string }> {
  const { User } = await import("../../src/models/user.model.js");
  const { Role } = await import("../../src/models/role.model.js");
  const { hashPassword } = await import("../../src/lib/password.js");

  const roleNames = options.roleNames ?? ["Super Admin"];
  const roles = await Role.find({ name: { $in: roleNames as RoleLean["name"][] } }).lean<RoleLean[]>();
  const user = await User.create({
    email: options.email.toLowerCase(),
    name: options.name ?? options.email,
    phone: "",
    passwordHash: await hashPassword(options.password ?? "CorrectHorseBattery1!"),
    passwordChangedAt: new Date(),
    roleIds: roles.map((r) => r._id),
    active: options.active ?? true,
  });
  return { id: user.id, email: user.email };
}
