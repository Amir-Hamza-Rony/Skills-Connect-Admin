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
 * This is the one place the RBAC matrix can be edited at runtime. It refuses
 * self-lockout: an admin who strips their own `users.manage` can never edit
 * roles again, so the change is blocked with a clear message.
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