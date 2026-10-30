/**
 * GET /api/reports/collections — invoiced vs collected by month
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req) => {
    const invoices = await collection("invoices");
    const payments = await collection("payments");
    const orders = await collection("orders");

    const [invDocs, payDocs, orderDocs] = await Promise.all([
      invoices.find().toArray(),
      payments.find().toArray(),
      orders.find().toArray(),
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

    return NextResponse.json({ months });
  },
);