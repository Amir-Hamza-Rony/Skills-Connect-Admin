/**
 * GET /api/finance/summary — dashboard finance numbers
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("finance.view",
  async (req) => {
    const invoices = await (await collection("invoices")).find().toArray();
    const payments = await (await collection("payments")).find().toArray();

    const invoiced = invoices.filter((i: any) => i.status !== "Void").reduce((s: number, i: any) => s + (i.total ?? 0), 0);
    const collected = payments.filter((p: any) => p.status !== "Void" && p.status !== "Refunded").reduce((s: number, p: any) => s + (p.allocatedAmount ?? 0), 0);

    return NextResponse.json({ invoiced, collected, outstanding: Math.max(0, invoiced - collected) });
  },
);
