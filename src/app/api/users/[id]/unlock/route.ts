/**
 * POST /api/users/[id]/unlock — clear brute-force lockout
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const POST = withAuth("users.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const users = await collection("users");
    const user = await users.findOne({ _id: toObjectId(id) });
    if (!user) return NextResponse.json({ error: { code: "NOT_FOUND", message: "User not found." } }, { status: 404 });

    const now = new Date();
    await users.updateOne(
      { _id: toObjectId(id) },
      { $set: { failedLoginCount: 0, lockedUntil: null, updatedAt: now } },
    );

    // Audit
    const audit = await collection("audit_logs");
    await audit.insertOne({
      actorId: (req as any).auth?.userId ?? null,
      actorEmail: (req as any).auth?.email ?? null,
      action: "user.unlock",
      entityType: "user",
      entityId: id,
      after: { unlocked: true },
      ip: null,
      userAgent: null,
      requestId: null,
      createdAt: now,
    });

    return NextResponse.json({ ok: true });
  },
);