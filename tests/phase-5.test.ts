import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";

import {
  POST as createTemplate,
  GET as listTemplates,
  DELETE as deleteTemplate,
} from "@/app/api/excel/templates/route";
import {
  POST as createTemplateItem,
  GET as getTemplateItem,
  PATCH as updateTemplate,
  DELETE as deleteTemplateItem,
} from "@/app/api/excel/templates/[id]/route";
import { POST as uploadExcel } from "@/app/api/excel/upload/route";
import { POST as executeImport } from "@/app/api/excel/import/route";
import {
  GET as listImports,
  GET as getImport,
} from "@/app/api/excel/imports/route";
import { POST as createOrder } from "@/app/api/orders/route";
import { POST as createInvoice } from "@/app/api/invoices/route";
import {
  POST as createClientReport,
  GET as listClientReport,
} from "@/app/api/reports/clients/route";
import {
  POST as createOrderReport,
  GET as listOrderReport,
} from "@/app/api/reports/orders/route";
import {
  POST as createOutstandingReport,
  GET as listOutstandingReport,
} from "@/app/api/reports/outstanding/route";
import {
  POST as createSupplierCostReport,
  GET as listSupplierCostReport,
} from "@/app/api/reports/supplier-costs/route";
import {
  POST as createAgentCommissionReport,
  GET as listAgentCommissionReport,
} from "@/app/api/reports/agent-commission/route";
import {
  POST as createMonthlySummaryReport,
  GET as listMonthlySummaryReport,
} from "@/app/api/reports/monthly-summary/route";

import {
  authedRequest,
  clearDb,
  seedClient,
  seedQualification,
  seedRto,
  seedAgent,
  seedPriceCategory,
  seedPriceList,
  seedSupplierRoute,
  seedMapping,
  seedOrder,
  seedInvoice,
  makeToken,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

describe("Phase 5 — Excel import templates", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates and lists import templates", async () => {
    const res = await createTemplate(
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
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.template.name).toBe("Client Import");
    expect(body.template.scope).toBe("clients");
    expect(body.template.columnMappings.length).toBe(2);

    const list = await listTemplates(
      authedRequest("GET", "/excel/templates"),
    );
    expect((await json(list)).items.length).toBe(1);
  });

  it("prevents duplicate template names", async () => {
    await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Template A",
        scope: "clients",
        columnMappings: [],
        status: "active",
      }),
    );
    const dup = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Template A",
        scope: "orders",
        columnMappings: [],
        status: "active",
      }),
    );
    expect(dup.status).toBe(409);
  });

  it("updates and deletes templates", async () => {
    const res = await createTemplate(
      authedRequest("POST", "/excel/templates", {
        name: "Template A",
        scope: "clients",
        columnMappings: [],
        status: "active",
      }),
    );
    const id = (await json(res)).template.id;

    const updated = await updateTemplate(
      authedRequest("PATCH", `/excel/templates/${id}`, {
        name: "Template B",
        status: "inactive",
      }),
      { params: { id } },
    );
    expect(updated.status).toBe(200);
    expect((await json(updated)).template.name).toBe("Template B");

    const removed = await deleteTemplateItem(
      authedRequest("DELETE", `/excel/templates/${id}`),
      { params: { id } },
    );
    expect(removed.status).toBe(200);

    const list = await listTemplates(
      authedRequest("GET", "/excel/templates"),
    );
    expect((await json(list)).items.length).toBe(0);
  });
});

describe("Phase 5 — Excel upload preview", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("rejects non-Excel files", async () => {
    const formData = new FormData();
    formData.append("file", new File(["hello"], "test.txt"));
    const req = new NextRequest("http://localhost/excel/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeToken()}`,
      },
      body: formData,
    });
    const res = await uploadExcel(req);
    expect(res.status).toBe(422);
  });

  it("parses an Excel file and returns headers", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["Name", "Email", "Status"]);
    sheet.addRow(["Alice", "alice@test.com", "active"]);
    sheet.addRow(["Bob", "bob@test.com", "inactive"]);
    const buffer = await workbook.xlsx.writeBuffer();

    const formData = new FormData();
    formData.append("file", new File([buffer], "test.xlsx"));

    const req = new NextRequest("http://localhost/excel/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${makeToken()}`,
      },
      body: formData,
    });
    const res = await uploadExcel(req);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.preview.headers).toEqual(["Name", "Email", "Status"]);
    expect(body.preview.rowCount).toBe(2);
    expect(body.preview.rows.length).toBe(2);
  });
});

describe("Phase 5 — Reports", () => {
  beforeEach(async () => {
    await clearDb();
  });

  async function seedFullScenario() {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rId, 1500);
    await seedMapping(qId, rId);

    const orderRes = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 5000,
      }),
    );
    const { order } = await json(orderRes);

    await createInvoice(
      authedRequest("POST", "/api/invoices", {
        orderId: order.id,
        currency: "AUD",
        issueDate: "2027-02-01",
        dueDate: "2027-03-01",
        total: 5000,
      }),
    );

    return { clientId, orderId: order.id, qId, aId, rId };
  }

  it("client report returns per-client aggregation", async () => {
    const { clientId } = await seedFullScenario();

    const res = await listClientReport(
      authedRequest("GET", "/api/reports/clients"),
    );
    const body = await json(res);
    expect(body.clients.length).toBeGreaterThan(0);
    expect(body.clients[0].legalName).toBeDefined();
  });

  it("order report returns per-order details", async () => {
    const { orderId } = await seedFullScenario();

    const res = await listOrderReport(
      authedRequest("GET", "/api/reports/orders"),
    );
    const body = await json(res);
    expect(body.orders.length).toBeGreaterThan(0);
    const order = body.orders.find((o: any) => o.id === orderId);
    expect(order).toBeDefined();
    expect(order.sellingPrice).toBe(5000);
  });

  it("outstanding report returns per-customer balances", async () => {
    const { clientId } = await seedFullScenario();

    const res = await listOutstandingReport(
      authedRequest("GET", "/api/reports/outstanding"),
    );
    const body = await json(res);
    expect(body.customers.length).toBeGreaterThan(0);
  });

  it("supplier costs report returns margin data", async () => {
    const { qId, rId } = await seedFullScenario();

    const res = await listSupplierCostReport(
      authedRequest("GET", "/api/reports/supplier-costs"),
    );
    const body = await json(res);
    expect(body.supplierCosts.length).toBeGreaterThan(0);
  });

  it("agent commission report returns per-agent data", async () => {
    const res = await listAgentCommissionReport(
      authedRequest("GET", "/api/reports/agent-commission"),
    );
    const body = await json(res);
    expect(Array.isArray(body.agentCommission)).toBe(true);
  });

  it("monthly summary report returns monthly data", async () => {
    const res = await listMonthlySummaryReport(
      authedRequest("GET", "/api/reports/monthly-summary"),
    );
    const body = await json(res);
    expect(Array.isArray(body.monthlySummary)).toBe(true);
  });
});
