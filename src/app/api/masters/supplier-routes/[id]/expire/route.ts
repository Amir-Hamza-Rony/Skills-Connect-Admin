/**
 * POST /api/masters/supplier-routes/[id]/expire — expire a supplier route
 * Mirrors Express `POST /supplier-routes/:id/expire`. Requires pricing.manage.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const POST = withAuth("pricing.manage",
  async (req: NextRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let routeId;
    try {
      routeId = toObjectId(id);
    } catch {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid supplier route id." } }, { status: 400 });
    }

    const { effectiveTo } = await req.json();

    const coll = await collection("supplier-routes");
    const existing = await coll.findOne({ _id: routeId });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Supplier route not found." } }, { status: 404 });
    }
    if (existing.status === "expired") {
      return NextResponse.json(
        { error: { code: "ALREADY_EXPIRED", message: "This route is already expired." } },
        { status: 422 },
      );
    }

    const when = effectiveTo ? new Date(effectiveTo) : new Date();
    await coll.updateOne(
      { _id: routeId },
      { $set: { status: "expired", effectiveTo: when, updatedAt: new Date() } },
    );

    const updated = await coll.findOne({ _id: routeId });
    return NextResponse.json({
      route: { id: String(updated?._id), ...updated, status: "expired", effectiveTo: when },
    });
  },
);
