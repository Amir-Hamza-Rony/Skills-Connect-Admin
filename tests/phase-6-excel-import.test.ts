import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { POST as executeImport } from "@/app/api/excel/import/route";
import { POST as createTemplate } from "@/app/api/excel/templates/route";
import {
  GET as getImport,
} from "@/app/api/excel/imports/route";
import {
  authedRequest,
  clearDb,
  seedClient,
  seedQualification,
  makeSuperAdminToken,
  makeBDCToken,
  makeB2BAgentToken,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

async function getImportRows(importId: string, token = makeSuperAdminToken()) {
  const res = await getImport(
    authedRequest("GET", `/excel/imports/${importId}`, undefined, token),
    { params: { id: importId } },
  );
  const body = await json(res);
  return body.rows;
}

describe("Phase 6 — Excel import execution (real persistence)", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("persists valid client records from import", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
          { sourceColumn: "Email", targetField: "email", required: true, dataType: "email" },
          { sourceColumn: "Phone", targetField: "phone", required: false, dataType: "string" },
          { sourceColumn: "Status", targetField: "status", required: false, dataType: "string" },
        ],
        status: "active",
      }),
    );
    expect(templateRes.status).toBe(201);
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Name: "Alice", Email: "alice@test.com", Phone: "0400 000 001", Status: "active" } },
          { rowNumber: 2, sourceData: { Name: "Bob", Email: "bob@test.com", Phone: "0400 000 002", Status: "active" } },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.status).toBe("completed");
    expect(body.import.rowCounts.total).toBe(2);
    expect(body.import.rowCounts.success).toBe(2);
    expect(body.import.rowCounts.failed).toBe(0);

    // Verify actual DB persistence.
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const clients = await db.collection("clients").find({}).toArray();
    expect(clients.length).toBe(2);
    expect(clients.some((c) => c.legalName === "Alice")).toBe(true);
    expect(clients.some((c) => c.legalName === "Bob")).toBe(true);
  });

  it("rejects rows with missing required fields", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
          { sourceColumn: "Email", targetField: "email", required: true, dataType: "email" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Name: "Alice", Email: "alice@test.com" } },
          { rowNumber: 2, sourceData: { Name: "", Email: "bob@test.com" } },
          { rowNumber: 3, sourceData: { Name: "Carol" } },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.rowCounts.total).toBe(3);
    expect(body.import.rowCounts.success).toBe(1);
    expect(body.import.rowCounts.failed).toBe(2);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const clients = await db.collection("clients").find({}).toArray();
    expect(clients.length).toBe(1);
    expect(clients[0].legalName).toBe("Alice");
  });

  it("rejects invalid email values", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
          { sourceColumn: "Email", targetField: "email", required: true, dataType: "email" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Name: "Alice", Email: "not-an-email" } },
          { rowNumber: 2, sourceData: { Name: "Bob", Email: "bob@test.com" } },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.rowCounts.success).toBe(1);
    expect(body.import.rowCounts.failed).toBe(1);
    const rows = await getImportRows(body.import.id);
    expect(rows[0].status).toBe("failed");
    expect(rows[0].errorMessage).toContain("email");
  });

  it("rejects invalid number values", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
          { sourceColumn: "Score", targetField: "score", required: false, dataType: "number" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Name: "Alice", Score: "not-a-number" } },
          { rowNumber: 2, sourceData: { Name: "Bob", Score: 95 } },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.rowCounts.success).toBe(1);
    expect(body.import.rowCounts.failed).toBe(1);
  });

  it("rejects missing client references for orders", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Order Import",
        scope: "orders",
        columnMappings: [
          { sourceColumn: "ClientId", targetField: "clientId", required: true, dataType: "string" },
          { sourceColumn: "QualificationId", targetField: "qualificationId", required: false, dataType: "string" },
          { sourceColumn: "SellingPrice", targetField: "sellingPrice", required: true, dataType: "number" },
          { sourceColumn: "Currency", targetField: "currency", required: false, dataType: "string" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          {
            rowNumber: 1,
            sourceData: { ClientId: new ObjectId().toString(), QualificationId: new ObjectId().toString(), SellingPrice: 5000 },
          },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.rowCounts.failed).toBe(1);
    const rows = await getImportRows(body.import.id);
    expect(rows[0].errorMessage).toContain("not found");
  });

  it("rejects missing qualification references for orders", async () => {
    const clientId = await seedClient();

    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Order Import",
        scope: "orders",
        columnMappings: [
          { sourceColumn: "ClientId", targetField: "clientId", required: true, dataType: "string" },
          { sourceColumn: "QualificationId", targetField: "qualificationId", required: true, dataType: "string" },
          { sourceColumn: "SellingPrice", targetField: "sellingPrice", required: true, dataType: "number" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          {
            rowNumber: 1,
            sourceData: { ClientId: String(clientId), QualificationId: new ObjectId().toString(), SellingPrice: 5000 },
          },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.rowCounts.failed).toBe(1);
  });

  it("persists valid qualification records", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Qualification Import",
        scope: "qualifications",
        columnMappings: [
          { sourceColumn: "Code", targetField: "code", required: true, dataType: "string" },
          { sourceColumn: "Title", targetField: "title", required: true, dataType: "string" },
          { sourceColumn: "Status", targetField: "status", required: false, dataType: "string" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Code: "AUR32120", Title: "Cert III", Status: "current" } },
          { rowNumber: 2, sourceData: { Code: "CHC30121", Title: "Cert III ECEC", Status: "current" } },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.rowCounts.success).toBe(2);

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const quals = await db.collection("qualifications").find({}).toArray();
    expect(quals.length).toBe(2);
    expect(quals.some((q) => q.code === "AUR32120")).toBe(true);
  });

  it("prevents duplicate qualification codes", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Qualification Import",
        scope: "qualifications",
        columnMappings: [
          { sourceColumn: "Code", targetField: "code", required: true, dataType: "string" },
          { sourceColumn: "Title", targetField: "title", required: true, dataType: "string" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    // Pre-seed a qualification.
    await seedQualification(new ObjectId(), "AUR32120");

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Code: "AUR32120", Title: "Duplicate" } },
          { rowNumber: 2, sourceData: { Code: "NEW001", Title: "New Qual" } },
        ],
      }),
    );
    expect(importRes.status).toBe(201);
    const body = await json(importRes);
    expect(body.import.rowCounts.success).toBe(1);
    expect(body.import.rowCounts.failed).toBe(1);
    const rows = await getImportRows(body.import.id);
    expect(rows[0].errorMessage).toContain("Duplicate qualification code");
  });

  it("records per-row results accurately", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
          { sourceColumn: "Email", targetField: "email", required: true, dataType: "email" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Name: "Alice", Email: "alice@test.com" } },
          { rowNumber: 2, sourceData: { Name: "", Email: "bob@test.com" } },
        ],
      }),
    );
    const body = await json(importRes);
    expect(body.import.rowCounts).toEqual({
      total: 2,
      success: 1,
      failed: 1,
      skipped: 0,
    });
    const rows = await getImportRows(body.import.id);
    expect(rows[0].status).toBe("success");
    expect(rows[0].targetRecordId).toBeDefined();
    expect(rows[1].status).toBe("failed");
    expect(rows[1].targetRecordId).toBeNull();
  });

  it("creates audit entries for import execution", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
          { sourceColumn: "Email", targetField: "email", required: true, dataType: "email" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Name: "Alice", Email: "alice@test.com" } },
        ],
      }),
    );

    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    const audits = await db.collection("audit_logs").find({ entityType: "excel_import" }).toArray();
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.some((a) => a.action === "execute")).toBe(true);
  });

  it("rejects import with invalid template id", async () => {
    const res = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId: "not-an-objectid",
        rows: [{ rowNumber: 1, sourceData: {} }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects import with nonexistent template", async () => {
    const res = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId: new ObjectId().toString(),
        rows: [{ rowNumber: 1, sourceData: {} }],
      }),
    );
    expect(res.status).toBe(404);
  });

  it("rejects inactive templates", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Inactive Template",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    // Deactivate template.
    const { getDb } = await import("@/lib/db");
    const db = await getDb();
    await db.collection("excel_import_templates").updateOne(
      { _id: new ObjectId(templateId) },
      { $set: { status: "inactive" } },
    );

    const res = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [{ rowNumber: 1, sourceData: { Name: "Alice" } }],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unauthorized users (BDC/B2B_AGENT)", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    for (const tokenFn of [makeBDCToken, makeB2BAgentToken]) {
      const res = await executeImport(
        authedRequest("POST", "/excel/import", {
          templateId,
          rows: [{ rowNumber: 1, sourceData: { Name: "Alice" } }],
        }, tokenFn()),
      );
      expect(res.status).toBe(403);
    }
  });

  it("does not report false success when no rows are valid", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const importRes = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [
          { rowNumber: 1, sourceData: { Name: "" } },
          { rowNumber: 2, sourceData: { Name: "" } },
        ],
      }),
    );
    const body = await json(importRes);
    expect(body.import.status).toBe("completed");
    expect(body.import.rowCounts.success).toBe(0);
    expect(body.import.rowCounts.failed).toBe(2);
  });

  it("rejects empty rows array", async () => {
    const templateRes = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Client Import",
        scope: "clients",
        columnMappings: [
          { sourceColumn: "Name", targetField: "legalName", required: true, dataType: "string" },
        ],
        status: "active",
      }),
    );
    const templateId = (await json(templateRes)).template.id;

    const res = await executeImport(
      authedRequest("POST", "/excel/import", {
        templateId,
        rows: [],
      }),
    );
    expect(res.status).toBe(400);
  });
});
