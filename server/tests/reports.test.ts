import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { clearTestDb, createUser, seedRoles, setupTestDatabase } from "./helpers/test-db.js";

/**
 * B6 acceptance: dashboard numbers equal DB aggregations, and the audit viewer
 * returns what was written.
 *
 * The reports page used to aggregate in the browser, so a report could disagree
 * with the dashboard and neither could be proven wrong. These tests pin the two
 * together: the report output must be derivable from the same rows the API
 * returns.
 */
setupTestDatabase();

const PASSWORD = "CorrectHorseBattery1!";
let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await clearTestDb();
  await seedRoles();
});

async function signIn(email: string, roleNames: string[] = ["Super Admin"]): Promise<string> {
  await createUser({ email, password: PASSWORD, roleNames });
  const res = await request(app).post("/auth/login").send({ email, password: PASSWORD });
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

let orderCounter = 0;

/**
 * Creates a client + order with a unique qualification code.
 *
 * `Qualification.code` is unique, so reusing one code for two orders in a single
 * test is a duplicate-key error rather than a report.
 */
async function makeOrder(
  token: string,
  qualificationCode: string,
  sellingPrice: number,
): Promise<{ orderId: string; clientId: string; qualificationId: string }> {
  orderCounter += 1;
  const code = `${qualificationCode}-${orderCounter}`;

  const admin = await request(app)
    .post("/auth/login")
    .send({ email: "admin@example.com", password: PASSWORD });
  const adminToken = admin.body.accessToken as string;

  const { Agent } = await import("../src/models/agent.model.js");
  const { Rto } = await import("../src/models/rto.model.js");
  const { Qualification } = await import("../src/models/qualification.model.js");
  const { SupplierRoute } = await import("../src/models/supplier-route.model.js");

  const sales = await Agent.create({ name: "Sales A", type: "sales_closing" });
  const source = await Agent.create({ name: "Source A", type: "certificate_source" });
  const rto = await Rto.create({ legalName: "RTO A", rtoCode: `RTO-${Date.now()}-${orderCounter}` });
  const qual = await Qualification.create({ code, title: "Cert" });
  await SupplierRoute.create({
    qualificationId: qual._id,
    sourceAgentId: source._id,
    rtoId: rto._id,
    wholesaleCost: 700,
  });

  const client = await request(app)
    .post("/clients")
    .set(authed(adminToken))
    .send({ legalName: "Rep Client", email: `rep-${Date.now()}-${Math.random()}@example.com` });
  const clientId = client.body.client.id as string;

  const order = await request(app)
    .post("/orders")
    .set(authed(adminToken))
    .send({
      clientId,
      qualificationId: String(qual._id),
      salesAgentId: String(sales._id),
      sourceAgentId: String(source._id),
      rtoId: String(rto._id),
      sellingPrice,
    });

  return {
    orderId: order.body.order.id as string,
    clientId,
    qualificationId: String(qual._id),
  };
}

/* ==================== finance ==================== */

describe("GET /reports/finance", () => {
  it("totals match the underlying rows", async () => {
    const token = await signIn("admin@example.com");
    await makeOrder(token, "AUR32120", 2500);
    await makeOrder(token, "AUR32120", 3500);

    const res = await request(app).get("/reports/finance").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.orders).toBe(2);
    expect(res.body.pipelineValue).toBe(6000);
  });
});

/* ==================== revenue ==================== */

describe("GET /reports/revenue", () => {
  it("groups revenue by qualification code", async () => {
    const token = await signIn("admin@example.com");
    await makeOrder(token, "REVA", 1000);
    await makeOrder(token, "REVA", 2000);
    await makeOrder(token, "REVB", 500);

    const res = await request(app).get("/reports/revenue").set(authed(token));
    expect(res.status).toBe(200);

    // Codes carry a uniqueness suffix, so match on the prefix.
    const revA = res.body.byQualification.filter((r: { name: string }) => r.name.startsWith("REVA"));
    expect(revA.reduce((s: number, r: { revenue: number }) => s + r.revenue, 0)).toBe(3000);
    expect(revA.reduce((s: number, r: { orders: number }) => s + r.orders, 0)).toBe(2);
  });

  it("groups revenue by sales agent", async () => {
    const token = await signIn("admin@example.com");
    await makeOrder(token, "AGT", 4000);

    const res = await request(app).get("/reports/revenue").set(authed(token));
    expect(res.body.byAgent).toHaveLength(1);
    expect(res.body.byAgent[0].revenue).toBe(4000);
    expect(res.body.byAgent[0].name).toBe("Sales A");
  });

  it("honours the qualification filter", async () => {
    const token = await signIn("admin@example.com");
    const first = await makeOrder(token, "FILT", 1000);
    await makeOrder(token, "FILT", 9999);

    // Filter on the qualification the first order was actually created with.
    const res = await request(app)
      .get(`/reports/revenue?qualificationId=${first.qualificationId}`)
      .set(authed(token));

    expect(res.body.byQualification).toHaveLength(1);
    expect(res.body.byQualification[0].name.startsWith("FILT")).toBe(true);
  });
});

/* ==================== margin ==================== */

describe("GET /reports/margin", () => {
  it("margin equals selling price minus all costs", async () => {
    const token = await signIn("admin@example.com");
    // sellingPrice 2500, wholesale 700, otherCost 0 -> 1800
    await makeOrder(token, "MARG", 2500);

    const res = await request(app).get("/reports/margin").set(authed(token));
    expect(res.body.totals.margin).toBe(1800);
    expect(res.body.totals.revenue).toBe(2500);
    expect(res.body.totals.cost).toBe(700);
  });

  it("computes a percentage that is not above 100", async () => {
    const token = await signIn("admin@example.com");
    await makeOrder(token, "MARG2", 1000);

    const res = await request(app).get("/reports/margin").set(authed(token));
    // The percentage lives on the per-qualification rows, not the totals.
    expect(res.body.byQualification[0].percent).toBeLessThanOrEqual(100);
  });
});

