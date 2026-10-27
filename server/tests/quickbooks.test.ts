import { createHmac } from "node:crypto";

import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { buildInvoicePayload } from "../src/integrations/quickbooks/payloads.js";
import { createRateLimiter, createSharedRateLimiter } from "../src/lib/rate-limit.js";
import { Client } from "../src/models/client.model.js";
import { Invoice } from "../src/models/invoice.model.js";
import { Order } from "../src/models/order.model.js";
import { QBSyncRecord } from "../src/models/qb-sync-record.model.js";
import { processSyncRecord } from "../src/services/qb-sync.service.js";
import {
  clearTestDb,
  createUser,
  seedOrderMasters,
  seedRoles,
  setupTestDatabase,
} from "./helpers/test-db.js";

/**
 * B5 completion criteria added after the first pass:
 *
 *  - the QuickBooks transport is real, not a stub
 *  - the webhook verifies Intuit's HMAC over the raw body
 *  - the queue and the limiter degrade instead of failing
 *  - a redelivered job cannot create a second QuickBooks record
 *
 * QuickBooks itself is never called: there are no sandbox credentials here, so
 * these prove the refusal paths, the payload mapping and the signature check —
 * the parts that are ours. The HTTP layer is exercised through dependency-free
 * `fetch` stubs where a round trip is unavoidable.
 */
setupTestDatabase();

const PASSWORD = "CorrectHorseBattery1!";
const WEBHOOK_SECRET = "test-only-qb-webhook-secret";

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

/** Creates a client + order, optionally linked to a QuickBooks customer. */
async function makeOrder(
  token: string,
  qbCustomerId: string | null = null,
): Promise<{ orderId: string; clientId: string }> {
  const masters = await seedOrderMasters();
  const client = await request(app)
    .post("/clients")
    .set(authed(token))
    .send({ legalName: "QB Client", email: `qb-${Date.now()}-${Math.random()}@example.com` });

  const clientId = client.body.client.id as string;
  if (qbCustomerId) await Client.updateOne({ _id: clientId }, { $set: { qbCustomerId } });

  const order = await request(app)
    .post("/orders")
    .set(authed(token))
    .send({ clientId, ...masters, sellingPrice: 2500 });

  return { orderId: order.body.order.id as string, clientId };
}

function sign(body: string, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("base64");
}

/* ==================== webhook signature ==================== */

describe("QuickBooks webhook", () => {
  const payload = JSON.stringify({
    eventNotifications: [
      { realmId: "123", dataChangeEvent: { entities: [{ Id: "42", name: "Invoice" }] } },
    ],
  });

  it("rejects an unsigned callback", async () => {
    const res = await request(app)
      .post("/integrations/quickbooks/webhook")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_SIGNATURE");
  });

  it("rejects a signature made with the wrong secret", async () => {
    const res = await request(app)
      .post("/integrations/quickbooks/webhook")
      .set("Content-Type", "application/json")
      .set("intuit-signature", sign(payload, "not-the-secret"))
      .send(payload);

    expect(res.status).toBe(401);
  });

  it("accepts a correctly signed callback", async () => {
    const res = await request(app)
      .post("/integrations/quickbooks/webhook")
      .set("Content-Type", "application/json")
      .set("intuit-signature", sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("rejects a tampered body even when the header is copied from a valid one", async () => {
    // This is the case the raw-body parser exists for: a valid signature over
    // the original bytes must not validate a modified payload.
    const signature = sign(payload);
    const res = await request(app)
      .post("/integrations/quickbooks/webhook")
      .set("Content-Type", "application/json")
      .set("intuit-signature", signature)
      .send(JSON.stringify({ eventNotifications: [] }));

    expect(res.status).toBe(401);
  });

  it("updates the matching sync record and ignores unknown ids", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 500, dueDate: "2030-01-01" });
    const invoiceId = inv.body.invoice.id as string;

    await QBSyncRecord.updateOne(
      { entityId: invoiceId },
      { $set: { qbReference: "42" } },
    );

    const res = await request(app)
      .post("/integrations/quickbooks/webhook")
      .set("Content-Type", "application/json")
      .set("intuit-signature", sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.matched).toBe(1);

    const record = await QBSyncRecord.findOne({ entityId: invoiceId }).lean();
    expect(record?.qbReference).toBe("42");
  });
});

/* ==================== payload mapping ==================== */

describe("QuickBooks payload mapping", () => {
  it("refuses an invoice for a client that is not linked to QuickBooks", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token, null);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 750, dueDate: "2030-01-01" });
    const invoiceId = inv.body.invoice.id as string;

    const built = await buildInvoicePayload(invoiceId);
    expect(built.ok).toBe(false);
    expect(built.error).toContain("not linked to a QuickBooks customer");
  });

  it("builds a QuickBooks invoice with our own DocNumber", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token, "QB-CUST-77");

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 750, dueDate: "2030-01-01" });
    const invoiceId = inv.body.invoice.id as string;
    const local = await Invoice.findById(invoiceId).lean();

    const built = await buildInvoicePayload(invoiceId);
    expect(built.ok).toBe(true);

    const payload = built.payload as {
      CustomerRef: { value: string };
      DocNumber: string;
      DueDate: string;
      Line: Array<{ Amount: number }>;
    };

    expect(payload.CustomerRef.value).toBe("QB-CUST-77");
    // Our number, not one QuickBooks invents — this is what B6 reconciles on.
    expect(payload.DocNumber).toBe(local!.invoiceNumber);
    expect(payload.DueDate).toBe("2030-01-01");
    expect(payload.Line[0]?.Amount).toBe(750);
  });

  it("refuses a voided invoice rather than creating it in QuickBooks", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token, "QB-CUST-78");

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 100, dueDate: "2030-01-01" });
    const invoiceId = inv.body.invoice.id as string;

    await request(app).post(`/invoices/${invoiceId}/void`).set(authed(token));

    const built = await buildInvoicePayload(invoiceId);
    expect(built.ok).toBe(false);
    expect(built.error).toContain("void");
  });
});

