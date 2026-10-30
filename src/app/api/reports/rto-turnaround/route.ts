/**
 * GET /api/reports/rto-turnaround — days from order creation to completion, by RTO
 * Mirrors Express `GET /reports/rto-turnaround`. Requires reports.view.
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

    const rtos = await collection("rtos");
    const rtoRows = await rtos.find().toArray();
    const rtoMap = new Map<string, string>(
      rtoRows.map((r: any) => [String(r._id), r.legalName]),
    );

    const orders = await collection("orders");
    const completedOrders = await orders
      .find({ ...filter, completedAt: { $ne: null } })
      .toArray();

    const byRto = new Map<string, { completed: number; totalDays: number }>();
    for (const oRaw of completedOrders) {
      const o = oRaw as any;
      const name = rtoMap.get(String(o.rtoId)) ?? String(o.rtoId);
      const row = byRto.get(name) ?? { completed: 0, totalDays: 0 };
      row.completed += 1;
      row.totalDays += Math.round(
        (new Date(o.completedAt).getTime() - new Date(o.createdAt).getTime()) / 86_400_000,
      );
      byRto.set(name, row);
    }

    const rows = [...byRto.entries()].map(([name, v]) => ({
      name,
      completed: v.completed,
      averageDays:
        v.completed > 0 ? Math.round((v.totalDays / v.completed) * 10) / 10 : 0,
    }));

    const totalCompleted = rows.reduce((sum, r) => sum + r.completed, 0);

    return NextResponse.json({
      totalCompleted,
      averageDays:
        totalCompleted > 0
          ? Math.round(
              (rows.reduce((sum, r) => sum + r.averageDays * r.completed, 0) /
                totalCompleted) *
                10,
            ) / 10
          : 0,
      byRto: rows,
    });
  },
);
