/**
 * PATCH /api/roles/[id] — adjust permissions of a seeded role (requires roles.manage)
 * Mirrors Express `PATCH /roles/:id`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

const PERMISSIONS = [
  "users.manage",
  "roles.manage",
  "clients.view",
  "clients.manage",
  "orders.view",
  "orders.manage",
  "rto.manage",
  "agents.manage",
  "qualifications.manage",
  "pricing.manage",
  "documents.view",
  "documents.review",
  "finance.view",
  "finance.manage",
  "qb.retry",
  "reports.view",
  "audit.view",
  "settings.manage",
] as const;

export const PATCH = withAuth("roles.manage",
  async (req: AuthedRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let roleId;
    try {
      roleId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid role id." } },
        { status: 400 },
      );
    }

    let body: { permissions: string[] };
    try {
      const raw = await req.json();
      if (!Array.isArray(raw.permissions) || raw.permissions.length > PERMISSIONS.length) {
        throw new Error("permissions must be an array.");
      }
      for (const p of raw.permissions) {
        if (!PERMISSIONS.includes(p as any)) {
          throw new Error(`Unknown permission: ${p}.`);
        }
      }
      body = { permissions: raw.permissions };
    } catch (err: any) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: err.message ?? "Invalid request body." } },
        { status: 400 },
      );
    }

    const roles = await collection("roles");
    const role = await roles.findOne({ _id: roleId });
    if (!role) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Role not found." } },
        { status: 404 },
      );
    }

    const roleName = role.name as string;
    const requested = new Set(body.permissions);

    // Super Admin must keep every permission.
    if (roleName === "Super Admin") {
      const missing = PERMISSIONS.filter((p) => !requested.has(p));
      if (missing.length > 0) {
        return NextResponse.json(
          {
            error: {
              code: "CANNOT_STRIP_SUPER_ADMIN",
              message: `Super Admin must keep every permission. Missing: ${missing.join(", ")}.`,
            },
          },
          { status: 422 },
        );
      }
    }

    // Determine if the caller holds this role (needed for self-lockout guard).
    let callerHoldsThisRole = false;
    if (req.auth) {
      const users = await collection("users");
      const caller = await users.findOne({ _id: toObjectId(req.auth.userId) });
      if (caller) {
        const callerRoleIds = (caller.roleIds as unknown[]) ?? [];
        const callerRoleNames = (caller.roleNames as string[]) ?? [];
        callerHoldsThisRole =
          callerRoleIds.some((rid) => String(rid) === String(role._id)) ||
          callerRoleNames.includes(roleName);
      }
    }

    if (callerHoldsThisRole) {
      const selfHarmful = ["roles.manage", "users.manage"].filter((p) => !requested.has(p));
      if (selfHarmful.length > 0) {
        return NextResponse.json(
          {
            error: {
              code: "SELF_LOCKOUT",
              message: `You hold "${roleName}". Removing ${selfHarmful.join(", ")} from it would leave you unable to edit roles again.`,
            },
          },
          { status: 422 },
        );
      }
    }

    const before = role.permissions as string[];
    await roles.updateOne(
      { _id: roleId },
      { $set: { permissions: body.permissions, updatedAt: new Date() } },
    );

    return NextResponse.json({
      role: { id: String(roleId), name: roleName, permissions: body.permissions },
      before,
    });
  },
);