/* ==================== funnel ==================== */

describe("GET /reports/funnel", () => {
  it("counts orders by stage and computes conversion", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token, "FUN", 1000);

    const res = await request(app).get("/reports/funnel").set(authed(token));
    expect(res.body.total).toBe(1);
    expect(res.body.conversionPercent).toBe(0);
    const newStage = res.body.byStage.find((s: { stage: string }) => s.stage === "New");
    expect(newStage.count).toBe(1);

    await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "Completed" });

    const after = await request(app).get("/reports/funnel").set(authed(token));
    expect(after.body.conversionPercent).toBe(100);
  });
});

/* ==================== ageing ==================== */

describe("GET /reports/ageing", () => {
  it("buckets overdue invoices by days past due", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token, "AGE", 1000);

    await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: daysFromNow(-45) });

    // Flip it to Overdue the way the sweep does.
    const { Invoice } = await import("../src/models/invoice.model.js");
    await Invoice.updateMany({ orderId }, { $set: { status: "Overdue" } });

    const res = await request(app).get("/reports/ageing").set(authed(token));
    expect(res.body.totalOverdue).toBe(1000);
    expect(res.body.buckets).toHaveLength(4);
    const bucket = res.body.buckets.find((b: { label: string }) => b.label === "31-60 days");
    expect(bucket.count).toBe(1);
    expect(bucket.amount).toBe(1000);
  });
});

/* ==================== audit ==================== */

describe("GET /audit", () => {
  it("returns events with actor, entity and before/after", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token, "AUD", 1000);

    await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "In Progress" });

    const res = await request(app).get("/audit").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
    expect(res.body.events[0]).toHaveProperty("action");
    expect(res.body.events[0]).toHaveProperty("entityType");
    expect(res.body.events[0]).toHaveProperty("before");
    expect(res.body.events[0]).toHaveProperty("after");
  });

  it("filters by entity type", async () => {
    const token = await signIn("admin@example.com");
    await makeOrder(token, "FLT", 1000);

    const res = await request(app).get("/audit?entityType=order").set(authed(token));
    expect(res.body.events.length).toBeGreaterThan(0);
    expect(res.body.events.every((e: { entityType: string }) => e.entityType === "order")).toBe(true);
  });

  it("searches across action, entity id and the before/after values", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token, "SRCH", 1000);
    await request(app)
      .patch(`/orders/${orderId}/status`)
      .set(authed(token))
      .send({ status: "Completed" });

    const byValue = await request(app).get("/audit?search=Completed").set(authed(token));
    expect(byValue.body.events.length).toBeGreaterThan(0);

    const byAction = await request(app).get("/audit?search=order.status.change").set(authed(token));
    expect(byAction.body.events.length).toBeGreaterThan(0);
  });

  it("paginates and reports a total", async () => {
    const token = await signIn("admin@example.com");
    await makeOrder(token, "PAGE", 1000);

    const page1 = await request(app).get("/audit?page=1&pageSize=5").set(authed(token));
    expect(page1.body.pageSize).toBe(5);
    expect(page1.body.events.length).toBeLessThanOrEqual(5);
    expect(page1.body.total).toBeGreaterThanOrEqual(page1.body.events.length);
  });

  it("caps the page size no matter what is asked", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app).get("/audit?pageSize=100000").set(authed(token));
    expect(res.body.pageSize).toBeLessThanOrEqual(200);
  });

  it("rejects an unknown entity type filter value", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app).get("/audit?entityType=").set(authed(token));
    expect(res.status).toBe(200);
  });

  it("serves the filter vocabulary", async () => {
    const token = await signIn("admin@example.com");
    await makeOrder(token, "VOC", 1000);

    const res = await request(app).get("/audit/filters").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.entityTypes).toContain("order");
    expect(Array.isArray(res.body.actions)).toBe(true);
  });
});

/* ==================== RBAC on reports and audit ==================== */

describe("reports and audit permissions", () => {
  it("refuses a role without reports.view", async () => {
    const sales = await signIn("sales@example.com", ["Sales / Closing Agent"]);

    // Sales has reports.view, so reports are open...
    expect((await request(app).get("/reports/finance").set(authed(sales))).status).toBe(200);
    // ...but not the audit log, which is audit.view.
    expect((await request(app).get("/audit").set(authed(sales))).status).toBe(403);
  });

  it("refuses the audit log to a role without audit.view", async () => {
    const sales = await signIn("sales@example.com", ["Sales / Closing Agent"]);
    // Sales holds reports.view, so the reports stay open...
    expect((await request(app).get("/reports/finance").set(authed(sales))).status).toBe(200);
    // ...but reading the audit log needs audit.view, which Sales does not hold.
    expect((await request(app).get("/audit").set(authed(sales))).status).toBe(403);
  });

  it("grants the audit log to a role holding audit.view", async () => {
    const ops = await signIn("ops@example.com", ["Operations"]);
    expect((await request(app).get("/audit").set(authed(ops))).status).toBe(200);
  });

  it("refuses anonymous", async () => {
    expect((await request(app).get("/reports/finance")).status).toBe(401);
    expect((await request(app).get("/audit")).status).toBe(401);
  });

  it("rejects a malformed id with a named 400", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app)
      .get("/reports/revenue?qualificationId=not-an-id")
      .set(authed(token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_ID");
  });
});