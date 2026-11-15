/**
 * GET /api/excel/templates — list import templates
 * POST /api/excel/templates — create an import template
 *
 * Templates define reusable Excel column mappings for bulk imports.
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
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    const { searchParams } = req.nextUrl;
    const scope = searchParams.get("scope");
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (scope) filter.scope = scope;
    if (status) filter.status = status;

    const coll = await collection("excel_import_templates");
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
    const denied = await requireAuth(req);
    if (denied) return denied;

    const actor = (req as AuthedRequest).auth!;
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const { name, scope, columnMappings, status } = body;

    if (!name || !scope || !Array.isArray(columnMappings)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "name, scope, and columnMappings are required." } },
        { status: 400 },
      );
    }

    const validScopes = new Set(["clients", "orders", "rtos", "agents", "qualifications"]);
    if (!validScopes.has(scope)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid scope." } },
        { status: 400 },
      );
    }

    const validStatuses = new Set(["active", "inactive"]);
    const templateStatus = status ?? "active";
    if (!validStatuses.has(templateStatus)) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid status." } },
        { status: 400 },
      );
    }

    // Validate column mappings.
    for (const mapping of columnMappings) {
      if (!mapping.sourceColumn || !mapping.targetField || typeof mapping.required !== "boolean") {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: "Each mapping needs sourceColumn, targetField, and required." } },
          { status: 400 },
        );
      }
      const validTypes = new Set(["string", "number", "date", "boolean", "email"]);
      if (!validTypes.has(mapping.dataType)) {
        return NextResponse.json(
          { error: { code: "BAD_REQUEST", message: `Invalid dataType: ${mapping.dataType}` } },
          { status: 400 },
        );
      }
    }

    // Duplicate prevention: template name must be unique.
    const coll = await collection("excel_import_templates");
    const existing = await coll.findOne({ name });
    if (existing) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: `Template name "${name}" already exists.` } },
        { status: 409 },
      );
    }

    const now = new Date();
    const result = await coll.insertOne({
      name: String(name).trim(),
      scope,
      columnMappings,
      createdBy: actor.userId,
      createdAt: now,
      updatedAt: now,
      status: templateStatus,
    });

    const created = await coll.findOne({ _id: result.insertedId });

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_import_template",
      entityId: String(created?._id),
      action: "create",
      before: null,
      after: { name: created?.name, scope: created?.scope, status: created?.status },
    });

    return NextResponse.json({ template: mapDoc(created) }, { status: 201 });
  },
);
