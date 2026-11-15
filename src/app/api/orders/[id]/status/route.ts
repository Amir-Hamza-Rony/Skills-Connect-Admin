/**
 * PATCH /api/orders/[id]/status — change order status with history
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
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

    const { status } = body;
    if (!status) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "status required." } }, { status: 400 });
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderOid });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const before = order.status;
    const allowed = ALLOWED_TRANSITIONS[before] ?? [];
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: { code: "INVALID_TRANSITION", message: `Cannot move from ${before} to ${status}` } },
        { status: 400 },
      );
    }

    const now = new Date();
    const update: Record<string, unknown> = { status, updatedAt: now };
    if (status === "Completed") update.completedAt = now;

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
      after: { status },
    });

    return NextResponse.json({ ok: true, before, after: status });
  },
);
