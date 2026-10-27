import { Router } from "express";
import { z } from "zod";

import { AppError } from "../lib/app-error.js";
import { Role } from "../models/role.model.js";
import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { recordAudit, auditContextFrom } from "../services/audit.service.js";
import { PERMISSIONS, ROLE_NAMES } from "../services/permissions.js";

export const rolesRouter: Router = Router();

/** GET /roles — the matrix, used to populate role pickers. Requires users.manage. */
rolesRouter.get(
  "/",
  requireAuth,
  requirePermission("users.manage"),
  async (_req, res) => {
    const roles = await Role.find().sort({ name: 1 }).lean();
    res.json({ roles });
  },
);

/**
 * PATCH /roles/:id — adjust permissions of a seeded role.
 *
 * This is the one place the RBAC matrix can be edited at runtime, so it carries
 * two guards that the previous version documented but never implemented:
 *
 *  1. **No self-lockout.** An admin who strips `roles.manage` (or
 *     `users.manage`) from the role they hold can never edit roles again — no
 *     other role has that permission by default, so the mistake is permanent
 *     without a database console. Refused with a message naming the permission.
 *  2. **Super Admin stays all-powerful.** It is the recovery role; letting it be
 *     edited into a useless state strands the installation the same way.
 */
rolesRouter.patch(
  "/:id",
  requireAuth,
  requirePermission("roles.manage"),
  async (req, res) => {
    const body = z.object({ permissions: z.array(z.enum(PERMISSIONS)).max(PERMISSIONS.length) }).parse(req.body);

    const role = await Role.findById(req.params.id);
    if (!role) throw AppError.notFound("Role not found.");
    if (!ROLE_NAMES.includes(role.name)) {
      throw AppError.badRequest("UNKNOWN_ROLE", `Unknown role "${role.name}".`);
    }

    const requested = new Set(body.permissions);
    const callerRoleIds = (req.auth?.roleIds ?? []) as string[];

    if (role.name === "Super Admin") {
      const missing = PERMISSIONS.filter((p) => !requested.has(p));
      if (missing.length > 0) {
        throw AppError.unprocessable(
          "CANNOT_STRIP_SUPER_ADMIN",
          `Super Admin must keep every permission. Missing: ${missing.join(", ")}.`,
        );
      }
    }

    // Only block when the caller would be editing a role they themselves hold —
    // tightening someone else's Finance role is fine, even without roles.manage.
    if (callerRoleIds.includes(String(role._id))) {
      const selfHarmful = (["roles.manage", "users.manage"] as const).filter((p) => !requested.has(p));
      if (selfHarmful.length > 0) {
        throw AppError.unprocessable(
          "SELF_LOCKOUT",
          `You hold "${role.name}". Removing ${selfHarmful.join(", ")} from it would leave you unable to edit roles again.`,
        );
      }
    }

    const before = role.permissions.slice();
    role.permissions = body.permissions;
    await role.save();

    await recordAudit({
      ...auditContextFrom(req),
      action: "role.permissions.update",
      entityType: "role",
      entityId: role.id,
      before: { name: role.name, permissions: before },
      after: { name: role.name, permissions: body.permissions },
    });

    res.json({ role });
  },
);