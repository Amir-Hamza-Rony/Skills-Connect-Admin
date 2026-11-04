/**
 * GET /api/masters/price-categories — list price categories
 * POST /api/masters/price-categories — create a price category
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import {
  requireFields,
  normalizeCode,
  isPriceCategoryCodeUnique,
} from "@/lib/pricing-validation";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "pricing.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    code: d.code,
    name: d.name,
    description: d.description,
    status: d.status,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export const GET = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth as {
      roleNames?: string[];
      permissions?: string[];
    };
    if (
      !auth?.roleNames?.includes("Super Admin") &&
      !auth?.permissions?.includes(PERMISSION)
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } },
        { status: 403 },
      );
    }

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const coll = await collection("price_categories");
    const [docs, total] = await Promise.all([
      coll
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      coll.countDocuments(filter),
    ]);

    return NextResponse.json({
      items: docs.map(mapDoc),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth as {
      roleNames?: string[];
      permissions?: string[];
    };
    if (
      !auth?.roleNames?.includes("Super Admin") &&
      !auth?.permissions?.includes(PERMISSION)
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } },
        { status: 403 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const missing = requireFields(body, ["code", "name", "status"]);
    if (missing) {
      return NextResponse.json(
        { error: { code: missing.code, message: missing.message } },
        { status: 400 },
      );
    }

    const code = normalizeCode(body.code);
    if (!code) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Code is required." } },
        { status: 400 },
      );
    }

    if (!(await isPriceCategoryCodeUnique(code))) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: `Price category code ${code} already exists.` } },
        { status: 409 },
      );
    }

    const status = String(body.status);
    if (!["active", "inactive"].includes(status)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid status." } },
        { status: 400 },
      );
    }

    const now = new Date();
    const coll = await collection("price_categories");
    const result = await coll.insertOne({
      code,
      name: String(body.name).trim(),
      description: body.description ? String(body.description).trim() : null,
      status,
      createdAt: now,
      updatedAt: now,
    });

    const created = await coll.findOne({ _id: result.insertedId });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "price_category",
      entityId: String(created?._id),
      action: "create",
      before: null,
      after: { code, name: created?.name, status: created?.status },
    });

    return NextResponse.json({ priceCategory: mapDoc(created) }, { status: 201 });
  },
);
