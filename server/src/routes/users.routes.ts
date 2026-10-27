import { Router } from "express";
import { Types } from "mongoose";
import { z } from "zod";

import { AppError } from "../lib/app-error.js";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, hashPassword } from "../lib/password.js";
import { Role, type RoleLean } from "../models/role.model.js";
import { User, type UserLean, type UserWithRolesLean } from "../models/user.model.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { auditContextFrom, recordAudit } from "../services/audit.service.js";
import { resetAccountLimiterFor, revokeAllSessions } from "../services/auth.service.js";

export const usersRouter: Router = Router();

usersRouter.use(requireAuth);

/**
 * GET /users/directory — name-only staff list for resolving an actor id to a
 * display name (task assignees, document reviewers, audit trails, timelines).
 *
 * Deliberately reachable by ANY signed-in user, because every one of those
 * screens renders staff names and none of them requires `users.manage`. It
 * returns `id` + `name` only — no email, no phone, no roles, no lockout state —
 * so it grants no more than the UI already displays. `GET /users` below stays
 * gated, which is the route the B2 403 acceptance criterion exercises.
 */
usersRouter.get("/directory", async (_req, res) => {
  const staff = await User.find({}, { name: 1 })
    .sort({ name: 1 })
    .lean<Array<{ _id: Types.ObjectId; name: string }>>();

  res.json({ users: staff.map((s) => ({ id: String(s._id), name: s.name })) });
});

/**
 * Everything else is administration and requires `users.manage`. Mounted as a
 * child router so the guard is declared once instead of on six routes.
 */
const adminRouter: Router = Router();
adminRouter.use(requirePermission("users.manage"));

const password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);

/** Resolves role names to ids, failing loudly if any name is unknown. */
async function roleIdsFor(roleNames: string[]): Promise<UserLean["roleIds"]> {
  const unique = [...new Set(roleNames)];
  const roles = await Role.find({ name: { $in: unique as RoleLean["name"][] } }).lean<RoleLean[]>();
  if (roles.length !== unique.length) {
    const found = new Set(roles.map((r) => r.name));
    throw AppError.badRequest(
      "UNKNOWN_ROLE",
      `Unknown role(s): ${unique.filter((n) => !found.has(n as never)).join(", ")}`,
    );
  }
  return roles.map((r) => r._id);
}

/** Role names attached to a user document (populate before calling). */
function namesOf(populated: { roleIds: unknown }): string[] {
  return (populated.roleIds as Array<{ name: string }>).map((r) => r.name);
}

async function roleNamesOf(userId: string): Promise<string[]> {
  const user = await User.findById(userId).populate<{ roleIds: Array<{ name: string }> }>("roleIds");
  return user ? namesOf(user) : [];
}

/** GET /users — list, with roles embedded for the admin table. */
adminRouter.get("/", async (req, res) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  const filter = search
    ? {
        $or: [
          { name: new RegExp(escapeRegex(search), "i") },
          { email: new RegExp(escapeRegex(search), "i") },
        ],
      }
    : {};

  const users = await User.find(filter)
    .populate<{ roleIds: Array<{ name: string }> }>("roleIds")
    .lean<UserWithRolesLean[]>();

  res.json({
    users: users.map((u) => ({
      id: String(u._id),
      name: u.name,
      email: u.email,
      phone: u.phone,
      active: u.active,
      roleNames: namesOf(u),
      lastLoginAt: u.lastLoginAt ?? null,
      createdAt: u.createdAt,
    })),
  });
});

/** POST /users — create an account with an initial password. */
adminRouter.post("/", async (req, res) => {
  const body = z
    .object({
      email: z.string().trim().email().max(320),
      name: z.string().trim().min(1).max(120),
      phone: z.string().trim().max(40).optional(),
      password,
      roleNames: z.array(z.string()).min(1, "At least one role is required."),
      active: z.boolean().optional(),
    })
    .parse(req.body);

  const email = body.email.toLowerCase();
  if (await User.exists({ email })) {
    throw AppError.conflict(`A user with email ${email} already exists.`);
  }

  const created = await User.create({
    email,
    name: body.name,
    phone: body.phone ?? "",
    passwordHash: await hashPassword(body.password),
    passwordChangedAt: new Date(),
    roleIds: await roleIdsFor(body.roleNames),
    active: body.active ?? true,
  });

  await recordAudit({
    ...auditContextFrom(req),
    action: "user.create",
    entityType: "user",
    entityId: created.id,
    after: { email, name: body.name, roles: body.roleNames, active: created.active },
  });

  res.status(201).json({ user: await publicUser(created.id) });
});

