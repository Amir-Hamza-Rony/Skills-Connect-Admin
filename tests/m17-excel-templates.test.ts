/**
 * M1.7 — Excel template request-handling regression tests.
 *
 * Confirms `createExcelTemplate` and `updateExcelTemplate` pass the template
 * payload directly as the request body (not `{ method, body }`), matching the
 * `api.post(path, body, options)` / `api.patch(path, body)` helper signatures.
 *
 * No network access: fetch is mocked locally.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExcelTemplateItem } from "@/lib/ops-store";
import { createExcelTemplate, updateExcelTemplate } from "@/lib/ops-store";

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

const templateFixture: Omit<ExcelTemplateItem, "id" | "createdBy" | "createdAt" | "updatedAt"> = {
  name: "Clients import",
  scope: "clients",
  columnMappings: [
    {
      sourceColumn: "Client Name",
      targetField: "name",
      required: true,
      dataType: "string",
    },
  ],
  status: "active",
};

const createdTemplate: ExcelTemplateItem = {
  id: "tpl-1",
  ...templateFixture,
  createdBy: "user-1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("M1.7 — createExcelTemplate request body", () => {
  it("posts the template payload directly and returns the created template", async () => {
    let postBody: unknown;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/excel/templates" && init?.method === "POST") {
        postBody = JSON.parse(String(init.body));
        return jsonResponse({ template: createdTemplate }, 201);
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    const result = await createExcelTemplate(templateFixture);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/excel/templates", expect.any(Object));
    // The body must be the template payload itself, NOT { method, body }.
    expect(postBody).toEqual(templateFixture);
    expect(postBody).not.toHaveProperty("method");
    expect(result).toEqual(createdTemplate);
  });
});

describe("M1.7 — updateExcelTemplate request body", () => {
  it("patches the payload directly and returns the updated template", async () => {
    const patch = { name: "Renamed import", status: "inactive" as const };
    let patchBody: unknown;
    const fetchMock = stubFetch((url, init) => {
      if (url === "/api/excel/templates/tpl-1" && init?.method === "PATCH") {
        patchBody = JSON.parse(String(init.body));
        return jsonResponse({ template: { ...createdTemplate, ...patch } });
      }
      throw new Error(`Unexpected fetch: ${init?.method ?? "GET"} ${url}`);
    });

    const result = await updateExcelTemplate("tpl-1", patch);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/excel/templates/tpl-1", expect.any(Object));
    expect(patchBody).toEqual(patch);
    expect(patchBody).not.toHaveProperty("method");
    expect(result.name).toBe("Renamed import");
    expect(result.status).toBe("inactive");
  });
});
