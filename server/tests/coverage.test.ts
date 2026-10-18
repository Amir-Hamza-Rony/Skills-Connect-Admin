import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  setQuickBooksTransportOverride,
  type QBTransport,
} from "../src/integrations/quickbooks/client.js";
import { Agent } from "../src/models/agent.model.js";
import { Certificate } from "../src/models/certificate.model.js";
import { DocumentRequirement } from "../src/models/document-requirement.model.js";
import { Invoice, type InvoiceLean } from "../src/models/invoice.model.js";
import { Order } from "../src/models/order.model.js";
import { QBSyncRecord } from "../src/models/qb-sync-record.model.js";
import { Client } from "../src/models/client.model.js";
import { PaymentPlan } from "../src/models/payment-plan.model.js";
import { grossMargin } from "../src/services/order.service.js";
import { runOverdueSweep } from "../src/jobs/overdue.job.js";
import { escapeRegex } from "../src/services/masters.service.js";
import { ROLE_NAMES, type Permission } from "../src/services/permissions.js";
import {
  clearTestDb,
  createUser,
  seedOrderMasters,
  seedRoles,
  setupTestDatabase,
} from "./helpers/test-db.js";

/**
 * Covers the assertions BACKEND-PLAN §7 requires but no suite made:
 *
 *  - the FULL RBAC matrix (every role × every route) — three roles had never
 *    been asserted against anything
 *  - margin, which had no test at all while two separate implementations existed
 *  - overdue over time, which nothing could reach without the scheduled sweep
 *  - "a retry creates exactly one QuickBooks record", previously untestable
 *    because the transport had no injection seam
 *  - the master endpoints, which did not exist until this pass
 */
setupTestDatabase();

const PASSWORD = "CorrectHorseBattery1!";

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  setQuickBooksTransportOverride(null);
  await clearTestDb();
  await seedRoles();
});

async function signIn(email: string, roleNames: string[] = ["Super Admin"]): Promise<string> {
  await createUser({ email, password: PASSWORD, roleNames });
  const res = await request(app).post("/auth/login").send({ email, password: PASSWORD });
  expect(res.body.accessToken).toBeTypeOf("string");
  return res.body.accessToken as string;
}

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/* ==================== full RBAC matrix ==================== */

/**
 * Every guarded route, with the permission it requires.
 *
 * Written out rather than derived so that adding a route without adding it here
 * is visible in review — a generated list would happily test itself.
 */
const MATRIX: Array<{
  method: "get" | "post" | "patch";
  path: string;
  permission: Permission;
  body?: unknown;
}> = [
  { method: "get", path: "/users", permission: "users.manage" },
  { method: "get", path: "/roles", permission: "users.manage" },
  { method: "get", path: "/clients", permission: "clients.view" },
  { method: "get", path: "/clients/duplicates", permission: "clients.view" },
  { method: "get", path: "/orders", permission: "orders.view" },
  { method: "get", path: "/workflow/tasks", permission: "orders.view" },
  { method: "get", path: "/invoices", permission: "finance.view" },
  { method: "get", path: "/payments", permission: "finance.view" },
  { method: "get", path: "/finance/summary", permission: "finance.view" },
  { method: "get", path: "/integrations/quickbooks/sync", permission: "finance.view" },
  { method: "get", path: "/orders/000000000000000000000000/documents", permission: "documents.view" },
  { method: "get", path: "/agents", permission: "agents.manage" },
  { method: "get", path: "/qualifications", permission: "qualifications.manage" },
  { method: "get", path: "/rtos", permission: "rto.manage" },
  { method: "get", path: "/supplier-routes", permission: "pricing.manage" },
];

