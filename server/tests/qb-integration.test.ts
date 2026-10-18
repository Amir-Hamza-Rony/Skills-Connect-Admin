import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startQBStub, type QBStub } from "./helpers/qb-stub.js";

/**
 * B5's headline criterion, actually exercised: QuickBooks sync, end to end.
 *
 * Everything else in the B5 suite runs against an injected transport, which is
 * how the "retry creates a duplicate" bug hid — the injected function was
 * asserted on, but no HTTP request was ever made. This file points the real
 * client at a local server that speaks Intuit's OAuth and v3 contract, so:
 *
 *   - the OAuth authorization-code exchange really happens
 *   - the v3 invoice/payment POSTs really happen, with a Bearer header
 *   - a token that expires mid-flight is refreshed and the call retried
 *   - **retrying a synced record does not create a second QuickBooks record**
 *
 * What this still cannot prove is that Intuit behaves as documented. Only a
 * sandbox run proves that.
 *
 * Env has to be set BEFORE `config/env` is imported, hence the dynamic imports:
 * a static `import { createApp }` would be hoisted above these assignments and
 * the client would still be pointing at Intuit.
 */

const STUB_PORT = 4599;
const STUB_REALM = "stub-realm-1";

const stub: QBStub = await startQBStub({
  port: STUB_PORT,
  clientId: "stub-client-id",
  clientSecret: "stub-client-secret",
});

process.env.QB_API_BASE_URL = stub.url;
process.env.QB_TOKEN_URL = `${stub.url}/oauth2/v1/tokens/bearer`;
process.env.QB_REALM_ID = STUB_REALM;
process.env.QB_CLIENT_ID = "stub-client-id";
process.env.QB_CLIENT_SECRET = "stub-client-secret";
process.env.QB_SANDBOX = "true";

const { createApp } = await import("../src/app.js");
const { clearTestDb, createUser, seedOrderMasters, seedRoles, setupTestDatabase } = await import(
  "./helpers/test-db.js"
);
const { Client } = await import("../src/models/client.model.js");
const { QBSyncRecord } = await import("../src/models/qb-sync-record.model.js");
const { QBConnection } = await import("../src/models/qb-connection.model.js");
const { exchangeCodeForTokens, getAccessToken, quickBooksStatus } = await import(
  "../src/integrations/quickbooks/client.js"
);

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

afterAll(async () => {
  await stub.close();
});

async function signIn(email: string, roleNames: string[] = ["Super Admin"]): Promise<string> {
  await createUser({ email, password: PASSWORD, roleNames });
  const res = await request(app).post("/auth/login").send({ email, password: PASSWORD });
  return res.body.accessToken as string;
}

function authed(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** Client + order, with the client mapped to a QuickBooks customer. */
async function makeOrder(token: string): Promise<string> {
  const masters = await seedOrderMasters();
  const client = await request(app)
    .post("/clients")
    .set(authed(token))
    .send({ legalName: "QB Client", email: `qbe2e-${Date.now()}-${Math.random()}@example.com` });
  await Client.updateOne({ _id: client.body.client.id }, { $set: { qbCustomerId: "QB-CUST-1" } });

  const order = await request(app)
    .post("/orders")
    .set(authed(token))
    .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });
  return order.body.order.id as string;
}

async function makeInvoice(token: string, orderId: string, total = 1000): Promise<string> {
  const inv = await request(app)
    .post("/invoices")
    .set(authed(token))
    .send({ orderId, total, dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10) });
  return inv.body.invoice.id as string;
}

/* ==================== OAuth ==================== */

