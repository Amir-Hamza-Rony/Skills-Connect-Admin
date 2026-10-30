/**
 * GET /api/payment-plans — list all payment plans (requires finance.view)
 * Mirrors Express `GET /payment-plans`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("finance.view",
  async (req: NextRequest) => {
    const plans = await collection("payment-plans");
    const docs = await plans.find().sort({ createdAt: -1 }).toArray();

    return NextResponse.json({
      plans: docs.map((d: any) => ({
        id: String(d._id),
        orderId: String(d.orderId),
        total: d.total,
        instalments: d.instalments ?? [],
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  },
);
