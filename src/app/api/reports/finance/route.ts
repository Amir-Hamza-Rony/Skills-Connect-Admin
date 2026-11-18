/**
 * GET /api/reports/finance — headline finance numbers
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { filterOrdersByRole } from "@/middleware/auth";
import { applyFinancialVisibility } from "@/lib/financial-visibility";

export const GET = withAuth("reports.view",
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      filter.createdAt = {};
      if (from) (filter.createdAt as Record<string, Date>).$gte = new Date(from);
      if (to) (filter.createdAt as Record<string, Date>).$lte = new Date(to);
    }

    const [allOrders, invoices, payments] = await Promise.all([
      (await collection("orders")).find(filter).toArray(),
      (await collection("invoices")).find(filter).toArray(),
      (await collection("payments")).find(filter).toArray(),
    ]);

    const orders = filterOrdersByRole(auth, allOrders);

    const invoiced = invoices.filter((i: any) => i.status !== "Void").reduce((s: number, i: any) => s + (i.total ?? 0), 0);
    const collected = payments.filter((p: any) => p.status !== "Void" && p.status !== "Refunded").reduce((s: number, p: any) => s + (p.allocatedAmount ?? 0), 0);
    const overdueInvoices = invoices.filter((i: any) => i.status === "Overdue");

    const result = {
      orders: orders.length,
      clients: new Set(orders.map((o: any) => String(o.clientId))).size,
      invoiced,
      collected,
      outstanding: Math.max(0, invoiced - collected),
      overdueAmount: overdueInvoices.reduce((s: number, i: any) => s + (i.total ?? 0), 0),
      overdueCount: overdueInvoices.length,
      pipelineValue: orders.reduce((s: number, o: any) => s + (o.sellingPrice ?? 0), 0),
    };
    // Security hotfix: pipelineValue is price-derived and revenue aggregates
    // are hidden from B2B_AGENT; order/client counts remain visible.
    applyFinancialVisibility(auth, result);
    return NextResponse.json(result);
  },
);
