/**
 * GET /api/excel/imports — list import history
 * GET /api/excel/imports/[id] — get import details with row results
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const PERMISSION = "finance.manage";

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

function mapImport(d: any) {
  return {
    id: String(d._id),
    templateId: d.templateId ? String(d.templateId) : null,
    filename: d.filename,
    status: d.status,
    rowCounts: d.rowCounts,
    startedBy: d.startedBy ? String(d.startedBy) : null,
    startedAt: d.startedAt,
    completedAt: d.completedAt,
    errorSummary: d.errorSummary,
  };
}

export const GET = withAuth(
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> },
  ) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

    // If params.id is present, return a single import; otherwise list.
    const resolvedParams = (await params) ?? {};
    const { id } = resolvedParams;

    if (id) {
      const oid = safeObjectId(id);
      if (!oid) {
        return NextResponse.json({ error: { code: "INVALID_ID", message: "Invalid id." } }, { status: 400 });
      }
      const coll = await collection("excel_imports");
      const doc = await coll.findOne({ _id: oid });
      if (!doc) {
        return NextResponse.json({ error: { code: "NOT_FOUND", message: "Import not found." } }, { status: 404 });
      }

      // Also fetch row results.
      const rows = await (await collection("excel_import_rows"))
        .find({ importId: oid })
        .sort({ rowNumber: 1 })
        .toArray();

      return NextResponse.json({
        import: mapImport(doc),
        rows: rows.map((r: any) => ({
          id: String(r._id),
          rowNumber: r.rowNumber,
          status: r.status,
          errorMessage: r.errorMessage,
          targetRecordId: r.targetRecordId ? String(r.targetRecordId) : null,
        })),
      });
    }

    // List imports.
    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const coll = await collection("excel_imports");
    const [docs, total] = await Promise.all([
      coll
        .find(filter)
        .sort({ startedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      coll.countDocuments(filter),
    ]);

    return NextResponse.json({
      imports: docs.map(mapImport),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);
