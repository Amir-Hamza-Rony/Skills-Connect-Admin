/**
 * GET /api/reports/orders — Order report
 *
 * Per-order aggregation: status, selling price, supplier cost, margin,
 * payments allocated, document count, workflow stage.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const status = searchParams.get("status");
    const clientId = searchParams.get("clientId");
    const qualificationId = searchParams.get("qualificationId");
    const rtoId = searchParams.get("rtoId");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (from || to) {
      filter.createdAt = {};
      if (from) (filter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (filter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }
    if (status) filter.status = status;
    if (clientId) {
      const oid = safeObjectId(clientId);
      if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid client id." } }, { status: 400 });
      filter.clientId = oid;
    }
    if (qualificationId) {
      const oid = safeObjectId(qualificationId);
      if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid qualification id." } }, { status: 400 });
      filter.qualificationId = oid;
    }
    if (rtoId) {
      const oid = safeObjectId(rtoId);
      if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid rto id." } }, { status: 400 });
      filter.rtoId = oid;
    }

    const [orders, clients, qualifications, rtos, invoices, payments, documents, tasks] = await Promise.all([
      (await collection("orders")).find(filter).toArray(),
      (await collection("clients")).find({}).toArray(),
      (await collection("qualifications")).find({}).toArray(),
      (await collection("rtos")).find({}).toArray(),
      (await collection("invoices")).find({}).toArray(),
      (await collection("payments")).find({}).toArray(),
      (await collection("documents")).find({}).toArray(),
      (await collection("workflow-tasks")).find({}).toArray(),
    ]);

    const clientMap = new Map(clients.map((c: any) => [String(c._id), c.legalName]));
    const qualMap = new Map(qualifications.map((q: any) => [String(q._id), q.code]));
    const rtoMap = new Map(rtos.map((r: any) => [String(r._id), r.tradingName]));

    // Per-order invoice totals and payment allocations.
    const invByOrder = new Map<string, { invoiced: number; paid: number }>();
    for (const inv of invoices) {
      if (inv.status === "Void") continue;
      const m = invByOrder.get(String(inv.orderId)) || { invoiced: 0, paid: 0 };
      m.invoiced += Number(inv.total ?? 0);
      invByOrder.set(String(inv.orderId), m);
    }
    for (const p of payments) {
      if (p.status === "Void" || p.status === "Refunded") continue;
      const m = invByOrder.get(String(p.orderId)) || { invoiced: 0, paid: 0 };
      m.paid += Number(p.allocatedAmount ?? 0);
      invByOrder.set(String(p.orderId), m);
    }

    // Document count per order.
    const docCountByOrder = new Map<string, number>();
    for (const d of documents) {
      const c = docCountByOrder.get(String(d.orderId)) || 0;
      docCountByOrder.set(String(d.orderId), c + 1);
    }

    // Latest task status per order.
    const taskByOrder = new Map<string, any>();
    for (const t of tasks) {
      const existing = taskByOrder.get(String(t.orderId));
      if (!existing || new Date(t.createdAt ?? 0) > new Date(existing.createdAt ?? 0)) {
        taskByOrder.set(String(t.orderId), t);
      }
    }

    const rows = orders.map((o: any) => {
      const inv = invByOrder.get(String(o._id)) || { invoiced: 0, paid: 0 };
      const margin = Number(o.sellingPrice ?? 0) - Number(o.supplierCostSnapshot ?? 0) - Number(o.otherCost ?? 0);
      return {
        id: String(o._id),
        clientName: clientMap.get(String(o.clientId)) ?? String(o.clientId),
        qualificationCode: qualMap.get(String(o.qualificationId)) ?? String(o.qualificationId),
        rtoName: rtoMap.get(String(o.rtoId)) ?? String(o.rtoId),
        status: o.status,
        evidenceStatus: o.evidenceStatus,
        rtoSubmissionStatus: o.rtoSubmissionStatus,
        certificateStatus: o.certificateStatus,
        sellingPrice: Number(o.sellingPrice ?? 0),
        supplierCost: Number(o.supplierCostSnapshot ?? 0),
        otherCost: Number(o.otherCost ?? 0),
        margin,
        currency: o.currency,
        invoiced: inv.invoiced,
        paid: inv.paid,
        outstanding: Math.max(0, inv.invoiced - inv.paid),
        documentCount: docCountByOrder.get(String(o._id)) || 0,
        taskStatus: taskByOrder.get(String(o._id))?.status ?? null,
        taskAssignee: taskByOrder.get(String(o._id))?.assigneeId ?? null,
        createdAt: o.createdAt,
      };
    });

    const total = rows.length;
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    return NextResponse.json({
      orders: paged,
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);
