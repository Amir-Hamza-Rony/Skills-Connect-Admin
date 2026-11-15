/**
 * PATCH /api/orders/[id]/dimensions — update evidenceStatus, rtoSubmissionStatus, certificateStatus
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const PATCH = withAuth("orders.manage",
  async (req: AuthedRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const {
      evidenceStatus,
      rtoSubmissionStatus,
      certificateStatus,
      licensingAuthority,
      licenceReference,
      licenceExpiry,
      certificateDeliveryMethod,
      certificateDeliveryDate,
      certificateTrackingNumber,
    } = await req.json();

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: toObjectId(id) });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });
    const actor = (req as AuthedRequest).auth!;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    const history: Array<Record<string, unknown>> = [];
    const now = new Date();

    const tracked: Array<[string, unknown]> = [
      ["evidenceStatus", evidenceStatus],
      ["rtoSubmissionStatus", rtoSubmissionStatus],
      ["certificateStatus", certificateStatus],
      ["licensingAuthority", licensingAuthority],
      ["licenceReference", licenceReference],
      ["licenceExpiry", licenceExpiry],
      ["certificateDeliveryMethod", certificateDeliveryMethod],
      ["certificateDeliveryDate", certificateDeliveryDate],
      ["certificateTrackingNumber", certificateTrackingNumber],
    ];

    for (const [field, value] of tracked) {
      if (value === undefined) continue;
      const next = value === null ? null : String(value).trim() || null;
      set[field] = next;
      if (String(order[field]) !== String(next)) {
        history.push({ timestamp: now, field, before: order[field], after: next, actorId: actor.userId });
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