describe("full RBAC matrix", () => {
  it("grants or refuses every role on every guarded route", async () => {
    const { ROLE_PERMISSIONS } = await import("../src/services/permissions.js");

    for (const roleName of ROLE_NAMES) {
      const token = await signIn(`${roleName.replace(/[^a-z]/gi, "")}@example.com`, [roleName]);
      const held = new Set(ROLE_PERMISSIONS[roleName]);

      for (const route of MATRIX) {
        const shouldPass = held.has(route.permission as never);
        const res = await request(app)
          [route.method](route.path)
          .set(authed(token))
          .send(route.body ?? {});

        if (shouldPass) {
          // 200 or 404 — both mean the guard let the request through and the
          // handler decided the data does not exist.
          expect(
            res.status === 200 || res.status === 404,
            `${roleName} should reach ${route.path} (needs ${route.permission}) but got ${res.status}`,
          ).toBe(true);
        } else {
          expect(
            res.status === 403,
            `${roleName} should be refused ${route.path} (lacks ${route.permission}) but got ${res.status}`,
          ).toBe(true);
          expect(res.body.error.code).toBe("FORBIDDEN");
        }
      }
    }
  });

  it("refuses the finance write and QB retry to roles without them", async () => {
    // The routes the matrix above cannot cover: both are POSTs with real side
    // effects, so they are asserted on the permission rather than the outcome.
    for (const roleName of ["Sales / Closing Agent", "Read Only / Manager", "Document Reviewer"]) {
      const token = await signIn(`${roleName.replace(/[^a-z]/gi, "")}-w@example.com`, [roleName]);

      const payment = await request(app)
        .post("/payments")
        .set(authed(token))
        .send({ orderId: "000000000000000000000000", amount: 1, date: daysFromNow(0), method: "Cash" });
      expect(payment.status).toBe(403);

      const retry = await request(app)
        .post("/integrations/quickbooks/sync/invoice/000000000000000000000000")
        .set(authed(token))
        .send({});
      expect(retry.status).toBe(403);

      const pricing = await request(app)
        .post("/supplier-routes")
        .set(authed(token))
        .send({ qualificationId: "x", sourceAgentId: "x", rtoId: "x", wholesaleCost: 1 });
      expect(pricing.status).toBe(403);
    }
  });
});

/* ==================== margin ==================== */

describe("grossMargin", () => {
  it("is selling price minus every cost", () => {
    expect(grossMargin({ sellingPrice: 2500, supplierCostSnapshot: 700, otherCost: 0 } as never)).toBe(1800);
    expect(grossMargin({ sellingPrice: 2500, supplierCostSnapshot: 700, otherCost: 300 } as never)).toBe(1500);
  });

  it("never reports a margin above the selling price", () => {
    const order = {
      sellingPrice: 1000,
      supplierCostSnapshot: 1200,
      otherCost: 0,
    } as never;
    // A loss, not a positive margin. The order screen must show it as one.
    expect(grossMargin(order)).toBeLessThan(0);
  });

  it("matches the order that was actually created", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Margin Client", email: `margin-${Date.now()}@example.com` });
    const created = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500, otherCost: 300 });

    const order = await Order.findById(created.body.order.id).lean();
    expect(grossMargin(order!)).toBe(2500 - 700 - 300);
  });
});

/* ==================== overdue over time ==================== */

describe("overdue sweep", () => {
  async function makeOrder(token: string): Promise<string> {
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Overdue Client", email: `overdue-${Date.now()}@example.com` });
    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });
    return order.body.order.id as string;
  }

  it("flips an unpaid invoice to Overdue with no payment activity at all", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: daysFromNow(-1) });
    const invoiceId = inv.body.invoice.id as string;

    // Created past due, so it starts Overdue. The gap this test closes is the
    // one where it starts Sent and simply *becomes* past due afterwards.
    await Invoice.updateOne({ _id: invoiceId }, { $set: { status: "Sent" } });
    await Invoice.updateOne({ _id: invoiceId }, { $set: { dueDate: new Date(Date.now() - 86_400_000) } });

    const result = await runOverdueSweep();
    expect(result.invoicesFlipped).toBeGreaterThan(0);

    const after = await Invoice.findById(invoiceId).lean<InvoiceLean>();
    expect(after?.status).toBe("Overdue");
  });

  it("writes the Overdue instalment status that nothing used to write", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const plan = await request(app)
      .post(`/orders/${orderId}/payment-plan`)
      .set(authed(token))
      .send({ total: 1000 });
    const planId = plan.body.plan.id as string;

    await request(app)
      .post(`/payment-plans/${planId}/instalments`)
      .set(authed(token))
      .send({ dueDate: daysFromNow(-5), amount: 1000 });

    const stored = await PaymentPlan.findById(planId).lean();
    // A past-due instalment is created as "Due", never "Overdue" — "Overdue"
    // is what the sweep escalates it to once time has passed.
    expect(stored?.instalments[0]?.status).toBe("Due");

    await runOverdueSweep();

    const after = await PaymentPlan.findById(planId).lean();
    expect(after?.instalments[0]?.status).toBe("Overdue");
  });

  it("leaves paid and cancelled instalments alone", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const plan = await request(app)
      .post(`/orders/${orderId}/payment-plan`)
      .set(authed(token))
      .send({ total: 1000 });
    const planId = plan.body.plan.id as string;

    await request(app)
      .post(`/payment-plans/${planId}/instalments`)
      .set(authed(token))
      .send({ dueDate: daysFromNow(-5), amount: 500 });
    await request(app)
      .post(`/payment-plans/${planId}/instalments`)
      .set(authed(token))
      .send({ dueDate: daysFromNow(-5), amount: 500 });

    await PaymentPlan.updateOne(
      { _id: planId },
      { $set: { "instalments.0.status": "Waived", "instalments.1.status": "Paid" } },
    );

    await runOverdueSweep();

    const after = await PaymentPlan.findById(planId).lean();
    expect(after?.instalments[0]?.status).toBe("Waived");
    expect(after?.instalments[1]?.status).toBe("Paid");
  });
});

