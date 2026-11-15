/**
 * GET /api/invoices — list invoices (filter by orderId, currency, status, qbSyncStatus)
 * POST /api/invoices — create invoice from an order, capturing the pricing snapshot
 *
 * Invoices store an explicit currency and line items. Totals are computed
 * server-side; client-submitted totals are not trusted. Historical invoice
 * values are immutable — changing an order's price list never rewrites an
 * issued invoice.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { enqueueSync } from "@/lib/quickbooks";
import type { Currency, InvoiceLineItem, QBSyncStatus2 } from "@/lib/types";

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

function lineItemTotal(item: InvoiceLineItem): number {
  return (item.amount * item.quantity) + item.taxAmount;
}

export const GET = withAuth("finance.view",
  async (req: AuthedRequest) => {
    const { searchParams } = req.nextUrl;
    const orderId = searchParams.get("orderId");
    const currency = searchParams.get("currency");
    const status = searchParams.get("status");
    const qbSyncStatus = searchParams.get("qbSyncStatus");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (orderId) {
      const oid = safeObjectId(orderId);
      if (!oid) return invalidId();
      filter.orderId = oid;
    }
    if (currency) filter.currency = currency;
    if (status) filter.status = status;
    if (qbSyncStatus) filter.qbSyncStatus = qbSyncStatus;

    const coll = await collection("invoices");
    const [docs, total] = await Promise.all([
      coll
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      coll.countDocuments(filter),
    ]);

    return NextResponse.json({
      invoices: docs.map((d: any) => ({
        id: String(d._id),
        orderId: String(d.orderId),
        invoiceNumber: d.invoiceNumber,
        total: d.total,
        currency: d.currency,
        issueDate: d.issueDate,
        dueDate: d.dueDate,
        status: d.status,
        lineItems: d.lineItems,
        history: d.history,
        qbReference: d.qbReference,
        qbSyncStatus: d.qbSyncStatus,
        createdAt: d.createdAt,
      })),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);

export const POST = withAuth("finance.manage",
  async (req: AuthedRequest) => {
    const actor = (req as AuthedRequest).auth!;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const { orderId, currency, issueDate, dueDate, lineItems } = body;

    if (!orderId || !currency || !issueDate || !dueDate) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing required fields." } }, { status: 400 });
    }

    const orderOid = safeObjectId(orderId);
    if (!orderOid) return invalidId();

    if (!["AUD", "BDT", "USD", "GBP", "EUR", "INR"].includes(currency)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid currency." } }, { status: 400 });
    }

    const issue = new Date(issueDate);
    const due = new Date(dueDate);
    if (Number.isNaN(issue.getTime()) || Number.isNaN(due.getTime())) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid date." } }, { status: 400 });
    }

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderOid });
    if (!order) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Order not found." } }, { status: 404 });

    // Duplicate prevention: one draft/issued invoice per order.
    const existing = await (await collection("invoices")).findOne({
      orderId: orderOid,
      status: { $in: ["Draft", "Sent", "Part Paid", "Paid"] },
    });
    if (existing) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: "An active invoice already exists for this order." } },
        { status: 409 },
      );
    }

    // Compute totals server-side from line items. Client-submitted totals are
    // not trusted. Fall back to order selling price + fees when no line items.
    const items: InvoiceLineItem[] = Array.isArray(lineItems) ? lineItems : [];
    let computedTotal = 0;
    for (const it of items) {
      computedTotal += lineItemTotal(it);
    }
    if (items.length === 0) {
      computedTotal = Number(order.sellingPrice ?? 0) + Number(order.feeTotal ?? 0);
    }

    const now = new Date();
    const invoiceNumber = `INV-${orderOid.toString().slice(-8)}-${Date.now()}`;
    const historyEntry: Record<string, unknown> = {
      timestamp: now,
      field: "status",
      before: "—",
      after: "Draft",
      actorId: actor.userId,
    };

    const result = await (await collection("invoices")).insertOne({
      orderId: orderOid,
      invoiceNumber,
      total: computedTotal,
      currency,
      issueDate: issue.toISOString(),
      dueDate: due.toISOString(),
      status: "Draft",
      lineItems: items,
      history: [historyEntry],
      qbReference: null,
      qbSyncStatus: "Not Synced",
      createdAt: now,
      updatedAt: now,
    });

    const created = await (await collection("invoices")).findOne({ _id: result.insertedId });

    // Enqueue a local→QuickBooks sync for the new invoice.
    await enqueueSync({
      entityType: "invoice",
      entityId: String(created?._id),
      idempotencyKey: `invoice-${String(created?._id)}-create`,
    });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "invoice",
      entityId: String(created?._id),
      action: "create",
      before: null,
      after: {
        orderId,
        invoiceNumber,
        total: computedTotal,
        currency,
        issueDate,
        dueDate,
        status: "Draft",
      },
    });

    return NextResponse.json({
      invoice: {
        id: String(created?._id),
        orderId: String(orderOid),
        invoiceNumber,
        total: computedTotal,
        currency,
        issueDate: issue.toISOString(),
        dueDate: due.toISOString(),
        status: "Draft",
        lineItems: items,
        qbReference: null,
        qbSyncStatus: "Not Synced",
        createdAt: now,
      },
    }, { status: 201 });
  },
);
