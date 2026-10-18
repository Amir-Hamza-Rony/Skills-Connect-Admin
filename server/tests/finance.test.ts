import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { Invoice } from "../src/models/invoice.model.js";
import { Payment } from "../src/models/payment.model.js";
import { PaymentPlan } from "../src/models/payment-plan.model.js";
import { QBSyncRecord } from "../src/models/qb-sync-record.model.js";
import {
  clearTestDb,
  createUser,
  seedOrderMasters,
  seedRoles,
  setupTestDatabase,
} from "./helpers/test-db.js";

/**
 * B5 acceptance criteria:
 *  - payment → balance math matches the front-end
 *  - a failed sync retried with the same key creates exactly one QB record
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

/** Creates a client + order and returns the order id. */
async function makeOrder(token: string): Promise<string> {
  const masters = await seedOrderMasters();
  const client = await request(app)
    .post("/clients")
    .set(authed(token))
    .send({ legalName: "Fin Client", email: `fin-${Date.now()}@example.com` });
  const order = await request(app)
    .post("/orders")
    .set(authed(token))
    .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });
  return order.body.order.id as string;
}

/**
 * A date `days` from today, as `YYYY-MM-DD`.
 *
 * Tests use these rather than hardcoded dates so "past due" and "pending" stay
 * meaningful no matter when the suite runs — a fixed date silently flips from
 * future to past as the calendar moves.
 */
function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Creates a plan with the given instalments and returns the plan id. */
async function makePlan(
  token: string,
  orderId: string,
  instalments: Array<{ dueDate: string; amount: number }>,
): Promise<string> {
  const total = instalments.reduce((s, i) => s + i.amount, 0);
  const plan = await request(app)
    .post(`/orders/${orderId}/payment-plan`)
    .set(authed(token))
    .send({ total });
  expect(plan.status).toBe(201);
  const planId = plan.body.plan.id as string;

  for (const inst of instalments) {
    const res = await request(app)
      .post(`/payment-plans/${planId}/instalments`)
      .set(authed(token))
      .send(inst);
    expect(res.status).toBe(201);
  }
  return planId;
}

/* ==================== allocation + balance math ==================== */

describe("payment allocation", () => {
  it("allocates oldest-due-first across instalments", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [
      { dueDate: daysFromNow(-30), amount: 500 },
      { dueDate: daysFromNow(30), amount: 500 },
      { dueDate: daysFromNow(60), amount: 500 },
    ]);

    const res = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 700, date: daysFromNow(0), method: "Bank Transfer", reference: "REF1" });

    expect(res.status).toBe(201);
    expect(res.body.payment.allocatedAmount).toBe(700);
    expect(res.body.payment.status).toBe("Allocated");

    // Oldest first: 500 to v1, 200 to v2.
    const allocations = res.body.payment.allocations;
    expect(allocations[0]).toMatchObject({ instalmentId: expect.any(String), amount: 500 });
    expect(allocations[1]).toMatchObject({ amount: 200 });

    const plan = await request(app).get(`/orders/${orderId}/payment-plan`).set(authed(token));
    const [first, second, third] = plan.body.plan.instalments;
    expect(first.status).toBe("Paid");
    expect(first.paidAmount).toBe(500);
    expect(second.status).toBe("Part Paid");
    expect(second.paidAmount).toBe(200);
    expect(third.status).toBe("Pending");
  });

  it("marks a payment Unallocated when the order has no plan", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const res = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 500, date: "2026-01-15", method: "Cash" });

    expect(res.status).toBe(201);
    expect(res.body.payment.status).toBe("Unallocated");
    expect(res.body.payment.allocatedAmount).toBe(0);
  });

  it("skips Waived and Cancelled instalments", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    const planId = await makePlan(token, orderId, [
      { dueDate: "2026-01-10", amount: 500 },
      { dueDate: "2026-02-10", amount: 500 },
    ]);

    const plan = await PaymentPlan.findById(planId);
    if (plan && plan.instalments[0]) {
      plan.instalments[0].status = "Waived";
      await plan.save();
    }

    const res = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 300, date: "2026-01-15", method: "Card" });

    expect(res.status).toBe(201);
    // All 300 went to the second instalment; the waived one was skipped.
    expect(res.body.payment.allocatedAmount).toBe(300);
    expect(res.body.payment.allocations).toHaveLength(1);
  });
});

/* ==================== invoice status ==================== */

