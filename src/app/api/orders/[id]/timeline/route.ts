/**
 * GET /api/orders/[id]/timeline — order history + related events
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("orders.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const orderId = toObjectId(id);

    const orders = await collection("orders");
    const order = await orders.findOne({ _id: orderId }, { projection: { history: 1 } });
    const invoices = await (await collection("invoices")).find({ orderId }).toArray();
    const payments = await (await collection("payments")).find({ orderId }).toArray();
    const docs = await (await collection("documents")).find({ orderId }).toArray();
    const certsColl = await collection("certificates");
    const cert = await certsColl.findOne({ orderId });

    const events: Array<Record<string, unknown>> = [];
    for (const h of (order?.history ?? [])) {
      events.push({ kind: "status", timestamp: h.timestamp, field: h.field, before: h.before, after: h.after });
    }
    for (const inv of invoices) events.push({ kind: "invoice", timestamp: inv.createdAt, field: "invoice.created", before: "—", after: `${inv.invoiceNumber} · ${inv.total}` });
    for (const p of payments) events.push({ kind: "payment", timestamp: p.createdAt, field: "payment.recorded", before: "—", after: `${p.amount} · ${p.method}` });
    for (const d of docs) events.push({ kind: "document", timestamp: d.createdAt, field: "document.uploaded", before: "—", after: `${d.type} v${d.version} · ${d.status}` });
    if (cert) events.push({ kind: "certificate", timestamp: cert.createdAt, field: "certificate.tracked", before: "—", after: cert.status });

    events.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    return NextResponse.json({ events });
  },
);