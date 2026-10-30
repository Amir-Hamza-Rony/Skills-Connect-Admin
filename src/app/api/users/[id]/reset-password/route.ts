/**
 * POST /api/users/[id]/reset-password — set new password, revoke sessions
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";
import { hashPassword } from "@/lib/api-auth";

export const POST = withAuth("users.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const { password } = await req.json();
    if (!password || password.length < 12) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Password must be at least 12 characters." } }, { status: 400 });
    }

    const users = await collection("users");
    const user = await users.findOne({ _id: toObjectId(id) });
    if (!user) return NextResponse.json({ error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404 });

    const { hash } = await hashPassword(password);
    const now = new Date();

    await users.updateOne(
      { _id: toObjectId(id) },
      {
        $set: {
          passwordHash: hash,
          passwordChangedAt: now,
          failedLoginCount: 0,
          lockedUntil: null,
          tokenVersion: (user.tokenVersion ?? 0) + 1,
          updatedAt: now,
        },
      },
    );

    // Revoke all sessions
    const tokens = await collection("refresh_tokens");
    await tokens.updateMany({ userId: toObjectId(id), revoked: false }, { $set: { revoked: true } });

    // Audit
    const audit = await collection("audit_logs");
    await audit.insertOne({
      actorId: (req as any).auth?.userId ?? null,
      actorEmail: (req as any).auth?.email ?? null,
      action: "user.password.reset",
      entityType: "user",
      entityId: id,
      after: { revoked: true },
      ip: null,
      userAgent: null,
      requestId: null,
      createdAt: now,
    });

    return NextResponse.json({ ok: true });
  },
);