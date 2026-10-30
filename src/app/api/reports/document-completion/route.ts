/**
 * GET /api/reports/document-completion — document completion & rejection rates
 * Mirrors Express `GET /reports/document-completion`. Requires reports.view.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

function parseFilter(searchParams: URLSearchParams): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  for (const key of ["salesAgentId", "sourceAgentId", "rtoId", "qualificationId"] as const) {
    const value = searchParams.get(key);
    if (value) {
      if (!isValidObjectId(value)) {
        throw new Error(`Invalid ${key}.`);
      }
      filter[key] = toObjectId(value);
    }
  }

  const stage = searchParams.get("stage");
  if (stage) filter.status = stage;

  const createdAt: Record<string, Date> = {};
  const from = searchParams.get("from");
  if (from) {
    const d = new Date(`${from}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid 'from' date.");
    createdAt.$gte = d;
  }
  const to = searchParams.get("to");
  if (to) {
    const d = new Date(`${to}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) throw new Error("Invalid 'to' date.");
    createdAt.$lte = d;
  }
  if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;

  return filter;
}

function isValidObjectId(id: string): boolean {
  try {
    toObjectId(id);
    return true;
  } catch {
    return false;
  }
}

export const GET = withAuth("reports.view",
  async (req: NextRequest) => {
    let filter: Record<string, unknown>;
    try {
      filter = parseFilter(req.nextUrl.searchParams);
    } catch (err: any) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: err.message ?? "Invalid filter." } },
        { status: 400 },
      );
    }

    const orders = await collection("orders");
    const orderIds = (
      await orders.find(filter, { projection: { _id: 1 } }).toArray()
    ).map((o: any) => o._id);

    const docs = await collection("documents");
    const documents = orderIds.length
      ? await docs.find({ orderId: { $in: orderIds } }).toArray()
      : [];

    const byType = new Map<string, { total: number; approved: number; rejected: number }>();
    for (const d of documents) {
      const row = byType.get(d.type) ?? { total: 0, approved: 0, rejected: 0 };
      row.total += 1;
      if (d.status === "Approved") row.approved += 1;
      if (d.status === "Rejected") row.rejected += 1;
      byType.set(d.type, row);
    }

    return NextResponse.json({
      byType: [...byType.entries()]
        .map(([type, v]) => ({
          type,
          total: v.total,
          approved: v.approved,
          rejected: v.rejected,
          approvalRate: v.total > 0 ? Math.round((v.approved / v.total) * 100) : 0,
          rejectionRate: v.total > 0 ? Math.round((v.rejected / v.total) * 100) : 0,
        }))
        .sort((a, b) => b.total - a.total),
    });
  },
);
