/**
 * M1.7 — Excel export regression tests.
 *
 * Covers the empty-buffer .xlsx defect: exceljs v4 `writeBuffer()` returns a
 * `Promise<Buffer>` and must be awaited. Verifies valid-data and empty-data
 * exports both produce a loadable, non-empty workbook buffer.
 *
 * No network access: tests the exported `buildExcel`/`bufferFromWorkbook`
 * helpers directly.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as ExcelJS from "exceljs";
import { buildExcel, bufferFromWorkbook } from "@/app/api/reports/[type]/export/route";

afterEach(() => {
  vi.restoreAllMocks();
});

function validRows(): any[] {
  return [
    { id: "c-1", name: "Acme Corp", email: "acme@example.com", active: true },
    { id: "c-2", name: "Globex", email: "sales@globex.example", active: false },
  ];
}

async function loadWorkbook(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
}

describe("M1.7 — buildExcel valid export", () => {
  it("produces a loadable workbook with header and data rows", async () => {
    const rows = validRows();
    const buffer = await buildExcel(rows, "Clients Report", "2026-01-01T00:00:00.000Z");

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // .xlsx is a ZIP container; must start with the PK local-file-header signature.
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const workbook = await loadWorkbook(buffer);
    expect(workbook.worksheets.length).toBe(1);
    const sheet = workbook.getWorksheet(1)!;
    expect(sheet.name).toBe("Clients Report");

    const values: any[][] = [];
    sheet.eachRow((row) => values.push(row.values.slice(1)));
    // title + generated + header + 2 data rows (blank row is skipped by eachRow)
    expect(values.length).toBe(5);
    expect(values[0]).toEqual(["Clients Report"]);
    expect(values[1][0]).toMatch(/^Generated:/);
    expect(values[2]).toEqual(["id", "name", "email", "active"]);
    expect(values[3]).toEqual(["c-1", "Acme Corp", "acme@example.com", true]);
    expect(values[4]).toEqual(["c-2", "Globex", "sales@globex.example", false]);
  });

  it("neutralizes formula-injection cell values", async () => {
    const rows = [{ id: "c-1", name: "=1+1", email: "@evil" }];
    const buffer = await buildExcel(rows, "Clients Report", "2026-01-01T00:00:00.000Z");
    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet(1)!;
    // data row is row 5 (title, generated, blank, header, data)
    expect(String(sheet.getRow(5).getCell(2).value)).toBe("\t=1+1");
    expect(String(sheet.getRow(5).getCell(3).value)).toBe("\t@evil");
  });
});

describe("M1.7 — buildExcel empty-data export", () => {
  it("produces a loadable workbook with a 'No data.' row instead of an empty/invalid buffer", async () => {
    const buffer = await buildExcel([], "Clients Report", "2026-01-01T00:00:00.000Z");

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const workbook = await loadWorkbook(buffer);
    const sheet = workbook.getWorksheet(1)!;
    const values: any[][] = [];
    sheet.eachRow((row) => values.push(row.values.slice(1)));
    expect(values.length).toBe(3);
    expect(values[0]).toEqual(["Clients Report"]);
    expect(values[1]).toEqual(["Generated: 2026-01-01T00:00:00.000Z"]);
    expect(values[2]).toEqual(["No data."]);
  });
});

describe("M1.7 — bufferFromWorkbook", () => {
  it("returns a real Buffer (not a coerced Promise/empty string)", async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Sheet").addRow(["a", "b"]);
    const buffer = await bufferFromWorkbook(workbook);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });
});
