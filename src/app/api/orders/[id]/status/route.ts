/**
 * PATCH /api/orders/[id]/status — change order status with history.
 *
 * Application pipeline statuses (docs v5.1 §2 Module 3 Step D, v5.0 §6):
 *   DRAFT → RECEIVED → IN_PROGRESS → DELIVERED → ON_HOLD / CANCELLED
 *
 * Immutable price snapshots: when an application moves to RECEIVED, lock
 * true_rto_cost, approved_internal_cost, sale_price, additional_fees and
 * commission_amount as static values on the applications row (docs v5.1 §2,
 * v5.0 §5).
 *
 * ON_HOLD / CANCELLED require a mandatory status_reason_note logged to Audit
 * Logs (docs v5.1 §2 Module 3 Step D).
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { checkOrderAccess } from "@/middleware/auth";

const APPLICATION_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["RECEIVED", "ON_HOLD", "CANCELLED"],
  RECEIVED: ["IN_PROGRESS", "ON_HOLD", "CANCELLED"],
  IN_PROGRESS: ["DELIVERED", "ON_HOLD", "CANCELLED"],
  DELIVERED: ["ON_HOLD", "CANCELLED"],
  ON_HOLD: ["DRAFT", "RECEIVED", "IN_PROGRESS", "DELIVERED", "CANCELLED"],
  CANCELLED: [],
};

const LEGACY_TRANSITIONS: Record<string, string[]> = {
  Lead: ["Qualified", "Lost"],
  Qualified: ["Won", "Lost"],
  Won: ["New", "Lost"],
  Lost: [],
  New: ["Awaiting Payment", "Awaiting Documents", "On Hold", "Cancelled"],
  "Awaiting Payment": ["Awaiting Documents", "On Hold", "Cancelled", "Refunded"],
  "Awaiting Documents": ["Documents Under Review", "On Hold", "Cancelled"],
  "Documents Under Review": ["Ready for Submission", "On Hold", "Rework Required"],
  "Ready for Submission": ["Submitted to Source Agent", "On Hold"],
  "Submitted to Source Agent": ["Submitted to RTO", "On Hold"],
  "Submitted to RTO": ["RTO Acknowledged", "On Hold"],
  "RTO Acknowledged": ["Under Assessment", "On Hold"],
  "Under Assessment": ["Additional Evidence Required", "Approved", "On Hold"],
  "Additional Evidence Required": ["Under Assessment", "Rework Required", "On Hold"],
  "Rework Required": ["Under Assessment", "On Hold"],
  Approved: ["Certificate Issued", "On Hold"],
  "Certificate Issued": ["Completed", "On Hold"],
  "On Hold": [
    "New",
    "Awaiting Payment",
    "Awaiting Documents",
    "Documents Under Review",
    "Ready for Submission",
    "Submitted to Source Agent",
    "Submitted to RTO",
    "RTO Acknowledged",
    "Under Assessment",
    "Additional Evidence Required",
    "Rework Required",
    "Approved",
    "Certificate Issued",
    "Cancelled",
  ],
  Completed: [],
  Cancelled: [],
  Refunded: [],
};

export const PATCH = withAuth("orders.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const orderOid = safeObjectId(id);
    if (!orderOid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid id format." } },
        { status: 400 },
      );
    }
    const actor = (req as AuthedRequest).auth!;

    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const { status, statusReasonNote } = body;
    if (!status) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "status required." } }, { status: 400 });
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderOid });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    if (!checkOrderAccess(actor, order)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this order." } }, { status: 403 });
    }

    const before = order.status;

    // Determine which transition set applies.
    const appStatuses = ["DRAFT", "RECEIVED", "IN_PROGRESS", "DELIVERED", "ON_HOLD", "CANCELLED"];
    const isAppFlow = appStatuses.includes(before) || appStatuses.includes(status);
    const allowed = isAppFlow
      ? (APPLICATION_TRANSITIONS[before] ?? [])
      : (LEGACY_TRANSITIONS[before] ?? []);

    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: { code: "INVALID_TRANSITION", message: `Cannot move from ${before} to ${status}` } },
        { status: 400 },
      );
    }

    // ON_HOLD / CANCELLED require a mandatory status_reason_note.
    if ((status === "ON_HOLD" || status === "CANCELLED") && !statusReasonNote) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "statusReasonNote is required for ON_HOLD or CANCELLED." } },
        { status: 400 },
      );
    }

    const now = new Date();
    const update: Record<string, unknown> = { status, updatedAt: now };
    if (status === "Completed") update.completedAt = now;
    if (statusReasonNote) update.statusReasonNote = statusReasonNote;

    // Immutable price snapshots on RECEIVED (docs v5.1 §2, v5.0 §5).
    if (status === "RECEIVED" && before !== "RECEIVED") {
      update.snapTrueRtoCost = order.trueRtoCost ?? null;
      update.snapApprovedInternalCost = order.approvedInternalCost ?? null;
      update.snapB2bWholesalePrice = order.b2bWholesalePrice ?? null;
      update.snapB2cRetailPrice = order.b2cRetailPrice ?? null;
      update.snapSalePrice = order.sellingPrice;
      update.snapAdditionalFees = order.feeTotal;
      update.snapDiscount = 0;
      update.snapTotalBilled = order.sellingPrice + order.feeTotal;
    }

    const historyEntry: Record<string, unknown> = { timestamp: now, field: "status", before, after: status, actorId: actor.userId };

    await orders.updateOne(
      { _id: orderOid },
      { $set: update, $push: { history: historyEntry } as any as any as any as any },
    );

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "order",
      entityId: String(id),
      action: "status_transition",
      before: { status: before },
      after: { status, statusReasonNote },
      snapshots: status === "RECEIVED" ? {
        snapTrueRtoCost: order.trueRtoCost ?? null,
        snapApprovedInternalCost: order.approvedInternalCost ?? null,
        snapB2bWholesalePrice: order.b2bWholesalePrice ?? null,
        snapB2cRetailPrice: order.b2cRetailPrice ?? null,
        snapSalePrice: order.sellingPrice,
        snapAdditionalFees: order.feeTotal,
        snapTotalBilled: order.sellingPrice + order.feeTotal,
      } : null,
    });

    return NextResponse.json({ ok: true, before, after: status });
  },
);
