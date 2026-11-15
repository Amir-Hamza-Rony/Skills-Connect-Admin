/**
 * POST /api/excel/upload — Upload and parse an Excel file for preview.
 *
 * Accepts multipart/form-data with a file field. Validates file type
 * (.xlsx/.xls) and size (max 10 MB). Parses with exceljs in read-only mode
 * (no formula evaluation, no macro execution). Returns a preview with
 * headers, row count, first N rows, and unmapped columns. Does NOT persist
 * any data — preview only.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { writeAudit } from "@/lib/audit";
import * as ExcelJS from "exceljs";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls"]);
const ALLOWED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const PREVIEW_ROWS = 20;

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

function mimeOf(filename: string): string {
  const ext = extensionOf(filename);
  if (ext === ".xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (ext === ".xls") return "application/vnd.ms-excel";
  return "application/octet-stream";
}

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const actor = (req as AuthedRequest).auth!;
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "No file uploaded." } },
        { status: 400 },
      );
    }

    const ext = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return NextResponse.json(
        {
          error: {
            code: "UNSUPPORTED_TYPE",
            message: "Only .xlsx and .xls files are supported.",
          },
        },
        { status: 422 },
      );
    }

    const actualMime = mimeOf(file.name);
    if (!ALLOWED_MIME_TYPES.has(actualMime)) {
      return NextResponse.json(
        {
          error: {
            code: "UNSUPPORTED_TYPE",
            message: `File type ${file.type || "unknown"} is not an Excel file.`,
          },
        },
        { status: 422 },
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: {
            code: "FILE_TOO_LARGE",
            message: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit.`,
          },
        },
        { status: 422 },
      );
    }

    // Parse with exceljs in read-only mode. No formula evaluation, no macros.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);

    const firstSheet = workbook.worksheets[0];
    if (!firstSheet) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Excel file contains no worksheets." } },
        { status: 400 },
      );
    }

    // Read headers from the first row.
    const headers: string[] = [];
    const headerRow = firstSheet.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      headers.push(String(cell.value ?? `Column${colNumber}`));
    });

    // Read data rows (skip header).
    const dataRows: Record<string, unknown>[] = [];
    let rowCount = 0;
    for (let rowNum = 2; rowNum <= firstSheet.rowCount; rowNum++) {
      const row = firstSheet.getRow(rowNum);
      // Skip completely empty rows.
      let hasAnyValue = false;
      row.eachCell((cell) => {
        if (cell.value !== null && cell.value !== undefined && cell.value !== "") {
          hasAnyValue = true;
        }
      });
      if (!hasAnyValue) continue;

      rowCount++;
      const rowData: Record<string, unknown> = {};
      headers.forEach((header, idx) => {
        const cell = row.getCell(idx + 1);
        rowData[header] = cell.value;
      });
      if (rowCount <= PREVIEW_ROWS) {
        dataRows.push(rowData);
      }
    }

    const hasMore = rowCount > PREVIEW_ROWS;

    // Identify unmapped columns: columns whose header looks like a generic
    // "ColumnN" (i.e., the file had no header row or empty headers).
    const unmappedColumns = headers.filter((h) => /^Column\d+$/.test(h));

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_import",
      entityId: null,
      action: "preview",
      before: null,
      after: {
        filename: file.name,
        sheetName: firstSheet.name,
        rowCount,
        columnCount: headers.length,
      },
    });

    return NextResponse.json({
      preview: {
        filename: file.name,
        sheetName: firstSheet.name,
        headers,
        rowCount,
        previewRowCount: dataRows.length,
        hasMore,
        rows: dataRows,
        unmappedColumns,
      },
    });
  },
);
