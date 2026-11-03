/**
 * PATCH /api/masters/qualification-rto-mappings/[id] — update a mapping
 * DELETE /api/masters/qualification-rto-mappings/[id] — remove a mapping
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";

const COLLECTION = "qualification-rto-mappings";
const PERMISSION = "qualifications.manage";

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

function mapDoc(d: any) {
  return {
    id: String(d._id),
    qualificationId: String(d.qualificationId),
    rtoId: String(d.rtoId),
    status: d.status,
    effectiveFrom: d.effectiveFrom,
    effectiveTo: d.effectiveTo,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

async function requireAuth(req: AuthedRequest) {
  const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
  if (!auth?.roleNames?.includes("Super Admin") && !auth?.permissions?.includes(PERMISSION)) {
    return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } }, { status: 403 });
  }
  return null;
}

export const PATCH = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const mappingId = safeObjectId(id);
    if (!mappingId) return invalidId();

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const coll = await collection(COLLECTION);
    const existing = await coll.findOne({ _id: mappingId });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Mapping not found." } }, { status: 404 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) {
      if (!["active", "inactive"].includes(String(body.status))) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid status." } }, { status: 400 });
      }
      update.status = String(body.status);
    }
    if (body.effectiveFrom !== undefined) {
      const d = new Date(String(body.effectiveFrom));
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Effective from date is invalid." } }, { status: 400 });
      }
      update.effectiveFrom = d.toISOString();
    }
    if (body.effectiveTo !== undefined) {
      update.effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)).toISOString() : null;
      if (update.effectiveTo && Number.isNaN(new Date(update.effectiveTo as string).getTime())) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Effective to date is invalid." } }, { status: 400 });
      }
    }

    await coll.updateOne({ _id: mappingId }, { $set: update });
    const updated = await coll.findOne({ _id: mappingId });
    return NextResponse.json({ mapping: mapDoc(updated) });
  },
);

export const DELETE = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined }) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const mappingId = safeObjectId(id);
    if (!mappingId) return invalidId();

    const coll = await collection(COLLECTION);
    const existing = await coll.findOne({ _id: mappingId });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Mapping not found." } }, { status: 404 });
    }

    await coll.deleteOne({ _id: mappingId });
    return NextResponse.json({ ok: true, id: String(mappingId) });
  },
);