describe("invoice status", () => {
  it("moves Sent → Part Paid → Paid as payments land", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [{ dueDate: daysFromNow(30), amount: 1000 }]);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: daysFromNow(30) });
    expect(inv.status).toBe(201);
    const invoiceId = inv.body.invoice.id as string;
    expect(inv.body.invoice.status).toBe("Sent");

    const part = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, invoiceId, amount: 400, date: daysFromNow(0), method: "Bank Transfer" });
    expect(part.status).toBe(201);

    let stored = await Invoice.findById(invoiceId);
    expect(stored?.status).toBe("Part Paid");

    await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, invoiceId, amount: 600, date: daysFromNow(0), method: "Bank Transfer" });

    stored = await Invoice.findById(invoiceId);
    expect(stored?.status).toBe("Paid");
  });

  it("flags an unpaid past-due invoice as Overdue", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: daysFromNow(-30) });

    expect(inv.body.invoice.status).toBe("Overdue");
  });

  it("voids an invoice and refuses payment against it", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [{ dueDate: "2026-03-10", amount: 1000 }]);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: "2026-03-10" });
    const invoiceId = inv.body.invoice.id as string;

    const voidRes = await request(app)
      .post(`/invoices/${invoiceId}/void`)
      .set(authed(token));
    expect(voidRes.status).toBe(200);
    expect(voidRes.body.invoice.status).toBe("Void");

    const pay = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, invoiceId, amount: 100, date: "2026-01-15", method: "Cash" });
    expect(pay.status).toBe(422);
    expect(pay.body.error.code).toBe("INVOICE_VOID");
  });
});

/* ==================== refunds ==================== */

describe("refunds", () => {
  it("reverses the allocation so instalments become payable again", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [{ dueDate: "2026-01-10", amount: 500 }]);

    const pay = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 500, date: "2026-01-15", method: "Bank Transfer" });
    const paymentId = pay.body.payment.id as string;

    const planBefore = await request(app).get(`/orders/${orderId}/payment-plan`).set(authed(token));
    expect(planBefore.body.plan.instalments[0].status).toBe("Paid");

    const refund = await request(app)
      .post(`/payments/${paymentId}/refund`)
      .set(authed(token));
    expect(refund.status).toBe(200);
    expect(refund.body.payment.status).toBe("Refunded");

    const planAfter = await request(app).get(`/orders/${orderId}/payment-plan`).set(authed(token));
    expect(planAfter.body.plan.instalments[0].paidAmount).toBe(0);
  });

  it("refuses a double refund", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [{ dueDate: "2026-01-10", amount: 500 }]);

    const pay = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 500, date: "2026-01-15", method: "Bank Transfer" });
    const paymentId = pay.body.payment.id as string;

    await request(app).post(`/payments/${paymentId}/refund`).set(authed(token));
    const again = await request(app).post(`/payments/${paymentId}/refund`).set(authed(token));

    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe("ALREADY_REFUNDED");
  });
});

/* ==================== summary ==================== */

describe("finance summary", () => {
  it("reports invoiced, paid, outstanding and overdue", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [
      { dueDate: daysFromNow(-30), amount: 500 },
      { dueDate: daysFromNow(30), amount: 500 },
    ]);

    await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: daysFromNow(30) });

    await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 300, date: daysFromNow(0), method: "Bank Transfer" });

    const res = await request(app).get(`/finance/summary?orderId=${orderId}`).set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.invoiced).toBe(1000);
    expect(res.body.paid).toBe(300);
    expect(res.body.outstanding).toBe(700);
    // The past-due instalment had 300 of its 500 paid, leaving 200 overdue.
    expect(res.body.overdue).toBe(200);
  });
});

/* ==================== QuickBooks idempotent sync ==================== */

describe("QuickBooks sync", () => {
  it("creates a sync record when an invoice is created", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: "2026-03-10" });
    const invoiceId = inv.body.invoice.id as string;

    const records = await QBSyncRecord.find({ entityType: "invoice", entityId: invoiceId }).lean();
    expect(records).toHaveLength(1);
    expect(records[0]?.idempotencyKey).toBe(`qb-invoice-${invoiceId}-v1`);
  });

  it("reuses the SAME idempotency key on retry — never a duplicate", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: "2026-03-10" });
    const invoiceId = inv.body.invoice.id as string;

    const list = await request(app).get("/integrations/quickbooks/sync").set(authed(token));
    const record = list.body.records.find(
      (r: { entityType: string; entityId: string }) =>
        r.entityType === "invoice" && r.entityId === invoiceId,
    );
    expect(record).toBeDefined();
    const key = record.idempotencyKey as string;

    // Retry several times. The key must not change and no duplicate may appear.
    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post(`/integrations/quickbooks/sync/invoice/${invoiceId}`)
        .set(authed(token));
    }

    const after = await QBSyncRecord.find({ entityType: "invoice", entityId: invoiceId }).lean();
    expect(after).toHaveLength(1);
    expect(after[0]?.idempotencyKey).toBe(key);
    expect(after[0]?.attempts).toBeGreaterThanOrEqual(4);
  });

  it("fails cleanly when QuickBooks is not configured", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 1000, dueDate: "2026-03-10" });
    const invoiceId = inv.body.invoice.id as string;

    const list = await request(app).get("/integrations/quickbooks/sync").set(authed(token));
    const record = list.body.records.find(
      (r: { entityType: string; entityId: string }) =>
        r.entityType === "invoice" && r.entityId === invoiceId,
    );

    // No QB creds in the test env, so the sync fails with a named reason.
    expect(record.status).toBe("Failed");
    expect(record.syncError).toContain("not configured");
  });

  it("rejects a retry for an unknown entity", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app)
      .post("/integrations/quickbooks/sync/invoice/000000000000000000000000")
      .set(authed(token));
    expect(res.status).toBe(404);
  });
});

