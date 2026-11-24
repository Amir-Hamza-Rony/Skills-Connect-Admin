/**
 * POST /api/excel/price-matrix/preview — Upload and parse the Master Hub
 * RTO Price Matrix sheet, resolve RTOs and qualifications, and return a
 * per-row preview for manual sourcing-agent mapping.
 *
 * No data is persisted. Returns unresolved rows flagged as "Pending Review"
 * so an authorised user can select a sourcing agent before import.
 */
import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import * as ExcelJS from "exceljs";

const PERMISSION = "pricing.manage";
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls"]);
const PRICE_MATRIX_SHEET = "RTO Price Matrix";

function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf(".");
  return idx === -1 ? "" : filename.slice(idx).toLowerCase();
}

/** Extract an RTO code from a name like "Christa College Pty Ltd RTO (45458)" or "45679 - AUSTRALIAN SOVEREIGN COLLEGE PTY". */
function extractRtoCode(name: string): string | null {
  const parenMatch = name.match(/\((\d{5,})\)/);
  if (parenMatch) return parenMatch[1];
  const prefixMatch = name.match(/^(\d{5,})\s*-\s*/);
  if (prefixMatch) return prefixMatch[1];
  return null;
}

async function resolveRto(name: string): Promise<{ id: string | null; code: string | null; error: string | null }> {
  if (!name || !String(name).trim()) {
    return { id: null, code: null, error: "RTO name is blank." };
  }
  const trimmed = String(name).trim();
  const extractedCode = extractRtoCode(trimmed);

  const rtoColl = await collection("rtos");

  // 1. Match by extracted RTO code.
  if (extractedCode) {
    const byCode = await rtoColl.findOne({ rtoCode: extractedCode.toUpperCase() });
    if (byCode) {
      return { id: String(byCode._id), code: String(byCode.rtoCode), error: null };
    }
  }

  // 2. Match by exact tradingName or legalName.
  const byName = await rtoColl.findOne({
    $or: [
      { tradingName: trimmed },
      { legalName: trimmed },
    ],
  });
  if (byName) {
    return { id: String(byName._id), code: String(byName.rtoCode), error: null };
  }

  // 3. Case-insensitive fallback on tradingName.
  const byNameCI = await rtoColl.findOne({
    tradingName: { $regex: new RegExp(`^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), $options: "i" },
  });
  if (byNameCI) {
    return { id: String(byNameCI._id), code: String(byNameCI.rtoCode), error: null };
  }

  return { id: null, code: extractedCode ?? null, error: `RTO not found: ${trimmed}` };
}

async function resolveQualification(code: string): Promise<{ id: string | null; title: string | null; error: string | null }> {
  if (!code || !String(code).trim()) {
    return { id: null, title: null, error: "Qualification code is blank." };
  }
  const normalized = String(code).trim().toUpperCase();
  const qualColl = await collection("qualifications");
  const qual = await qualColl.findOne({ code: normalized });
  if (qual) {
    return { id: String(qual._id), title: String(qual.title), error: null };
  }
  return { id: null, title: null, error: `Qualification not found: ${normalized}` };
}

function parsePriceMatrixSheet(ws: ExcelJS.Worksheet): {
  headers: string[];
  rtoPricePairs: Array<{ rtoCol: number; priceCol: number; rtoHeader: string }>;
  dataRows: Array<{ rowNum: number; cells: Record<string, unknown> }>;
} {
  const headers: string[] = [];
  const headerRow = ws.getRow(2);
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? "");
  });

  // Identify RTO/Price column pairs from row 2: A=Course Code, B=Qualifications,
  // then C/D, E/F, G/H, ... = RTO/Price pairs.
  const rtoPricePairs: Array<{ rtoCol: number; priceCol: number; rtoHeader: string }> = [];
  for (let col = 3; col <= headers.length; col += 2) {
    const rtoHeader = String(headers[col - 1] ?? "").trim();
    const priceHeader = String(headers[col] ?? "").trim();
    if (rtoHeader.toLowerCase() === "rto" && priceHeader.toLowerCase() === "price") {
      rtoPricePairs.push({ rtoCol: col, priceCol: col + 1, rtoHeader });
    }
  }

  const dataRows: Array<{ rowNum: number; cells: Record<string, unknown> }> = [];
  for (let rowNum = 3; rowNum <= ws.rowCount; rowNum++) {
    const row = ws.getRow(rowNum);
    let hasAnyValue = false;
    row.eachCell((cell) => {
      if (cell.value !== null && cell.value !== undefined && cell.value !== "") {
        hasAnyValue = true;
      }
    });
    if (!hasAnyValue) continue;

    const cells: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const cell = row.getCell(idx + 1);
      if (h) cells[h] = cell.value;
    });
    dataRows.push({ rowNum, cells });
  }

  return { headers, rtoPricePairs, dataRows };
}

async function requireAuth(req: AuthedRequest) {
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
  return null;
}

export const POST = withAuth(
  async (req: AuthedRequest) => {
    const denied = await requireAuth(req);
    if (denied) return denied;

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

    const ws = workbook.getWorksheet(PRICE_MATRIX_SHEET);
    if (!ws) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: `Sheet "${PRICE_MATRIX_SHEET}" not found in workbook.` } },
        { status: 404 },
      );
    }

    const { headers, rtoPricePairs, dataRows } = parsePriceMatrixSheet(ws);

    if (rtoPricePairs.length === 0) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "No RTO/Price column pairs found in the Price Matrix header row." } },
        { status: 400 },
      );
    }

    // Build preview rows: one per qualification + RTO + price combination.
    const previewRows: Array<{
      rowNum: number;
      qualificationCode: string | null;
      qualificationTitle: string | null;
      qualificationId: string | null;
      rtoName: string | null;
      rtoCode: string | null;
      rtoId: string | null;
      wholesaleCost: number | null;
      currency: string;
      status: "Ready" | "Pending Review" | "Conflict" | "Invalid";
      errors: string[];
    }> = [];

    for (const { rowNum, cells } of dataRows) {
      const qualCode = cells["Course Code"] ?? cells["A"] ?? null;
      const qualTitle = cells["Qualifications"] ?? cells["B"] ?? null;

      const qualResolved = await resolveQualification(qualCode ? String(qualCode) : "");

      for (const { rtoCol, priceCol } of rtoPricePairs) {
        const rtoName = cells[headers[rtoCol - 1]] ?? null;
        const rawPrice = cells[headers[priceCol - 1]];

        // Skip rows with no price (no offer from this RTO).
        if (rawPrice === null || rawPrice === undefined || rawPrice === "") continue;

        const errors: string[] = [];
        let wholesaleCost: number | null = null;

        // Validate price.
        if (typeof rawPrice === "number") {
          wholesaleCost = rawPrice;
        } else {
          const n = Number(rawPrice);
          if (!Number.isFinite(n) || n < 0) {
            errors.push(`Invalid wholesale cost: ${rawPrice}`);
          } else {
            wholesaleCost = n;
          }
        }

        const rtoResolved = await resolveRto(rtoName ? String(rtoName) : "");

        const hasErrors = errors.length > 0 || !qualResolved.id || !rtoResolved.id || wholesaleCost === null;
        const status = hasErrors ? "Pending Review" : "Ready";

        previewRows.push({
          rowNum,
          qualificationCode: qualCode ? String(qualCode) : null,
          qualificationTitle: qualTitle ? String(qualTitle) : null,
          qualificationId: qualResolved.id,
          rtoName: rtoName ? String(rtoName) : null,
          rtoCode: rtoResolved.code,
          rtoId: rtoResolved.id,
          wholesaleCost,
          currency: "AUD",
          status,
          errors: [
            ...(qualResolved.error ? [qualResolved.error] : []),
            ...(rtoResolved.error ? [rtoResolved.error] : []),
            ...errors,
          ],
        });
      }
    }

    // Fetch available sourcing agents for the UI dropdown.
    const agentColl = await collection("agents");
    const agents = await agentColl
      .find({ type: "certificate_source", active: true })
      .sort({ name: 1 })
      .toArray();

    const readyCount = previewRows.filter((r) => r.status === "Ready").length;
    const pendingCount = previewRows.filter((r) => r.status === "Pending Review").length;

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "excel_price_matrix",
      entityId: null,
      action: "preview",
      before: null,
      after: {
        filename: file.name,
        sheet: PRICE_MATRIX_SHEET,
        totalRows: previewRows.length,
        ready: readyCount,
        pending: pendingCount,
      },
    });

    return NextResponse.json({
      preview: {
        filename: file.name,
        sheet: PRICE_MATRIX_SHEET,
        headers,
        rtoPricePairs: rtoPricePairs.map((p) => ({ rtoCol: p.rtoCol, priceCol: p.priceCol, rtoHeader: p.rtoHeader })),
        totalRows: previewRows.length,
        readyCount,
        pendingCount,
        rows: previewRows,
      },
      agents: agents.map((a: any) => ({ id: String(a._id), name: a.name, contact: a.contact })),
    });
  },
);
