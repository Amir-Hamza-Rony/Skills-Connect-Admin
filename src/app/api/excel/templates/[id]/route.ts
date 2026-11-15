/**
 * GET /api/excel/templates/[id] — get a template
 * PATCH /api/excel/templates/[id] — update a template
 * DELETE /api/excel/templates/[id] — delete a template
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import type { ExcelImportTemplate } from "@/lib/types";

const PERMISSION = "finance.manage";

function mapDoc(d: any) {
  return {
    id: String(d._id),
    name: d.name,
    scope: d.scope,
    columnMappings: d.columnMappings,
    createdBy: d.createdBy ? String(d.createdBy) : null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    status: d.status,
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

export const GET = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const oid = safeObjectId(id);
    if (!oid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid id." } },
        { status: 400 },
      );
    }

    const coll = await collection("excel_import_templates");
    const doc = await coll.findOne({ _id: oid });
    if (!doc) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    }

    return NextResponse.json({ template: mapDoc(doc) });
  },
);

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
    if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id." } }, { status: 400 });

    const actor = (req as AuthedRequest).auth!;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const coll = await collection("excel_import_templates");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Name is required." } },
          { status: 400 },
        );
      }
      const dup = await coll.findOne({ name, _id: { $ne: oid } });
      if (dup) {
        return NextResponse.json(
          { error: { code: "CONFLICT", message: `Template name "${name}" already exists.` } },
          { status: 409 },
        );
      }
      update.name = name;
    }
    if (body.scope !== undefined) {
      const validScopes = new Set(["clients", "orders", "rtos", "agents", "qualifications"]);
      if (!validScopes.has(body.scope)) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid scope." } }, { status: 400 });
      }
      update.scope = body.scope;
    }
    if (body.columnMappings !== undefined) {
      if (!Array.isArray(body.columnMappings)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "columnMappings must be an array." } },
          { status: 400 },
        );
      }
      for (const m of body.columnMappings) {
        if (!m.sourceColumn || !m.targetField || typeof m.required !== "boolean") {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: "Each mapping needs sourceColumn, targetField, and required." } },
            { status: 400 },
          );
        }
        const validTypes = new Set(["string", "number", "date", "boolean", "email"]);
        if (!validTypes.has(m.dataType)) {
          return NextResponse.json(
            { error: { code: "BAD_REQUEST", message: `Invalid dataType: ${m.dataType}` } },
            { status: 400 },
          );
        }
      }
      update.columnMappings = body.columnMappings;
    }
    if (body.status !== undefined) {
      if (!["active", "inactive"].includes(body.status)) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid status." } }, { status: 400 });
      }
      update.status = body.status;
    }

    await coll.updateOne({ _id: oid }, { $set: update });
    const updated = await coll.findOne({ _id: oid });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_import_template",
      entityId: String(id),
      action: "update",
      before: { name: existing.name, scope: existing.scope, status: existing.status },
      after: { name: updated?.name, scope: updated?.scope, status: updated?.status },
    });

    return NextResponse.json({ template: mapDoc(updated) });
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
    if (!oid) return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id." } }, { status: 400 });

    const actor = (req as AuthedRequest).auth!;
    const coll = await collection("excel_import_templates");
    const existing = await coll.findOne({ _id: oid });
    if (!existing) {
      return NextResponse.json({ error: { code: "NOT_FOUND", message: "Template not found." } }, { status: 404 });
    }

    await coll.deleteOne({ _id: oid });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_import_template",
      entityId: String(id),
      action: "delete",
      before: { name: existing.name, scope: existing.scope },
      after: null,
    });

    return NextResponse.json({ ok: true, id: String(oid) });
  },
);
