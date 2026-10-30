/**
 * PATCH /api/documents/[id]/review — approve/reject with reason
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const PATCH = withAuth("documents.review",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const { status, reason } = await req.json();
    if (!status || !["Approved", "Rejected"].includes(status)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "status must be Approved or Rejected." } }, { status: 400 });
    }

    const docs = await collection("documents");
    const update: Record<string, unknown> = { status, reviewedAt: new Date() };
    if (reason) update.rejectionReason = reason;

    await docs.updateOne({ _id: toObjectId(id) }, { $set: update });
    return NextResponse.json({ ok: true });
  },
);