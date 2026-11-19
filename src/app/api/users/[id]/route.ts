/**
 * GET /api/users/[id] — single user detail
 * PATCH /api/users/[id] — update user (requires users.manage)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";
import { resolvePrimaryRole } from "@/lib/permissions";

export const GET = withAuth("users.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const users = await collection("users");
    const user = await users.findOne({ _id: toObjectId(id) });
    if (!user) return NextResponse.json({ error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404 });
    return NextResponse.json({
      id: String(user._id),
      name: user.name,
      full_name: user.full_name ?? user.name,
      email: user.email,
      phone: user.phone,
      role: resolvePrimaryRole(user),
      roleNames: user.roleNames ?? [],
      agency_name: user.agency_name ?? null,
      b2b_tier: user.b2b_tier ?? "SILVER",
      default_commission_pct: user.default_commission_pct ?? 0,
      active: user.active,
      is_active: user.active,
    });
  },
);

export const PATCH = withAuth("users.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const { name, phone, role, roleNames, agency_name, b2b_tier, default_commission_pct, active } = await req.json();

    const users = await collection("users");
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (roleNames !== undefined) {
      const names = Array.isArray(roleNames) ? roleNames : [];
      const primaryRole = resolvePrimaryRole({ role, roleNames: names });
      if (!primaryRole) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "At least one valid role is required." } },
          { status: 400 },
        );
      }
      update.roleNames = names;
      // Keep the legacy scalar derived from roleNames so PATCH cannot
      // reintroduce the stale-role mismatch.
      update.role = primaryRole;
    } else if (role !== undefined) {
      update.role = role;
    }
    if (agency_name !== undefined) update.agency_name = agency_name;
    if (b2b_tier !== undefined) update.b2b_tier = b2b_tier;
    if (default_commission_pct !== undefined) update.default_commission_pct = default_commission_pct;
    if (active !== undefined) {
      update.active = active;
      update.is_active = active;
      const existing = await users.findOne({ _id: toObjectId(id) });
      update.tokenVersion = ((existing?.tokenVersion ?? 0) + 1);
    }

    await users.updateOne({ _id: toObjectId(id) }, { $set: update });
    return NextResponse.json({ ok: true });
  },
);
