/**
 * GET /api/users/[id] — single user detail
 * PATCH /api/users/[id] — update user (requires users.manage)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

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
      email: user.email,
      phone: user.phone,
      roleNames: user.roleNames ?? [],
      active: user.active,
    });
  },
);

export const PATCH = withAuth("users.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const { name, phone, roleNames, active } = await req.json();

    const users = await collection("users");
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) update.name = name;
    if (phone !== undefined) update.phone = phone;
    if (roleNames !== undefined) update.roleNames = roleNames;
    if (active !== undefined) {
      update.active = active;
      const existing = await users.findOne({ _id: toObjectId(id) });
      update.tokenVersion = ((existing?.tokenVersion ?? 0) + 1);
    }

    await users.updateOne({ _id: toObjectId(id) }, { $set: update });
    return NextResponse.json({ ok: true });
  },
);