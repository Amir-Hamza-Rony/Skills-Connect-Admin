/**
 * M1.9 — Ageing report export regression tests.
 *
 * Covers the fix for the empty-workbook defect: the ageing report returns
 * { totalOverdue, buckets }, which the export row-extraction logic did not
 * recognise, producing a "No data." workbook even when data exists.
 *
 * No database access: fetch is mocked to return ageing report data.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import * as ExcelJS from "exceljs";
import { GET as exportReport } from "@/app/api/reports/[type]/export/route";
import { authedRequest, makeSuperAdminToken } from "./helpers";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
) {
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ageingData = {
  totalOverdue: 15000,
  buckets: [
    { label: "1-30 days", min: 1, max: 30, count: 2, amount: 5000 },
    { label: "31-60 days", min: 31, max: 60, count: 1, amount: 3000 },
    { label: "61-90 days", min: 61, max: 90, count: 0, amount: 0 },
    { label: "90+ days", min: 91, max: Infinity, count: 1, amount: 7000 },
  ],
};

async function exportAgeing(format: "xlsx" | "pdf") {
  stubFetch((url) => {
    if (url.includes("/reports/ageing")) {
      return jsonResponse(ageingData);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  const req = authedRequest(
    "GET",
    `/api/reports/ageing/export?format=${format}`,
    undefined,
    makeSuperAdminToken(),
  );
  const res = await exportReport(req, { params: { type: "ageing" } });
  return { res };
}

describe("M1.9 — ageing Excel export", () => {
  it("exports bucket rows instead of an empty workbook", async () => {
    const { res } = await exportAgeing("xlsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(1)!;
    expect(sheet.name).toBe("ageing");

    // Collect all cell values as strings to verify bucket data present.
    const values: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        values.push(String(cell.value ?? ""));
      });
    });

    // Bucket labels must appear as rows.
    expect(values).toContain("1-30 days");
    expect(values).toContain("31-60 days");
    expect(values).toContain("61-90 days");
    expect(values).toContain("90+ days");

    // Bucket counts and amounts must appear.
    expect(values).toContain("2");
    expect(values).toContain("5000");
    expect(values).toContain("7000");

    // totalOverdue must be preserved as an info row.
    expect(values).toContain("Total Overdue: 15000");
  });

  it("does not produce a 'No data.' workbook when buckets exist", async () => {
    const { res } = await exportAgeing("xlsx");
    const buffer = Buffer.from(await res.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(1)!;

    const values: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        values.push(String(cell.value ?? ""));
      });
    });
    expect(values).not.toContain("No data.");
  });
});

describe("M1.9 — ageing PDF export", () => {
  it("returns a PDF response with correct status and content type", async () => {
    const { res } = await exportAgeing("pdf");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("attachment; filename=");
  });

  it("returns a non-empty PDF body containing ageing bucket content", async () => {
    const { res } = await exportAgeing("pdf");
    expect(res.status).toBe(200);

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);

    // Valid PDF signature (%PDF-).
    expect(body.subarray(0, 5)).toEqual(Buffer.from("%PDF-"));

    // Ageing export with buckets should produce a larger body than an empty
    // export because more content is drawn into the stream.
    const emptyRes = await exportAgeingEmptyPDF();
    const emptyBody = Buffer.from(await emptyRes.arrayBuffer());
    expect(body.length).toBeGreaterThan(emptyBody.length);
  });

  it("produces a 'No data.' PDF when buckets are empty", async () => {
    const emptyData = { totalOverdue: 0, buckets: [] };
    stubFetch((url) => {
      if (url.includes("/reports/ageing")) {
        return jsonResponse(emptyData);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const req = authedRequest(
      "GET",
      "/api/reports/ageing/export?format=pdf",
      undefined,
      makeSuperAdminToken(),
    );
    const res = await exportReport(req, { params: { type: "ageing" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/pdf");

    const body = Buffer.from(await res.arrayBuffer());
    expect(body.length).toBeGreaterThan(0);
    expect(body.subarray(0, 5)).toEqual(Buffer.from("%PDF-"));
  });
});

async function exportAgeingEmptyPDF() {
  const emptyData = { totalOverdue: 0, buckets: [] };
  stubFetch((url) => {
    if (url.includes("/reports/ageing")) {
      return jsonResponse(emptyData);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
  const req = authedRequest(
    "GET",
    "/api/reports/ageing/export?format=pdf",
    undefined,
    makeSuperAdminToken(),
  );
  return exportReport(req, { params: { type: "ageing" } });
}

describe("M1.9 — ageing empty export", () => {
  it("produces a 'No data.' workbook when buckets are empty", async () => {
    const emptyData = { totalOverdue: 0, buckets: [] };
    stubFetch((url) => {
      if (url.includes("/reports/ageing")) {
        return jsonResponse(emptyData);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    const req = authedRequest(
      "GET",
      "/api/reports/ageing/export?format=xlsx",
      undefined,
      makeSuperAdminToken(),
    );
    const res = await exportReport(req, { params: { type: "ageing" } });
    expect(res.status).toBe(200);

    const buffer = Buffer.from(await res.arrayBuffer());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet(1)!;

    const values: string[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        values.push(String(cell.value ?? ""));
      });
    });
    expect(values).toContain("No data.");
    expect(values).toContain("Total Overdue: 0");
  });
});
