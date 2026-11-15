/**
 * GET /api/reports/supplier-costs — Supplier cost / payables report
 *
 * Per-qualification/RTO: supplier cost total vs client invoiced total,
 * margin. Multi-currency aware.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const { searchParams } = req.nextUrl;
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const qualificationId = searchParams.get("qualificationId");
    const rtoId = searchParams.get("rtoId");

    const orderFilter: Record<string, unknown> = {};
    if (from || to) {
      orderFilter.createdAt = {};
      if (from) (orderFilter.createdAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (orderFilter.createdAt as Record<string, unknown>).$lte = new Date(to);
    }
    if (qualificationId) {
      const oid = safeObjectId(qualificationId);
      if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid qualification id." } }, { status: 400 });
      orderFilter.qualificationId = oid;
    }
    if (rtoId) {
      const oid = safeObjectId(rtoId);
      if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid rto id." } }, { status: 400 });
      orderFilter.rtoId = oid;
    }

    const [orders, qualifications, rtos, invoices] = await Promise.all([
      (await collection("orders")).find(orderFilter).toArray(),
      (await collection("qualifications")).find({}).toArray(),
      (await collection("rtos")).find({}).toArray(),
      (await collection("invoices")).find({}).toArray(),
    ]);

    const qualMap = new Map(qualifications.map((q: any) => [String(q._id), q.code]));
    const rtoMap = new Map(rtos.map((r: any) => [String(r._id), r.tradingName]));

    // Invoiced per order.
    const invoicedByOrder = new Map<string, { invoiced: number; currency: string }>();
    for (const inv of invoices) {
      if (inv.status === "Void") continue;
      const m = invoicedByOrder.get(String(inv.orderId)) || { invoiced: 0, currency: inv.currency || "AUD" };
      m.invoiced += Number(inv.total ?? 0);
      invoicedByOrder.set(String(inv.orderId), m);
    }

    // Per qualification+RTO+currency aggregation.
    const map = new Map<string, {
      qualificationCode: string; qualificationId: string;
      rtoName: string; rtoId: string;
      currency: string;
      orders: number; supplierCost: number; clientInvoiced: number; margin: number;
    }>();

    for (const o of orders) {
      const inv = invoicedByOrder.get(String(o._id));
      const clientInvoiced = inv ? inv.invoiced : 0;
      const currency = inv ? inv.currency : (o.currency || "AUD");
      const key = `${String(o.qualificationId)}|${String(o.rtoId)}|${currency}`;
      let entry = map.get(key) as { qualificationCode: string; qualificationId: string; rtoName: string; rtoId: string; currency: string; orders: number; supplierCost: number; clientInvoiced: number; margin: number } | undefined;
      if (!entry) {
        entry = {
          qualificationCode: String(qualMap.get(String(o.qualificationId)) ?? o.qualificationId),
          qualificationId: String(o.qualificationId),
          rtoName: String(rtoMap.get(String(o.rtoId)) ?? o.rtoId),
          rtoId: String(o.rtoId),
          currency,
          orders: 0,
          supplierCost: 0,
          clientInvoiced: 0,
          margin: 0,
        };
        map.set(key, entry!);
      }
      entry!.orders += 1;
      entry!.supplierCost += Number(o.supplierCostSnapshot ?? 0);
      entry!.clientInvoiced += clientInvoiced;
      entry!.margin += clientInvoiced - Number(o.supplierCostSnapshot ?? 0) - Number(o.otherCost ?? 0);
    }

    const rows = Array.from(map.values());
    const total = rows.length;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);
    const start = (page - 1) * pageSize;
    const paged = rows.slice(start, start + pageSize);

    return NextResponse.json({
      supplierCosts: paged,
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
      totals: {
        orders: rows.reduce((s, r) => s + r.orders, 0),
        supplierCost: rows.reduce((s, r) => s + r.supplierCost, 0),
        clientInvoiced: rows.reduce((s, r) => s + r.clientInvoiced, 0),
        margin: rows.reduce((s, r) => s + r.margin, 0),
      },
    });
  },
);