/** PATCH /users/:id — update name, phone, roles or active flag. */
adminRouter.patch("/:id", async (req, res) => {
  const body = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      phone: z.string().trim().max(40).optional(),
      roleNames: z.array(z.string()).min(1).optional(),
      active: z.boolean().optional(),
    })
    .parse(req.body);

  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound("User not found.");

  // Never let the last active admin be demoted or deactivated — that would
  // leave the system with no one who can manage users.
  const losingAdmin =
    user.active &&
    (body.active === false || (body.roleNames && !body.roleNames.includes("Super Admin")));

  if (losingAdmin) {
    const superAdmin = await Role.findOne({ name: "Super Admin" }).lean();
    const otherAdmins = superAdmin
      ? await User.countDocuments({
          active: true,
          roleIds: superAdmin._id,
          _id: { $ne: user._id },
        })
      : 0;
    if (otherAdmins === 0) {
      throw AppError.conflict("Cannot demote or deactivate the last active Super Admin.");
    }
  }

  const before = {
    name: user.name,
    phone: user.phone,
    active: user.active,
    roleNames: await roleNamesOf(user.id),
  };

  if (body.name !== undefined) user.name = body.name;
  if (body.phone !== undefined) user.phone = body.phone;
  // Deactivation must take effect immediately, not when the token expires.
  if (body.active !== undefined && body.active !== user.active) {
    user.active = body.active;
    user.tokenVersion += 1;
  }
  if (body.roleNames) user.roleIds = (await roleIdsFor(body.roleNames)) as never;

  await user.save();

  if (body.active === false) {
    await revokeAllSessions(user.id, "account-deactivated", auditContextFrom(req));
  }

  await recordAudit({
    ...auditContextFrom(req),
    action: "user.update",
    entityType: "user",
    entityId: user.id,
    before,
    after: {
      name: user.name,
      phone: user.phone,
      active: user.active,
      roleNames: await roleNamesOf(user.id),
    },
  });

  res.json({ user: await publicUser(user.id) });
});

/** POST /users/:id/reset-password — sets a new password and kills every session. */
adminRouter.post("/:id/reset-password", async (req, res) => {
  const body = z.object({ password }).parse(req.body);

  const user = await User.findById(req.params.id);
  if (!user) throw AppError.notFound("User not found.");

  // Incrementing the version invalidates every access token already issued,
  // not just the refresh sessions revoked below.
  user.tokenVersion += 1;
  user.passwordHash = await hashPassword(body.password);
  user.passwordChangedAt = new Date();
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();

  const revoked = await revokeAllSessions(user.id, "password-reset", auditContextFrom(req));

  // Same reason as unlock: the Redis failure counter outlives the Mongo fields
  // and would re-lock the user on their next mistake.
  await resetAccountLimiterFor(user.id);

  await recordAudit({
    ...auditContextFrom(req),
    action: "user.password.reset",
    entityType: "user",
    entityId: user.id,
    after: { revokedSessions: revoked },
  });

  res.json({ user: await publicUser(user.id), revokedSessions: revoked });
});

/** POST /users/:id/unlock — clears a brute-force lockout. */
adminRouter.post("/:id/unlock", async (req, res) => {
  const user = await User.findById(req.params.id).select("+failedLoginCount +lockedUntil");
  if (!user) throw AppError.notFound("User not found.");

  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();

  // The Redis-backed failure counter is separate state and is what actually
  // decides the lockout. Clearing only the Mongo fields left the counter full,
  // so one more wrong password re-locked the account the moment after an admin
  // had just unlocked it.
  await resetAccountLimiterFor(user.id);

  await recordAudit({
    ...auditContextFrom(req),
    action: "user.unlock",
    entityType: "user",
    entityId: user.id,
  });

  res.json({ user: await publicUser(user.id) });
});

/* ---------------- helpers ---------------- */

/** Mounted last so `/directory` above is matched before the admin guard. */
usersRouter.use(adminRouter);

/** Never returns `passwordHash` or lockout counters. */
async function publicUser(id: string): Promise<Record<string, unknown> | null> {
  const user = await User.findById(id)
    .populate<{ roleIds: Array<{ name: string }> }>("roleIds")
    .lean<UserWithRolesLean>();
  if (!user) return null;
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone,
    active: user.active,
    roleNames: namesOf(user),
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}