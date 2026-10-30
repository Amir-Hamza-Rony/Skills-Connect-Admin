/**
 * PATCH /api/orders/[id]/dimensions — update evidenceStatus, rtoSubmissionStatus, certificateStatus
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const PATCH = withAuth("orders.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const { evidenceStatus, rtoSubmissionStatus, certificateStatus } = await req.json();

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: toObjectId(id) });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const history: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (const [field, value] of [["evidenceStatus", evidenceStatus], ["rtoSubmissionStatus", rtoSubmissionStatus], ["certificateStatus", certificateStatus]] as const) {
      if (value !== undefined && value !== order[field]) {
        set[field] = value;
        history.push({ timestamp: now, field, before: String(order[field]), after: String(value) });
      }
    }

    if (history.length === 0) {
      return NextResponse.json({ error: { code: "NO_CHANGES", message: "No changes supplied." } }, { status: 400 });
    }

    await orders.updateOne({ _id: toObjectId(id) }, { $set: set, $push: { history: { $each: history } as any as any } });

    // Sync certificate collection when certificateStatus changes
    if (certificateStatus !== undefined) {
      const certs = await collection("certificates");
      await certs.updateOne(
        { orderId: toObjectId(id) },
        { $set: { status: certificateStatus } },
        { upsert: true },
      );
    }

    return NextResponse.json({ ok: true });
  },
);