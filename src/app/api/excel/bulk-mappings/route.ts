/**
 * POST /api/excel/bulk-mappings — Bulk import qualification↔RTO mappings
 * from the "Mapping Candidates" sheet of the
 * Course_RTO_Price_Mapping_Import_Ready.xlsx file.
 *
 * Expected sheet: "Mapping Candidates" with headers in row 1.
 *
 * Column mapping (1-based):
 *   1  Course Code
 *   2  Qualification
 *   3  Source Group
 *   4  RTO Name (as provided)
 *   5  Price (as provided)
 *   6  Currency
 *   7  Status
 *   8  Source Row
 *
 * Rows with missing RTO names or unresolved qualification/RTO references are
 * skipped. Mappings are deduplicated by qualificationId|rtoId.
 */
import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import * as ExcelJS from "exceljs";

const PERMISSION = "qualifications.manage";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const SHEET_NAME = "Mapping Candidates";

const COL = {
  COURSE_CODE: 1,
  QUALIFICATION: 2,
  SOURCE_GROUP: 3,
  RTO_NAME: 4,
  PRICE: 5,
  CURRENCY: 6,
  STATUS: 7,
  SOURCE_ROW: 8,
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
    const rtoColl = await collection("rtos");
    const mappingColl = await collection("qualification-rto-mappings");

    const allQuals = await qualColl.find().toArray();
    const allRtos = await rtoColl.find().toArray();

    const qualByCode = new Map<string, any>();
    for (const q of allQuals) qualByCode.set(String(q.code), q);
    const rtoByName = new Map<string, any>();
    for (const r of allRtos) {
      rtoByName.set(String(r.tradingName).toLowerCase(), r);
      rtoByName.set(String(r.legalName).toLowerCase(), r);
      rtoByName.set(String(r.rtoCode).toLowerCase(), r);
    }

    const allMappings = await mappingColl.find().toArray();
    const existingMappingKeys = new Set<string>();
    for (const m of allMappings) {
      existingMappingKeys.add(`${String(m.qualificationId)}|${String(m.rtoId)}`);
    }

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

          const courseCode = cellStr(row.getCell(COL.COURSE_CODE).value).trim().toUpperCase();
          const qualTitle = cellStr(row.getCell(COL.QUALIFICATION).value).trim();
          const rtoName = cellStr(row.getCell(COL.RTO_NAME).value).trim();
          const status = cellStr(row.getCell(COL.STATUS).value).trim();

          if (!courseCode || !rtoName) {
            skipped++;
            continue;
          }

          // Skip rows where RTO name is missing in source.
          if (rtoName.toLowerCase().includes("rto name missing")) {
            skipped++;
            continue;
          }

          // Resolve qualification by course code.
          let qualDoc = qualByCode.get(courseCode);
          if (!qualDoc && qualTitle) {
            // Try matching by title substring.
            for (const q of allQuals) {
              if (String(q.title).toLowerCase().includes(qualTitle.toLowerCase().slice(0, 30))) {
                qualDoc = q;
                break;
              }
            }
          }

          if (!qualDoc) {
            errors.push({ row: rowNum, message: `Qualification not found: ${courseCode}` });
            skipped++;
            continue;
          }

          // Resolve RTO by name.
          const rtoDoc = rtoByName.get(rtoName.toLowerCase());
          if (!rtoDoc) {
            errors.push({ row: rowNum, message: `RTO not found: ${rtoName}` });
            skipped++;
            continue;
          }

          // Check for duplicate mapping.
          const mapKey = `${String(qualDoc._id)}|${String(rtoDoc._id)}`;
          if (existingMappingKeys.has(mapKey)) {
            skipped++;
            continue;
          }

          const mappingStatus = status.toLowerCase().includes("ready") || status.toLowerCase().includes("active")
            ? "active"
            : "inactive";

          await mappingColl.insertOne({
            qualificationId: qualDoc._id,
            rtoId: rtoDoc._id,
            status: mappingStatus,
            effectiveFrom: now.toISOString(),
            effectiveTo: null,
            createdAt: now,
            updatedAt: now,
          }, { session });
          existingMappingKeys.add(mapKey);
          created++;
        }
      });
    } catch (err: any) {
      await session.endSession().catch(() => {});
      return NextResponse.json(
        { error: { code: "SERVER_ERROR", message: err?.message ?? "Bulk mapping import failed." } },
        { status: 500 },
      );
    } finally {
      await session.endSession().catch(() => {});
    }

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_bulk_mappings",
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
