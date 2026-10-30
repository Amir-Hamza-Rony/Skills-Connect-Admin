/**
 * PATCH /api/masters/[type]/[id] — update a master item
 * Mirrors Express `PATCH /agents/:id`, `/qualifications/:id`, `/rtos/:id`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission, type AuthedRequest } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

const PERMISSION_MAP: Record<string, string> = {
  qualifications: "qualifications.manage",
  rtos: "rto.manage",
  agents: "agents.manage",
  "supplier-routes": "pricing.manage",
};

export const PATCH = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ type?: string; id?: string }> | { type?: string; id?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { type, id } = resolvedParams;

    const perm = PERMISSION_MAP[String(type)];
    if (!perm) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Unknown master type." } }, { status: 404 });
    }

    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (!auth?.roleNames?.includes("Super Admin") && !auth?.permissions?.includes(perm)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: `Missing permission: ${perm}` } }, { status: 403 });
    }

    let masterId;
    try {
      masterId = toObjectId(id);
    } catch {
      return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid master id." } }, { status: 400 });
    }

    const body = await req.json();
    const coll = await collection(String(type));
    const existing = await coll.findOne({ _id: masterId });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Master item not found." } }, { status: 404 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of Object.keys(body)) {
      if (k !== "_id" && k !== "createdAt") update[k] = body[k];
    }

    await coll.updateOne({ _id: masterId }, { $set: update });

    const updated = await coll.findOne({ _id: masterId });
    return NextResponse.json({ item: { id: String(updated?._id), ...updated } });
  },
);
