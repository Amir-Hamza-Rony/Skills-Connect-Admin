/**
 * GET /api/saved-views — list saved views (requires orders.view)
 * POST /api/saved-views — create saved view (requires orders.view)
 * Mirrors Express `GET/POST /saved-views`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("orders.view",
  async (req: AuthedRequest) => {
    const scope = req.nextUrl.searchParams.get("scope");
    const userId = req.auth?.userId;

    const filter: Record<string, unknown> = { userId };
    if (scope && ["orders", "documents", "finance", "clients"].includes(scope)) {
      filter.scope = scope;
    }

    const views = await collection("saved_views");
    const docs = await views.find(filter).sort({ updatedAt: -1 }).toArray();

    return NextResponse.json({
      savedViews: docs.map((d: any) => ({
        id: String(d._id),
        userId: String(d.userId),
        name: d.name,
        scope: d.scope,
        filters: d.filters ?? {},
        isDefault: d.isDefault ?? false,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  },
);

export const POST = withAuth("orders.view",
  async (req: AuthedRequest) => {
    const userId = req.auth?.userId;
    const { name, scope, filters, isDefault } = await req.json();

    if (!name || typeof name !== "string" || !name.trim()) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "name is required." } },
        { status: 400 },
      );
    }
    if (!scope || !["orders", "documents", "finance", "clients"].includes(scope)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid scope." } },
        { status: 400 },
      );
    }

    const views = await collection("saved_views");
    const now = new Date();
    const result = await views.insertOne({
      userId,
      name: name.trim(),
      scope,
      filters: filters ?? {},
      isDefault: isDefault ?? false,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json(
      {
        savedView: {
          id: String(result.insertedId),
          userId,
          name: name.trim(),
          scope,
          filters: filters ?? {},
          isDefault: isDefault ?? false,
          createdAt: now,
          updatedAt: now,
        },
      },
      { status: 201 },
    );
  },
);
