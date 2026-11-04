/**
 * GET /api/reports/[type]/export — Export a report as Excel (.xlsx) or PDF.
 *
 * Fetch the report data from the corresponding report route, then generate
 * the requested format. Protects against spreadsheet formula injection by
 * prefixing any cell value starting with =, +, -, @ with a tab character.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import * as ExcelJS from "exceljs";

const REPORT_ROUTES: Record<string, string> = {
  clients: "/reports/clients",
  orders: "/reports/orders",
  outstanding: "/reports/outstanding",
  "supplier-costs": "/reports/supplier-costs",
  "agent-commission": "/reports/agent-commission",
  "monthly-summary": "/reports/monthly-summary",
  finance: "/reports/finance",
  revenue: "/reports/revenue",
  margin: "/reports/margin",
  ageing: "/reports/ageing",
};

function sanitizeCell(value: unknown): unknown {
  if (typeof value === "string") {
    const s = value.trim();
    if (s.startsWith("=") || s.startsWith("+") || s.startsWith("-") || s.startsWith("@")) {
      return "\t" + s; // Neutralize formula injection.
    }
  }
  return value;
}

function buildExcel(rows: any[], title: string, generatedAt: string): Buffer {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title.slice(0, 31));

  if (rows.length === 0) {
    sheet.addRow([title]);
    sheet.addRow([`Generated: ${generatedAt}`]);
    sheet.addRow(["No data."]);
    return bufferFromWorkbook(workbook);
  }

  // Determine columns from the first row (flatten nested objects/arrays).
  const first = rows[0];
  const headerRow: string[] = [];
  const rowValues: any[][] = [];

  function flatten(obj: any, prefix = ""): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(out, flatten(v, key));
      } else {
        out[key] = v;
      }
    }
    return out;
  }

  const flatRows = rows.map((r) => flatten(r));
  for (const key of Object.keys(flatRows[0] || {})) {
    headerRow.push(key);
  }
  for (const fr of flatRows) {
    rowValues.push(headerRow.map((h) => sanitizeCell(fr[h])));
  }

  sheet.addRow([title]);
  sheet.addRow([`Generated: ${generatedAt}`]);
  sheet.addRow([]);
  sheet.addRow(headerRow);
  for (const rv of rowValues) {
    sheet.addRow(rv);
  }

  return bufferFromWorkbook(workbook);
}

function bufferFromWorkbook(workbook: ExcelJS.Workbook): Buffer {
  // exceljs v4 supports buffer output via writeBuffer.
  return (workbook as any).writeBuffer ? Buffer.from((workbook as any).writeBuffer() as any) : Buffer.from("");
}

export const GET = withAuth(
  async (req: AuthedRequest, { params }: { params?: Promise<{ type?: string }> | { type?: string } | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { type } = resolvedParams || {};
    const format = (req.nextUrl.searchParams.get("format") || "xlsx").toLowerCase();

    if (!type || !REPORT_ROUTES[type]) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: `Invalid or missing report type. Valid: ${Object.keys(REPORT_ROUTES).join(", ")}` } },
        { status: 400 },
      );
    }

    if (format !== "xlsx" && format !== "pdf") {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "format must be 'xlsx' or 'pdf'." } },
        { status: 400 },
      );
    }

    // Build the report URL with all query params except format.
    const searchParams = new URL(req.nextUrl).searchParams;
    searchParams.delete("format");
    const reportUrl = `${REPORT_ROUTES[type]}?${searchParams.toString()}`;

    // Fetch report data from the internal report route.
    const reportRes = await fetch(new URL(reportUrl, req.nextUrl.origin).toString(), {
      headers: {
        Authorization: req.headers.get("authorization") ?? "",
      },
    });

    if (!reportRes.ok) {
      return NextResponse.json(
        { error: { code: "REPORT_FETCH_FAILED", message: "Failed to fetch report data." } },
        { status: 502 },
      );
    }

    const reportData = await reportRes.json();

    // Determine the rows array from the response.
    let rows: any[] = [];
    let title = type;
    if (reportData.clients) rows = reportData.clients;
    else if (reportData.orders) rows = reportData.orders;
    else if (reportData.supplierCosts) rows = reportData.supplierCosts;
    else if (reportData.agentCommission) rows = reportData.agentCommission;
    else if (reportData.monthlySummary) rows = reportData.monthlySummary;
    else if (reportData.customers) rows = reportData.customers;
    else rows = reportData.rows || reportData.items || [];

    const generatedAt = new Date().toISOString();

    if (format === "xlsx") {
      const buffer = buildExcel(rows, title, generatedAt);
      const buf = Buffer.from(buffer as unknown as Uint8Array);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${title}-${generatedAt.slice(0, 10)}.xlsx"`,
          "Content-Length": String(buf.length),
        },
      });
    }

    // PDF export — minimal table via pdfkit if available; otherwise fallback
    // to a simple text-based PDF.
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const PDFDocument = require("pdfkit");
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));

      doc.fontSize(16).text(title, { align: "center" });
      doc.fontSize(10).text(`Generated: ${generatedAt}`, { align: "center" });
      doc.moveDown();

      if (rows.length === 0) {
        doc.text("No data.");
      } else {
        const first = rows[0];
        const flattenLocal = (obj: any, prefix = ""): Record<string, unknown> => {
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === "object" && !Array.isArray(v)) {
              Object.assign(out, flattenLocal(v, key));
            } else {
              out[key] = v;
            }
          }
          return out;
        };
        const flatRows = rows.map((r) => flattenLocal(r));
        const headers = Object.keys(flatRows[0] || {});

        const startX = 50;
        let y = doc.y;
        doc.fontSize(8);
        for (const h of headers) {
          doc.text(String(h), startX, y, { width: 80 });
        }
        y += 15;
        doc.moveDown();
        for (const fr of flatRows) {
          let x = startX;
          for (const h of headers) {
            doc.text(String(sanitizeCell(fr[h]) ?? ""), x, y, { width: 80 });
            x += 85;
          }
          y += 12;
          if (y > 700) {
            doc.addPage();
            y = 50;
          }
        }
      }

      doc.end();
      return new NextResponse(Buffer.concat(chunks), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${title}-${generatedAt.slice(0, 10)}.pdf"`,
        },
      });
    } catch {
      // pdfkit not available — return a minimal text PDF fallback.
      const pdfContent = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>\nendobj\n4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n5 0 obj\n<< /Length ${Buffer.byteLength(title + "\\nGenerated: " + generatedAt + "\\nNo PDF library available.")} >>\nstream\n${title}\nGenerated: ${generatedAt}\nNo PDF library available.\nendstream\nendobj\nxref\n0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000207 00000 n \n0000000275 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(`0 6\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000207 00000 n \n0000000275 00000 n \ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n`)}%\n%%EOF`;
      return new NextResponse(Buffer.from(pdfContent), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${title}-${generatedAt.slice(0, 10)}.pdf"`,
        },
      });
    }
  },
);
