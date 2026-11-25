/**
 * POST /api/excel/bulk-quals — Bulk import qualifications from the "Course
 * Master" sheet of the Course_RTO_Price_Mapping_Import_Ready.xlsx file.
 *
 * Expected sheet: "Course Master" with headers in row 1.
 *
 * Column mapping (1-based):
 *   1  Course Code
 *   2  Qualification
 *
 * Qualifications are deduplicated by code.
 */
import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import * as ExcelJS from "exceljs";

const PERMISSION = "qualifications.manage";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SHEET_NAME = "Course Master";

const COL = {
  CODE: 1,
  TITLE: 2,
} as const;

function cellStr(cell: unknown): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") return String(cell);
  return String(cell);
}

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const auth = req.auth as { roleNames?: string[]; permissions?: string[] };
    if (
      !auth?.roleNames?.includes("SUPER_ADMIN") &&
      !auth?.permissions?.includes(PERMISSION)
    ) {
      return NextResponse.json(
        { error: { code: "FORBIDDEN", message: `Missing permission: ${PERMISSION}` } },
        { status: 403 },
      );
    }

    const actor = (req as AuthedRequest).auth!;
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "No file uploaded." } },
        { status: 400 },
      );
    }

    const ext = file.name.lastIndexOf(".") === -1 ? "" : file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (![".xlsx", ".xls"].includes(ext)) {
      return NextResponse.json(
        { error: { code: "UNSUPPORTED_TYPE", message: "Only .xlsx and .xls files are supported." } },
        { status: 422 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: { code: "FILE_TOO_LARGE", message: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit.` } },
        { status: 422 },
      );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const ws = workbook.getWorksheet(SHEET_NAME);
    if (!ws) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: `Sheet "${SHEET_NAME}" not found in workbook.` } },
        { status: 404 },
      );
    }

    const qualColl = await collection("qualifications");
    const allQuals = await qualColl.find().toArray();
    const qualByCode = new Map<string, any>();
    for (const q of allQuals) qualByCode.set(String(q.code), q);

    const now = new Date();
    let created = 0;
    let skipped = 0;
    const errors: Array<{ row: number; message: string }> = [];

    const client = await (await import("@/lib/db")).getClient();
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        // Headers in row 1. Data starts from row 2.
        for (let rowNum = 2; rowNum <= ws.rowCount; rowNum++) {
          const row = ws.getRow(rowNum);
          let hasAnyValue = false;
          row.eachCell((cell) => {
            if (cell.value !== null && cell.value !== undefined && cell.value !== "") {
              hasAnyValue = true;
            }
          });
          if (!hasAnyValue) continue;

          const code = cellStr(row.getCell(COL.CODE).value).trim().toUpperCase();
          const title = cellStr(row.getCell(COL.TITLE).value).trim();

          if (!code || !title) {
            skipped++;
            continue;
          }

          if (qualByCode.has(code)) {
            skipped++;
            continue;
          }

          await qualColl.insertOne({
            code,
            title,
            trainingPackage: "",
            industry: "",
            status: "current",
            licensingRefs: [],
            createdAt: now,
            updatedAt: now,
          }, { session });
          qualByCode.set(code, { code, title });
          created++;
        }
      });
    } catch (err: any) {
      await session.endSession().catch(() => {});
      return NextResponse.json(
        { error: { code: "SERVER_ERROR", message: err?.message ?? "Bulk qualification import failed." } },
        { status: 500 },
      );
    } finally {
      await session.endSession().catch(() => {});
    }

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_bulk_quals",
      entityId: null,
      action: "import",
      before: null,
      after: {
        filename: file.name,
        sheet: SHEET_NAME,
        created,
        skipped,
        errors: errors.length,
      },
    });

    return NextResponse.json({
      created,
      skipped,
      errors,
    }, { status: 201 });
  },
);
