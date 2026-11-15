/**
 * PATCH /api/masters/price-lists/[id] — update a price list
 * DELETE /api/masters/price-lists/[id] — delete a price list
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import {
  isValidCurrency,
  isValidDate,
  isPositiveAmount,
  invalidId,
  priceListOverlaps,
} from "@/lib/pricing-validation";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "pricing.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    qualificationId: String(d.qualificationId),
    priceCategoryId: String(d.priceCategoryId),
    amount: d.amount,
    currency: d.currency,
    effectiveFrom: d.effectiveFrom,
    effectiveTo: d.effectiveTo,
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

    const coll = await collection("price_lists");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Price list not found." } },
        { status: 404 },
      );
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!isPositiveAmount(amount)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Amount must be a non-negative number." } },
          { status: 400 },
        );
      }
      update.amount = amount;
    }
    if (body.currency !== undefined) {
      if (!isValidCurrency(body.currency)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid currency." } },
          { status: 400 },
        );
      }
      update.currency = body.currency;
    }
    if (body.effectiveFrom !== undefined) {
      if (!isValidDate(body.effectiveFrom)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } },
          { status: 400 },
        );
      }
      update.effectiveFrom = new Date(String(body.effectiveFrom)).toISOString();
    }
    if (body.effectiveTo !== undefined) {
      update.effectiveTo = body.effectiveTo
        ? new Date(String(body.effectiveTo)).toISOString()
        : null;
      if (update.effectiveTo && !isValidDate(update.effectiveTo)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } },
          { status: 400 },
        );
      }
    }
    if (body.status !== undefined) {
      if (!["active", "inactive", "draft"].includes(String(body.status))) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid status." } },
          { status: 400 },
        );
      }
      update.status = String(body.status);
    }

    // Recompute overlap check for active status using proposed values.
    const newStatus = update.status ?? existing.status;
    if (newStatus === "active") {
      const ef = update.effectiveFrom
        ? new Date(update.effectiveFrom as string)
        : new Date(existing.effectiveFrom);
      const et = update.effectiveTo !== undefined
        ? (update.effectiveTo ? new Date(update.effectiveTo as string) : null)
        : existing.effectiveTo
          ? new Date(existing.effectiveTo)
          : null;
      const overlaps = await priceListOverlaps(
        existing.qualificationId,
        existing.priceCategoryId,
        ef,
        et,
        existing._id,
      );
      if (overlaps) {
        return NextResponse.json(
          {
            error: {
              code: "CONFLICT",
              message: "An active price list already exists for this qualification and category with an overlapping effective period.",
            },
          },
          { status: 409 },
        );
      }
    }

    await coll.updateOne({ _id: oid }, { $set: update });
    const updated = await coll.findOne({ _id: oid });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "price_list",
      entityId: String(id),
      action: "update",
      before: {
        amount: existing.amount,
        currency: existing.currency,
        status: existing.status,
      },
      after: {
        amount: updated?.amount,
        currency: updated?.currency,
        status: updated?.status,
      },
    });

    return NextResponse.json({ priceList: mapDoc(updated) });
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

    const coll = await collection("price_lists");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Price list not found." } },
        { status: 404 },
      );
    }

    await coll.deleteOne({ _id: oid });

    const actor = (req as AuthedRequest).auth!;
    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "price_list",
      entityId: String(id),
      action: "delete",
      before: {
        qualificationId: String(existing.qualificationId),
        priceCategoryId: String(existing.priceCategoryId),
        amount: existing.amount,
        status: existing.status,
      },
      after: null,
    });

    return NextResponse.json({ ok: true, id: String(oid) });
  },
);