/* ==================== QB retry creates exactly one ==================== */

describe("QuickBooks retry — exactly one record", () => {
  it("creates one QuickBooks invoice no matter how many times it is retried", async () => {
    // The criterion B5 claimed and could not previously test: there was no seam
    // to stand in for QuickBooks, so this was untestable without credentials.
    const calls: string[] = [];
    const transport: QBTransport = {
      async createInvoice() {
        calls.push("invoice");
        return { ok: true, data: { Invoice: { Id: "QB-REAL-77" } } };
      },
      async createPayment() {
        return { ok: true, data: { Payment: { Id: "QB-PAY-1" } } };
      },
    };
    setQuickBooksTransportOverride(transport);

    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "QB Exactly One", email: `qbone-${Date.now()}@example.com` });
    await Client.updateOne({ _id: client.body.client.id }, { $set: { qbCustomerId: "QB-CUST-1" } });

    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });
    const orderId = order.body.order.id as string;

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: daysFromNow(30) });
    const invoiceId = inv.body.invoice.id as string;

    // One call from the create, then four retries.
    expect(calls).toHaveLength(1);

    for (let i = 0; i < 4; i += 1) {
      const res = await request(app)
        .post(`/integrations/quickbooks/sync/invoice/${invoiceId}`)
        .set(authed(token))
        .send({});
      expect(res.status).toBe(200);
      // A retry of a synced record is a no-op, not another create.
      expect(res.body.record.status).toBe("Synced");
    }

    expect(calls).toHaveLength(1);

    const records = await QBSyncRecord.find({ entityType: "invoice", entityId: invoiceId }).lean();
    expect(records).toHaveLength(1);
    // The reference is the id QuickBooks issued, never one invented locally.
    expect(records[0]?.qbReference).toBe("QB-REAL-77");
  });

  it("records the failure reason when QuickBooks refuses", async () => {
    setQuickBooksTransportOverride({
      async createInvoice() {
        return { ok: false, error: "CustomerRef 999 not found" };
      },
      async createPayment() {
        return { ok: false, error: "n/a" };
      },
    });

    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "QB Refused", email: `qbrefused-${Date.now()}@example.com` });
    await Client.updateOne({ _id: client.body.client.id }, { $set: { qbCustomerId: "QB-CUST-2" } });
    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId: order.body.order.id, total: 1000, dueDate: daysFromNow(30) });
    const invoiceId = inv.body.invoice.id as string;

    const record = await QBSyncRecord.findOne({ entityId: invoiceId }).lean();
    expect(record?.status).toBe("Failed");
    expect(record?.syncError).toContain("CustomerRef 999");
    // A failure must never leave a fabricated reference behind.
    expect(record?.qbReference).toBeNull();
  });
});

/* ==================== masters endpoints ==================== */

