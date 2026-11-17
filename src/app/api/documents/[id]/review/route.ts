/**
 * PATCH /api/documents/[id]/review — approve/reject with reason
 */

import { NextResponse } from "next/server";
import { withAuth, checkOrderAccess, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const PATCH = withAuth("documents.review",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const actor = (req as AuthedRequest).auth!;
    const { status, reason } = await req.json();
    if (!status || !["Approved", "Rejected"].includes(status)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "status must be Approved or Rejected." } }, { status: 400 });
    }

    const docOid = safeObjectId(id);
    if (!docOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid document id." } }, { status: 400 });
    }
    const docs = await collection("documents");
    const doc = await docs.findOne({ _id: docOid });
    if (!doc) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Document not found." } }, { status: 404 });

    // --- Ownership protection: authorize against the parent order before
    // mutating review state. Missing/ownerless orders fail closed. ---
    const orderOid = safeObjectId(doc.orderId);
    const order = orderOid ? await (await collection("orders")).findOne({ _id: orderOid }) : null;
    if (!checkOrderAccess(actor, order ?? {})) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this document." } }, { status: 403 });
    }

    const update: Record<string, unknown> = { status, reviewedAt: new Date() };
    if (reason) update.rejectionReason = reason;

    await docs.updateOne({ _id: docOid }, { $set: update });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "document",
      entityId: String(id),
      action: "review",
      before: {
        status: doc.status,
        rejectionReason: doc.rejectionReason ?? null,
        reviewedAt: doc.reviewedAt ?? null,
      },
      after: {
        status,
        rejectionReason: reason ?? null,
        reviewedAt: update.reviewedAt,
      },
    });

    return NextResponse.json({ ok: true });
  },
);