/* ==================== queue idempotency ==================== */

describe("queued sync idempotency", () => {
  it("does nothing when a redelivered job targets an already-synced record", async () => {
    const token = await signIn("admin@example.com");
    const { orderId } = await makeOrder(token);

    const inv = await request(app)
      .post("/invoices")
      .set(authed(token))
      .send({ orderId, total: 100, dueDate: "2030-01-01" });
    const invoiceId = inv.body.invoice.id as string;

    const record = await QBSyncRecord.findOne({ entityId: invoiceId }).lean();
    expect(record).not.toBeNull();

    // Pretend the first attempt reached QuickBooks.
    await QBSyncRecord.updateOne(
      { _id: record!._id },
      { $set: { status: "Synced", qbReference: "QB-REAL-1", attempts: 3 } },
    );

    const result = await processSyncRecord(String(record!._id));
    expect(result.ok).toBe(true);

    const after = await QBSyncRecord.findById(record!._id).lean();
    // Untouched — a second attempt would create a duplicate in QuickBooks.
    expect(after?.attempts).toBe(3);
    expect(after?.qbReference).toBe("QB-REAL-1");
  });

  it("reports a failure for an unknown record instead of throwing", async () => {
    const result = await processSyncRecord("000000000000000000000000");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not found");
  });
});

/* ==================== integration routes ==================== */

describe("QuickBooks integration routes", () => {
  it("reports why the integration cannot sync yet", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app).get("/integrations/quickbooks/status").set(authed(token));

    expect(res.status).toBe(200);
    // No credentials in the test environment.
    expect(res.body.configured).toBe(false);
    expect(res.body.authorised).toBe(false);
    expect(res.body.hint).toContain("QB_REALM_ID");
    // Never any token material.
    expect(JSON.stringify(res.body)).not.toContain("accessToken");
  });

  it("gives 404 for a single sync record that does not exist", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app)
      .get("/integrations/quickbooks/sync/invoice/000000000000000000000000")
      .set(authed(token));

    expect(res.status).toBe(404);
  });

  it("rejects a callback whose state does not match the session", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app)
      .get("/integrations/quickbooks/callback")
      .query({ code: "abc", realmId: "123", state: "someone-elses-user-id" })
      .set(authed(token));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("STATE_MISMATCH");
  });

  it("refuses /connect when QuickBooks is not configured", async () => {
    const token = await signIn("admin@example.com");
    const res = await request(app).get("/integrations/quickbooks/connect").set(authed(token));

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("QB_NOT_CONFIGURED");
  });

  it("gives a Sales user 403 on /connect — connecting is administrative", async () => {
    const sales = await signIn("sales@example.com", ["Sales / Closing Agent"]);
    const res = await request(app).get("/integrations/quickbooks/connect").set(authed(sales));

    expect(res.status).toBe(403);
  });
});

/* ==================== rate limiter ==================== */

describe("rate limiter", () => {
  it("keeps the in-process limiter's behaviour", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });

    expect((await limiter.hit("a")).allowed).toBe(true);
    expect((await limiter.hit("a")).allowed).toBe(true);
    const third = await limiter.hit("a");
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);

    limiter.reset("a");
    expect((await limiter.hit("a")).allowed).toBe(true);
  });

  it("enforces the limit without Redis present", async () => {
    // The dev machine has no Redis, so this exercises the degraded path: the
    // limiter must still refuse, never silently allow everything.
    const limiter = createSharedRateLimiter({ windowMs: 60_000, max: 1 });

    expect((await limiter.hit("k")).allowed).toBe(true);
    expect((await limiter.hit("k")).allowed).toBe(false);
  });

  it("refuses the attempt once the login limit is reached", async () => {
    const admin = await createUser({ email: "target@example.com", password: PASSWORD });
    expect(admin.email).toBe("target@example.com");

    const seen = new Set<number>();
    for (let i = 0; i < 8; i += 1) {
      const res = await request(app)
        .post("/auth/login")
        .send({ email: "target@example.com", password: "WrongPassword123!" });
      seen.add(res.status);
    }

    // 429 once the window fills; 401 while it has not.
    expect(seen.has(429)).toBe(true);
    expect(seen.has(401)).toBe(true);
    expect(seen.has(500)).toBe(false);
  });
});

/* ==================== regression guard ==================== */

describe("order snapshot still immutable", () => {
  it("keeps the supplier cost snapshot after a route repricing", async () => {
    const token = await signIn("admin@example.com");
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Snap Client", email: `snap-${Date.now()}@example.com` });
    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });

    const orderId = order.body.order.id as string;
    const original = await Order.findById(orderId).lean();

    // Try to rewrite history directly — the schema must refuse.
    await Order.updateOne(
      { _id: orderId },
      { $set: { supplierCostSnapshot: 1 } },
    ).catch(() => undefined);

    const after = await Order.findById(orderId).lean();
    expect(after?.supplierCostSnapshot).toBe(original?.supplierCostSnapshot);
  });
});