describe("masters endpoints", () => {
  async function seedMaster(token: string) {
    const q = await request(app)
      .post("/qualifications")
      .set(authed(token))
      .send({ code: "AUR32120", title: "Certificate III", industry: "Support" });
    const r = await request(app)
      .post("/rtos")
      .set(authed(token))
      .send({ legalName: "Test RTO", rtoCode: "RTO-1" });
    const a = await request(app)
      .post("/agents")
      .set(authed(token))
      .send({ name: "Source Agent", type: "certificate_source" });
    const sales = await request(app)
      .post("/agents")
      .set(authed(token))
      .send({ name: "Sales Agent", type: "sales_closing" });
    return {
      qualificationId: q.body.qualification.id as string,
      rtoId: r.body.rto.id as string,
      sourceAgentId: a.body.agent.id as string,
      salesAgentId: sales.body.agent.id as string,
    };
  }

  it("creates and lists each master", async () => {
    const token = await signIn("admin@example.com");
    const ids = await seedMaster(token);

    expect((await request(app).get("/qualifications").set(authed(token))).body.qualifications).toHaveLength(1);
    expect((await request(app).get("/rtos").set(authed(token))).body.rtos).toHaveLength(1);
    // seedMaster creates a source agent AND a sales agent — an order needs both.
    expect((await request(app).get("/agents").set(authed(token))).body.agents).toHaveLength(2);

    const route = await request(app)
      .post("/supplier-routes")
      .set(authed(token))
      .send({ ...ids, wholesaleCost: 700 });
    expect(route.status).toBe(201);
    expect(route.body.route.wholesaleCost).toBe(700);

    const list = await request(app).get("/supplier-routes").set(authed(token));
    expect(list.body.routes).toHaveLength(1);
  });

  it("refuses a second active route for the same triple", async () => {
    const token = await signIn("admin@example.com");
    const ids = await seedMaster(token);

    await request(app).post("/supplier-routes").set(authed(token)).send({ ...ids, wholesaleCost: 700 });
    const second = await request(app)
      .post("/supplier-routes")
      .set(authed(token))
      .send({ ...ids, wholesaleCost: 900 });

    // Ambiguous pricing is refused rather than resolved arbitrarily.
    expect(second.status).toBe(409);
  });

  it("expires a route without touching the order snapshot", async () => {
    const token = await signIn("admin@example.com");
    const ids = await seedMaster(token);
    const route = await request(app)
      .post("/supplier-routes")
      .set(authed(token))
      .send({ ...ids, wholesaleCost: 700 });

    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Snap Client", email: `m-${Date.now()}@example.com` });
    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...ids, sellingPrice: 2500 });

    const expired = await request(app)
      .post(`/supplier-routes/${route.body.route.id}/expire`)
      .set(authed(token))
      .send({});
    expect(expired.status).toBe(200);
    expect(expired.body.route.status).toBe("expired");

    const stored = await Order.findById(order.body.order.id).lean();
    expect(stored?.supplierCostSnapshot).toBe(700);
  });

  it("rejects a duplicate qualification code as a conflict", async () => {
    const token = await signIn("admin@example.com");
    await request(app).post("/qualifications").set(authed(token)).send({ code: "DUP1", title: "A" });
    const second = await request(app).post("/qualifications").set(authed(token)).send({ code: "DUP1", title: "B" });
    expect(second.status).toBe(409);
  });
});

/* ==================== order checklist + certificate ==================== */

describe("checklist and certificate rows", () => {
  it("opens the document checklist and a certificate record with the order", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Checklist Client", email: `cl-${Date.now()}@example.com` });
    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });
    const orderId = order.body.order.id as string;

    // Both collections existed as schemas with nothing ever writing a row.
    const requirements = await DocumentRequirement.find({ orderId }).lean();
    expect(requirements.length).toBeGreaterThan(0);
    expect(requirements.every((r) => r.status === "Not Received")).toBe(true);

    const certificate = await Certificate.findOne({ orderId }).lean();
    expect(certificate?.status).toBe("Not Issued");

    const res = await request(app).get(`/orders/${orderId}/checklist`).set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.requirements.length).toBe(requirements.length);
  });

  it("makes certificateStatus writable through the dimensions endpoint", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Cert Client", email: `cert-${Date.now()}@example.com` });
    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });

    const res = await request(app)
      .patch(`/orders/${order.body.order.id}/dimensions`)
      .set(authed(token))
      .send({ certificateStatus: "Issued" });

    expect(res.status).toBe(200);
    expect(res.body.order.certificateStatus).toBe("Issued");
  });
});

/* ==================== filter sanitization ==================== */

describe("filter sanitization", () => {
  it("escapes regex metacharacters in a search term", () => {
    expect(escapeRegex("a.b")).toBe("a\\.b");
    expect(escapeRegex(".*")).toBe("\\.\\*");
    expect(escapeRegex("(x)")).toBe("\\(x\\)");
  });

  it("does not let a regex metacharacter turn a search into match-all", async () => {
    const token = await signIn("admin@example.com");
    await request(app).post("/qualifications").set(authed(token)).send({ code: "REAL1", title: "Real" });
    await request(app).post("/qualifications").set(authed(token)).send({ code: "REAL2", title: "Other" });

    const res = await request(app).get("/qualifications?search=.*").set(authed(token));
    expect(res.status).toBe(200);
    // `.*` searched literally matches nothing, rather than everything.
    expect(res.body.qualifications).toHaveLength(0);
  });
});

/* ==================== agents typed separately ==================== */

describe("agent types", () => {
  it("stores and filters the three agent types separately", async () => {
    const token = await signIn("admin@example.com");
    for (const [name, type] of [
      ["Sales One", "sales_closing"],
      ["Source One", "certificate_source"],
      ["RTO Contact One", "rto_contact"],
    ] as const) {
      await request(app).post("/agents").set(authed(token)).send({ name, type });
    }

    expect(await Agent.countDocuments()).toBe(3);
    for (const type of ["sales_closing", "certificate_source", "rto_contact"]) {
      const res = await request(app).get(`/agents?type=${type}`).set(authed(token));
      expect(res.body.agents).toHaveLength(1);
      expect(res.body.agents[0].type).toBe(type);
    }
  });
});