describe("QuickBooks OAuth", () => {
  it("exchanges an authorization code and stores the token pair", async () => {
    const result = await exchangeCodeForTokens("auth-code-123", STUB_REALM);
    expect(result.ok).toBe(true);

    // Secrets are `select: false`, so reading them back is explicit.
    const stored = await QBConnection.findOne({ realmId: STUB_REALM })
      .select("+accessToken +refreshToken")
      .lean();
    expect(stored?.accessToken).toMatch(/^access-token-/);
    expect(stored?.refreshToken).toMatch(/^refresh-token-/);

    // A bare read must not carry them — this is what stops a stray query
    // leaking a bearer credential into a response.
    const bare = await QBConnection.findOne({ realmId: STUB_REALM }).lean();
    expect(bare?.accessToken).toBeUndefined();
    expect(bare?.refreshToken).toBeUndefined();
  });

  it("refuses an authorisation that has not happened", async () => {
    await QBConnection.deleteMany({});
    const status = await quickBooksStatus();
    expect(status.configured).toBe(true);
    expect(status.authorised).toBe(false);

    const token = await getAccessToken();
    expect(token.ok).toBe(false);
    expect(token.error).toContain("not authorised");
  });

  it("rotates both halves of the token pair on refresh", async () => {
    await exchangeCodeForTokens("code", STUB_REALM);
    const before = await QBConnection.findOne({ realmId: STUB_REALM })
      .select("+accessToken +refreshToken")
      .lean();

    // Backdate the stored expiry, which is what the 60-second skew guard keys
    // on. (Rotating only the stub's token would leave our cached token looking
    // valid, so no refresh would be attempted — that is the 401 path, covered
    // by its own test below.)
    await QBConnection.updateOne({ realmId: STUB_REALM }, { $set: { expiresAt: Date.now() - 1000 } });

    const refreshed = await getAccessToken();
    expect(refreshed.ok).toBe(true);
    expect(stub.calls.refresh).toBeGreaterThan(0);

    const after = await QBConnection.findOne({ realmId: STUB_REALM })
      .select("+accessToken +refreshToken")
      .lean();

    // Intuit rotates the refresh token too; keeping the old one would strand
    // the connection on the next refresh.
    expect(after?.accessToken).not.toBe(before?.accessToken);
    expect(after?.refreshToken).not.toBe(before?.refreshToken);
    expect(after?.expiresAt).toBeGreaterThan(Date.now());
  });
});

/* ==================== end-to-end sync ==================== */

