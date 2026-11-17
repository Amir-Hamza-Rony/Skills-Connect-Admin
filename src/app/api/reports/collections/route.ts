/**
 * GET /api/reports/collections — invoiced vs collected by month
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
    const invoices = await collection("invoices");
    const payments = await collection("payments");
    const orders = await collection("orders");

    const allOrderDocs = await orders.find().toArray();
    const orderDocs = filterOrdersByRole(auth, allOrderDocs);

    // Restrict invoices and payments to orders accessible to the caller for
    // non-admin roles; admins see everything. Mirrors the outstanding report pattern.
    const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
    let accessibleOrderIds: any[] | undefined;
    if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
      accessibleOrderIds = orderDocs.map((o: any) => o._id);
    }

    const invoiceFilter: Record<string, unknown> = {};
    const paymentFilter: Record<string, unknown> = {};
    if (accessibleOrderIds) {
      invoiceFilter.orderId = { $in: accessibleOrderIds };
      paymentFilter.orderId = { $in: accessibleOrderIds };
    }

    const [invDocs, payDocs] = await Promise.all([
      invoices.find(invoiceFilter).toArray(),
      payments.find(paymentFilter).toArray(),
    ]);

    const byMonth: Record<string, { invoiced: number; collected: number; orders: number }> = {};

    for (const inv of invDocs) {
      if (inv.status === "Void") continue;
      const key = new Date(inv.createdAt).toISOString().slice(0, 7);
      if (!byMonth[key]) byMonth[key] = { invoiced: 0, collected: 0, orders: 0 };
      byMonth[key].invoiced += inv.total ?? 0;
    }

    for (const pay of payDocs) {
      if (pay.status === "Void" || pay.status === "Refunded") continue;
      const key = new Date(pay.createdAt).toISOString().slice(0, 7);
      if (!byMonth[key]) byMonth[key] = { invoiced: 0, collected: 0, orders: 0 };
      byMonth[key].collected += pay.allocatedAmount ?? 0;
    }

    for (const o of orderDocs) {
      const key = new Date(o.createdAt).toISOString().slice(0, 7);
      if (!byMonth[key]) byMonth[key] = { invoiced: 0, collected: 0, orders: 0 };
      byMonth[key].orders += 1;
    }

    const months = Object.entries(byMonth)
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const response = { months };
    applyFinancialVisibility(auth, response);
    return NextResponse.json(response);
  },
);
