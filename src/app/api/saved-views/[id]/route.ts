/**
 * PATCH /api/saved-views/[id] — update saved view (requires orders.view)
 * DELETE /api/saved-views/[id] — delete saved view (requires orders.view)
 * Mirrors Express `PATCH/DELETE /saved-views/:id`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const PATCH = withAuth("orders.view",
  async (req: AuthedRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let viewId;
    try {
      viewId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid saved view id." } },
        { status: 400 },
      );
    }

    const userId = req.auth?.userId;
    const { name, filters, isDefault } = await req.json();

    const views = await collection("saved_views");
    const view = await views.findOne({ _id: viewId, userId });
    if (!view) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Saved view not found." } },
        { status: 404 },
      );
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof name === "string" && name.trim()) update.name = name.trim();
    if (filters !== undefined) update.filters = filters;
    if (typeof isDefault === "boolean") update.isDefault = isDefault;

    await views.updateOne({ _id: viewId }, { $set: update });

    return NextResponse.json({ ok: true });
  },
);

export const DELETE = withAuth("orders.view",
  async (req: AuthedRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let viewId;
    try {
      viewId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid saved view id." } },
        { status: 400 },
      );
    }

    const userId = req.auth?.userId;
    const views = await collection("saved_views");
    await views.deleteOne({ _id: viewId, userId });

    return NextResponse.json({ ok: true });
  },
);