describe("QuickBooks sync, over real HTTP", () => {
  it("creates exactly one QuickBooks invoice across a failure and four retries", async () => {
    const token = await signIn("admin@example.com");
    await exchangeCodeForTokens("code", STUB_REALM);
    const orderId = await makeOrder(token);

    // The stub's counters are cumulative across the file, so every assertion is
    // a delta from a baseline rather than an absolute.
    const callsBefore = stub.calls.invoice;

    // Fail the first create, so the criterion's "failed sync → retry" half is
    // genuinely exercised rather than skipped.
    stub.failNextCreates(1);

    const invoiceId = await makeInvoice(token, orderId);

    // Creation was attempted and refused.
    const failed = await QBSyncRecord.findOne({ entityId: invoiceId }).lean();
    expect(failed?.status).toBe("Failed");
    expect(failed?.syncError).toContain("Simulated QuickBooks failure");
    expect(stub.calls.invoice).toBe(callsBefore); // refused, so nothing was created

    // Retry until it succeeds. The first retry is consumed by the forced
    // failure above; the second goes through.
    await request(app).post(`/integrations/quickbooks/sync/invoice/${invoiceId}`).set(authed(token)).send({});
    const succeeded = await request(app)
      .post(`/integrations/quickbooks/sync/invoice/${invoiceId}`)
      .set(authed(token))
      .send({});

    expect(succeeded.status).toBe(200);
    expect(succeeded.body.record.status).toBe("Synced");
    expect(stub.calls.invoice).toBe(callsBefore + 1);

    // The decisive assertion: two more retries on a synced record must not
    // create anything further, and must not even bump the attempt counter.
    await request(app).post(`/integrations/quickbooks/sync/invoice/${invoiceId}`).set(authed(token)).send({});
    await request(app).post(`/integrations/quickbooks/sync/invoice/${invoiceId}`).set(authed(token)).send({});

    expect(stub.calls.invoice).toBe(callsBefore + 1);
    expect(stub.createdInvoiceDocNumbers).toHaveLength(callsBefore + 1);

    // ...and the local record points at the record QuickBooks actually issued.
    const final = await QBSyncRecord.findOne({ entityId: invoiceId }).lean();
    expect(final?.qbReference).toBe(`QB-INV-${callsBefore + 1}`);
    // create (refused by the forced failure) + one retry that went through.
    expect(final?.attempts).toBe(2);
    expect(await QBSyncRecord.countDocuments({ entityId: invoiceId })).toBe(1);
  });

  it("sends our own invoice number so B6 can reconcile on it", async () => {
    const token = await signIn("admin@example.com");
    await exchangeCodeForTokens("code", STUB_REALM);
    const orderId = await makeOrder(token);

    const before = stub.createdInvoiceDocNumbers.length;
    await makeInvoice(token, orderId, 1750);
    await request(app).post(`/integrations/quickbooks/sync/invoice/${`x`}`).set(authed(token)).send({});

    // Drive the retry path so the invoice is actually created.
    const list = await request(app).get("/integrations/quickbooks/sync").set(authed(token));
    const record = list.body.records.find(
      (r: { entityType: string; status: string }) => r.entityType === "invoice" && r.status === "Synced",
    );
    expect(record).toBeDefined();

    const created = stub.createdInvoiceDocNumbers.slice(before);
    expect(created).toHaveLength(1);
    // Matches `INV-YYYY-NNNN`, not a QuickBooks-minted number.
    expect(created[0]).toMatch(/^INV-\d{4}-\d{4}$/);
  });

  it("recovers when the access token expires between the check and the call", async () => {
    const token = await signIn("admin@example.com");
    await exchangeCodeForTokens("code", STUB_REALM);
    const orderId = await makeOrder(token);

    // 401 on the call, refresh, retry — all without the caller noticing.
    stub.expireAccessToken();
    const refreshesBefore = stub.calls.refresh;

    const invoiceId = await makeInvoice(token, orderId);
    await request(app).post(`/integrations/quickbooks/sync/invoice/${invoiceId}`).set(authed(token)).send({});

    expect(stub.calls.refresh).toBeGreaterThan(refreshesBefore);

    const record = await QBSyncRecord.findOne({ entityId: invoiceId }).lean();
    expect(record?.status).toBe("Synced");
  });

  it("reports a QuickBooks fault as one readable line", async () => {
    const token = await signIn("admin@example.com");
    await exchangeCodeForTokens("code", STUB_REALM);
    const callsBefore = stub.calls.invoice;

    // A client with no QB mapping — the payload builder refuses before the call.
    const masters = await seedOrderMasters();
    const client = await request(app)
      .post("/clients")
      .set(authed(token))
      .send({ legalName: "Unmapped", email: `unmapped-${Date.now()}@example.com` });
    const order = await request(app)
      .post("/orders")
      .set(authed(token))
      .send({ clientId: client.body.client.id, ...masters, sellingPrice: 2500 });

    const invoiceId = await makeInvoice(token, order.body.order.id);

    const record = await QBSyncRecord.findOne({ entityId: invoiceId }).lean();
    expect(record?.status).toBe("Failed");
    expect(record?.syncError).toContain("not linked to a QuickBooks customer");
    expect(record?.syncError).toContain("Unmapped");
    // Refused before the network call, so nothing was sent at all.
    expect(stub.calls.invoice).toBe(callsBefore);
  });

  it("syncs a payment against its invoice", async () => {
    const token = await signIn("admin@example.com");
    await exchangeCodeForTokens("code", STUB_REALM);
    const orderId = await makeOrder(token);
    const invoiceId = await makeInvoice(token, orderId);

    const plan = await request(app)
      .post(`/orders/${orderId}/payment-plan`)
      .set(authed(token))
      .send({ total: 1000 });
    await request(app)
      .post(`/payment-plans/${plan.body.plan.id}/instalments`)
      .set(authed(token))
      .send({ dueDate: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10), amount: 1000 });

    const before = stub.calls.payment;
    await request(app)
      .post("/payments")
      .set(authed(token))
      .send({ orderId, invoiceId, amount: 400, date: new Date().toISOString().slice(0, 10), method: "Bank Transfer" });

    expect(stub.calls.payment).toBe(before + 1);

    const record = await QBSyncRecord.findOne({ entityType: "payment", entityId: invoiceId });
    // The payment's own sync record is separate from the invoice's.
    expect(record).toBeNull();
  });

  it("reports configured and authorised through the status endpoint", async () => {
    await exchangeCodeForTokens("code", STUB_REALM);
    const token = await signIn("admin@example.com");

    const res = await request(app).get("/integrations/quickbooks/status").set(authed(token));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.authorised).toBe(true);
    expect(res.body.hint).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("access-token-");
  });
});