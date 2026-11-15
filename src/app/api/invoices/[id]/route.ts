/**
 * GET /api/invoices/[id] — single invoice detail
 * PATCH /api/invoices/[id] — update non-financial fields only (status transitions
 * go through dimensions / dedicated endpoints; totals are immutable once issued)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const UPDATABLE_FIELDS = new Set(["dueDate", "status"]);

export const GET = withAuth("finance.view",
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const oid = safeObjectId(id);
    if (!oid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id format." } }, { status: 400 });
    }

    const coll = await collection("invoices");
    const doc = await coll.findOne({ _id: oid });
    if (!doc) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Invoice not found." } }, { status: 404 });
    }

    return NextResponse.json({
      id: String(doc._id),
      orderId: String(doc.orderId),
      invoiceNumber: doc.invoiceNumber,
      total: doc.total,
      currency: doc.currency,
      issueDate: doc.issueDate,
      dueDate: doc.dueDate,
      status: doc.status,
      lineItems: doc.lineItems,
      history: doc.history,
      qbReference: doc.qbReference,
      qbSyncStatus: doc.qbSyncStatus,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  },
);

export const PATCH = withAuth("finance.manage",
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const oid = safeObjectId(id);
    if (!oid) {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id format." } }, { status: 400 });
    }

    const actor = (req as AuthedRequest).auth!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const coll = await collection("invoices");
    const doc = await coll.findOne({ _id: oid });
    if (!doc) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Invoice not found." } }, { status: 404 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    const history: Array<Record<string, unknown>> = [];
    const now = new Date();

    for (const field of UPDATABLE_FIELDS) {
      if (body[field] === undefined) continue;
      const next = body[field] === null ? null : String(body[field]).trim() || null;
      update[field] = next;
      if (String(doc[field]) !== String(next)) {
        history.push({ timestamp: now, field, before: doc[field], after: next, actorId: actor.userId });
      }
    }

    if (history.length === 0) {
      return NextResponse.json({ error: { code: "NO_CHANGES", message: "No updatable fields supplied." } }, { status: 400 });
    }

    await coll.updateOne(
      { _id: oid },
      { $set: update, $push: { history: { $each: history } } as any },
    );

    const updated = await coll.findOne({ _id: oid });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "invoice",
      entityId: String(id),
      action: "update",
      before: { dueDate: doc.dueDate, status: doc.status },
      after: { dueDate: updated?.dueDate, status: updated?.status },
    });

    return NextResponse.json({
      invoice: {
        id: String(updated?._id),
        orderId: String(updated?.orderId),
        invoiceNumber: updated?.invoiceNumber,
        total: updated?.total,
        currency: updated?.currency,
        issueDate: updated?.issueDate,
        dueDate: updated?.dueDate,
        status: updated?.status,
        lineItems: updated?.lineItems,
        qbReference: updated?.qbReference,
        qbSyncStatus: updated?.qbSyncStatus,
        createdAt: updated?.createdAt,
        updatedAt: updated?.updatedAt,
      },
    });
  },
);
