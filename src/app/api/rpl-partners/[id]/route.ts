/**
 * GET /api/rpl-partners/[id] — get an RPL partner
 * PATCH /api/rpl-partners/[id] — update an RPL partner
 * DELETE /api/rpl-partners/[id] — deactivate an RPL partner (soft delete via status)
 *
 * Requires `rplPartners.view` (get) or `rplPartners.manage` (update/delete).
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { normalizeCode } from "@/lib/master-validation";

const VIEW_PERM = "rplPartners.view";
const WRITE_PERM = "rplPartners.manage";

const VALID_STATUSES = new Set(["active", "inactive"]);

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export const GET = withAuth(VIEW_PERM,
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const masterId = safeObjectId(resolvedParams?.id);
    if (!masterId) return invalidId();

    const coll = await collection("rpl_partners");
    const doc = await coll.findOne({ _id: masterId });
    if (!doc) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "RPL partner not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ rplPartner: { id: String(doc._id), ...doc } });
  },
);

export const PATCH = withAuth(WRITE_PERM,
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const masterId = safeObjectId(resolvedParams?.id);
    if (!masterId) return invalidId();

    const auth = req.auth!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const coll = await collection("rpl_partners");
    const existing = await coll.findOne({ _id: masterId });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "RPL partner not found." } },
        { status: 404 },
      );
    }

    const before = { partnerCode: existing.partnerCode, legalName: existing.legalName, status: existing.status };
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (body.partnerCode !== undefined) {
      const code = normalizeCode(body.partnerCode);
      const dup = await coll.findOne({ partnerCode: code, _id: { $ne: masterId } });
      if (dup) {
        return NextResponse.json(
          { error: { code: "CONFLICT", message: `Partner code ${code} already exists.` } },
          { status: 409 },
        );
      }
      update.partnerCode = code;
    }
    if (body.legalName !== undefined) update.legalName = String(body.legalName).trim();
    if (body.tradingName !== undefined) update.tradingName = String(body.tradingName ?? "").trim() || null;
    if (body.contactPerson !== undefined) update.contactPerson = String(body.contactPerson ?? "").trim() || null;
    if (body.email !== undefined) update.email = String(body.email ?? "").trim() || null;
    if (body.phone !== undefined) update.phone = String(body.phone ?? "").trim() || null;
    if (body.address !== undefined) update.address = String(body.address ?? "").trim() || null;
    if (body.notes !== undefined) update.notes = String(body.notes ?? "").trim() || null;
    if (body.status !== undefined) {
      if (!VALID_STATUSES.has(String(body.status))) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Invalid status." } },
          { status: 400 },
        );
      }
      update.status = String(body.status);
    }

    await coll.updateOne({ _id: masterId }, { $set: update });
    const updated = await coll.findOne({ _id: masterId });

    await writeAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      entityType: "rpl_partner",
      entityId: String(masterId),
      action: "update",
      before,
      after: { partnerCode: updated?.partnerCode, legalName: updated?.legalName, status: updated?.status },
    });

    return NextResponse.json({ rplPartner: { id: String(updated?._id), ...updated } });
  },
);

export const DELETE = withAuth(WRITE_PERM,
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const masterId = safeObjectId(resolvedParams?.id);
    if (!masterId) return invalidId();

    const auth = req.auth!;
    const coll = await collection("rpl_partners");
    const existing = await coll.findOne({ _id: masterId });
    if (!existing) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "RPL partner not found." } },
        { status: 404 },
      );
    }

    // Soft delete: set status to inactive instead of removing the record,
    // preserving historical references on orders.
    await coll.updateOne({ _id: masterId }, { $set: { status: "inactive", updatedAt: new Date() } });

    await writeAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      entityType: "rpl_partner",
      entityId: String(masterId),
      action: "deactivate",
      before: { status: existing.status },
      after: { status: "inactive" },
    });

    return NextResponse.json({ ok: true });
  },
);
