/**
 * PATCH /api/masters/price-categories/[id] — update a price category
 * DELETE /api/masters/price-categories/[id] — delete a price category
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import {
  normalizeCode,
  isPriceCategoryCodeUnique,
  invalidId,
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

async function requireAuth(req: AuthedRequest) {
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
  return null;
}

export const PATCH = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const coll = await collection("price_categories");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Price category not found." } },
        { status: 404 },
      );
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.code !== undefined) {
      const code = normalizeCode(body.code);
      if (!(await isPriceCategoryCodeUnique(code, String(existing._id)))) {
        return NextResponse.json(
          { error: { code: "CONFLICT", message: `Price category code ${code} already exists.` } },
          { status: 409 },
        );
      }
      update.code = code;
    }
    if (body.name !== undefined) update.name = String(body.name).trim();
    if (body.description !== undefined)
      update.description = String(body.description ?? "").trim() || null;
    if (body.status !== undefined) {
      if (!["active", "inactive"].includes(String(body.status))) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid status." } },
          { status: 400 },
        );
      }
      update.status = String(body.status);
    }

    await coll.updateOne({ _id: oid }, { $set: update });
    const updated = await coll.findOne({ _id: oid });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "price_category",
      entityId: String(id),
      action: "update",
      before: { code: existing.code, name: existing.name, status: existing.status },
      after: {
        code: updated?.code,
        name: updated?.name,
        status: updated?.status,
      },
    });

    return NextResponse.json({ priceCategory: mapDoc(updated) });
  },
);

export const DELETE = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    const coll = await collection("price_categories");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Price category not found." } },
        { status: 404 },
      );
    }

    await coll.deleteOne({ _id: oid });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "price_category",
      entityId: String(id),
      action: "delete",
      before: { code: existing.code, name: existing.name, status: existing.status },
      after: null,
    });

    return NextResponse.json({ ok: true, id: String(oid) });
  },
);
