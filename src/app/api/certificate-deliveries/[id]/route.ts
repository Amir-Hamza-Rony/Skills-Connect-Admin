/**
 * GET /api/certificate-deliveries/[id] — get a certificate delivery record
 * PATCH /api/certificate-deliveries/[id] — update delivery status with transition validation
 *
 * Requires `rplPartners.view` (get) or `rplPartners.manage` (update).
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const VIEW_PERM = "rplPartners.view";
const WRITE_PERM = "rplPartners.manage";

const VALID_STATUSES = new Set(["pending", "dispatched", "delivered", "failed"]);

// Allowed delivery status transitions.
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  pending: ["dispatched", "failed"],
  dispatched: ["delivered", "failed"],
  delivered: [],
  failed: ["pending"],
};

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export const GET = withAuth(VIEW_PERM,
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const id = safeObjectId(resolvedParams?.id);
    if (!id) return invalidId();

    const coll = await collection("certificate_deliveries");
    const doc = await coll.findOne({ _id: id });
    if (!doc) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Certificate delivery not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ certificateDelivery: { id: String(doc._id), ...doc } });
  },
);

export const PATCH = withAuth(WRITE_PERM,
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const id = safeObjectId(resolvedParams?.id);
    if (!id) return invalidId();

    const auth = req.auth!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const coll = await collection("certificate_deliveries");
    const existing = await coll.findOne({ _id: id });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Certificate delivery not found." } },
        { status: 404 },
      );
    }

    const before = { deliveryStatus: existing.deliveryStatus };
    const update: Record<string, unknown> = { updatedAt: new Date(), updatedBy: auth.userId };

    if (body.deliveryStatus !== undefined) {
      const nextStatus = String(body.deliveryStatus);
      if (!VALID_STATUSES.has(nextStatus)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid delivery status." } },
          { status: 400 },
        );
      }
      const allowed = ALLOWED_TRANSITIONS[existing.deliveryStatus] ?? [];
      if (!allowed.includes(nextStatus)) {
        return NextResponse.json(
          {
            error: {
              code: "INVALID_TRANSITION",
              message: `Cannot transition from ${existing.deliveryStatus} to ${nextStatus}.`,
            },
          },
          { status: 400 },
        );
      }
      update.deliveryStatus = nextStatus;
      if (nextStatus === "delivered" || nextStatus === "failed") {
        update.deliveryDate = String(body.deliveryDate ?? new Date().toISOString());
      }
    }

    if (body.recipient !== undefined) update.recipient = String(body.recipient ?? "").trim() || null;
    if (body.deliveryMethod !== undefined) update.deliveryMethod = String(body.deliveryMethod ?? "").trim() || null;
    if (body.trackingNumber !== undefined) update.trackingNumber = String(body.trackingNumber ?? "").trim() || null;
    if (body.confirmationDetails !== undefined) update.confirmationDetails = String(body.confirmationDetails ?? "").trim() || null;
    if (body.deliveryNotes !== undefined) update.deliveryNotes = String(body.deliveryNotes ?? "").trim() || null;

    await coll.updateOne({ _id: id }, { $set: update });
    const updated = await coll.findOne({ _id: id });

    await writeAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      entityType: "certificate_delivery",
      entityId: String(id),
      action: "update",
      before,
      after: { deliveryStatus: updated?.deliveryStatus, deliveryDate: updated?.deliveryDate },
    });

    return NextResponse.json({ certificateDelivery: { id: String(updated?._id), ...updated } });
  },
);
