/**
 * GET /api/orders/[id] — single order with detail
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const UPDATABLE_FIELDS = new Set([
  "rtoContactId",
  "rtoContactName",
  "notes",
]);

export const GET = withAuth("orders.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const orderOid = safeObjectId(id);
    if (!orderOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id format." } }, { status: 400 });
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderOid });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const margin = order.sellingPrice - order.supplierCostSnapshot - (order.otherCost ?? 0);
    return NextResponse.json({
      id: String(order._id),
      clientId: String(order.clientId),
      qualificationId: String(order.qualificationId),
      salesAgentId: String(order.salesAgentId),
      sourceAgentId: String(order.sourceAgentId),
      rtoId: String(order.rtoId),
      status: order.status,
      evidenceStatus: order.evidenceStatus,
      rtoSubmissionStatus: order.rtoSubmissionStatus,
      certificateStatus: order.certificateStatus,
      sellingPrice: order.sellingPrice,
      supplierCostSnapshot: order.supplierCostSnapshot,
      otherCost: order.otherCost,
      grossMargin: margin,
      currency: order.currency,
      history: order.history ?? [],
      createdAt: order.createdAt,
    });
  },
);

/** `PATCH /api/orders/[id]` — update non-financial fields only. */
export const PATCH = withAuth("orders.manage",
  async (req: AuthedRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const orderOid = safeObjectId(id);
    if (!orderOid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id format." } }, { status: 400 });
    }

    const actor = (req as AuthedRequest).auth!;

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderOid });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const history: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (const field of UPDATABLE_FIELDS) {
      if (body[field] === undefined) continue;
      const next = body[field] === null ? null : String(body[field]).trim() || null;
      update[field] = next;
      if (String(order[field]) !== String(next)) {
        history.push({ timestamp: now, field, before: order[field], after: next, actorId: actor.userId });
      }
    }

    if (history.length === 0) {
      return NextResponse.json({ error: { code: "NO_CHANGES", message: "No updatable fields supplied." } }, { status: 400 });
    }

    await orders.updateOne(
      { _id: orderOid },
      { $set: update, $push: { history: { $each: history } } as any },
    );

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "order",
      entityId: String(id),
      action: "update",
      before: {
        rtoContactId: order.rtoContactId,
        rtoContactName: order.rtoContactName,
        notes: order.notes,
      },
      after: {
        rtoContactId: update.rtoContactId,
        rtoContactName: update.rtoContactName,
        notes: update.notes,
      },
    });

    const updated = await orders.findOne({ _id: orderOid });
    return NextResponse.json({
      order: {
        id: String(updated?._id),
        clientId: String(updated?.clientId),
        qualificationId: String(updated?.qualificationId),
        salesAgentId: String(updated?.salesAgentId),
        sourceAgentId: String(updated?.sourceAgentId),
        rtoId: String(updated?.rtoId),
        rtoContactId: updated?.rtoContactId ? String(updated.rtoContactId) : null,
        rtoContactName: updated?.rtoContactName,
        status: updated?.status,
        notes: updated?.notes,
        sellingPrice: updated?.sellingPrice,
        supplierCostSnapshot: updated?.supplierCostSnapshot,
        currency: updated?.currency,
        priceListId: updated?.priceListId ? String(updated.priceListId) : null,
        priceCategoryId: updated?.priceCategoryId ? String(updated.priceCategoryId) : null,
        supplierRouteId: updated?.supplierRouteId ? String(updated.supplierRouteId) : null,
        updatedAt: updated?.updatedAt,
      },
    });
  },
);