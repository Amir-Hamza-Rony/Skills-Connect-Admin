/**
 * GET /api/reports/finance — headline finance numbers
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req) => {
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    if (from || to) {
      filter.createdAt = {};
      if (from) (filter.createdAt as Record<string, Date>).$gte = new Date(from);
      if (to) (filter.createdAt as Record<string, Date>).$lte = new Date(to);
    }

    const [orders, invoices, payments] = await Promise.all([
      (await collection("orders")).find(filter).toArray(),
      (await collection("invoices")).find(filter).toArray(),
      (await collection("payments")).find(filter).toArray(),
    ]);

    const invoiced = invoices.filter((i: any) => i.status !== "Void").reduce((s: number, i: any) => s + (i.total ?? 0), 0);
    const collected = payments.filter((p: any) => p.status !== "Void" && p.status !== "Refunded").reduce((s: number, p: any) => s + (p.allocatedAmount ?? 0), 0);
    const overdueInvoices = invoices.filter((i: any) => i.status === "Overdue");

    return NextResponse.json({
      orders: orders.length,
      clients: new Set(orders.map((o: any) => String(o.clientId))).size,
      invoiced,
      collected,
      outstanding: Math.max(0, invoiced - collected),
      overdueAmount: overdueInvoices.reduce((s: number, i: any) => s + (i.total ?? 0), 0),
      overdueCount: overdueInvoices.length,
      pipelineValue: orders.reduce((s: number, o: any) => s + (o.sellingPrice ?? 0), 0),
    });
  },
);
