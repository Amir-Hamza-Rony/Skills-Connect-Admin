/**
 * GET /api/reports/margin — margin by qualification
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("reports.view",
  async (req) => {
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};
    const qual = searchParams.get("qualificationId");
    if (qual) filter.qualificationId = toObjectId(qual);

    const [orders, qualifications] = await Promise.all([
      (await collection("orders")).find(filter).toArray(),
      (await collection("qualifications")).find().toArray(),
    ]);

    const qualMap = new Map<string, string>(qualifications.map((q: any) => [String(q._id), q.code]));
    const byQual = new Map<string, { orders: number; revenue: number; cost: number; margin: number }>();

    for (const o of orders) {
      const name = qualMap.get(String(o.qualificationId)) ?? String(o.qualificationId);
      const margin = (o.sellingPrice ?? 0) - (o.supplierCostSnapshot ?? 0) - (o.otherCost ?? 0);
      const r = byQual.get(name) ?? { orders: 0, revenue: 0, cost: 0, margin: 0 };
      r.orders += 1; r.revenue += o.sellingPrice ?? 0; r.cost += (o.supplierCostSnapshot ?? 0) + (o.otherCost ?? 0); r.margin += margin;
      byQual.set(name, r);
    }

    return NextResponse.json({
      byQualification: [...byQual.entries()].map(([n, v]) => ({ name: n, ...v, percent: v.revenue > 0 ? Math.round((v.margin / v.revenue) * 100) : 0 })),
    });
  },
);