/* ==================== RBAC ==================== */

describe("RBAC on finance", () => {
  it("gives a Sales user 403 on payment creation", async () => {
    const token = await signIn("sales@example.com", ["Sales / Closing Agent"]);
    const orderId = await makeOrder(await signIn("admin@example.com"));

    const res = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 100, date: "2026-01-15", method: "Cash" });

    expect(res.status).toBe(403);
  });

  it("lets Finance read but only finance.manage write", async () => {
    const finance = await signIn("fin@example.com", ["Finance"]);
    const orderId = await makeOrder(await signIn("admin@example.com"));

    expect((await request(app).get("/invoices").set(authed(finance))).status).toBe(200);
    expect((await request(app).get("/payments").set(authed(finance))).status).toBe(200);
    expect((await request(app).get("/integrations/quickbooks/sync").set(authed(finance))).status).toBe(200);

    // Finance has finance.manage, so writes are allowed.
    const inv = await request(app)
      .post("/invoices")
      .set(authed(finance))
      .send({ orderId, total: 100, dueDate: "2026-03-10" });
    expect(inv.status).toBe(201);
  });

  it("gives a Sales user 403 on the QB retry", async () => {
    const sales = await signIn("sales@example.com", ["Sales / Closing Agent"]);
    const res = await request(app)
      .post("/integrations/quickbooks/sync/invoice/000000000000000000000000")
      .set(authed(sales));
    expect(res.status).toBe(403);
  });

  it("requires authentication before permission", async () => {
    expect((await request(app).get("/invoices")).status).toBe(401);
    expect((await request(app).get("/payments")).status).toBe(401);
  });
});

/* ==================== audit ==================== */

describe("audit trail for finance", () => {
  it("records invoice.create, payment.record and payment.refund", async () => {
    const { AuditLog } = await import("../src/models/audit-log.model.js");
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [{ dueDate: "2026-01-10", amount: 500 }]);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 500, dueDate: "2026-01-10" });
    const invoiceId = inv.body.invoice.id as string;

    const pay = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, invoiceId, amount: 500, date: "2026-01-15", method: "Bank Transfer" });
    const paymentId = pay.body.payment.id as string;

    await request(app).post(`/payments/${paymentId}/refund`).set(authed(token));

    const actions = await AuditLog.find({}).distinct("action");
    expect(actions).toContain("invoice.create");
    expect(actions).toContain("payment.record");
    expect(actions).toContain("payment.refund");
  });
});

/* ==================== model guarantees ==================== */

describe("model guarantees", () => {
  it("enforces one payment plan per order", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    await request(app).post(`/orders/${orderId}/payment-plan`).set(authed(token)).send({ total: 1000 });
    const second = await request(app)
      .post(`/orders/${orderId}/payment-plan`)
      .set(authed(token))
      .send({ total: 2000 });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("PLAN_EXISTS");
  });

  it("enforces a unique invoice number", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);

    const first = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 100, dueDate: "2026-03-10" });
    const second = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 200, dueDate: "2026-03-11" });

    expect(first.body.invoice.invoiceNumber).not.toBe(second.body.invoice.invoiceNumber);
  });

  it("never deletes a payment — a refund flips status only", async () => {
    const token = await signIn("admin@example.com");
    const orderId = await makeOrder(token);
    await makePlan(token, orderId, [{ dueDate: "2026-01-10", amount: 500 }]);

    const pay = await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, amount: 500, date: "2026-01-15", method: "Bank Transfer" });
    const paymentId = pay.body.payment.id as string;

    await request(app).post(`/payments/${paymentId}/refund`).set(authed(token));

    expect(await Payment.countDocuments({ _id: paymentId })).toBe(1);
  });
});
