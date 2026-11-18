/**
 * M1.8 — Reports & API Security Hardening regression tests.
 *
 * Covers confirmed fixes (no new business rules):
 * - clients report: applyFinancialVisibility hides invoiced/collected/outstanding
 *   from B2B_AGENT; BDC retains them.
 * - collections report: invoices/payments scoped to accessible orders for
 *   non-admin roles; applyFinancialVisibility hides invoiced/collected from
 *   B2B_AGENT; BDC retains them.
 *
 * Uses the in-memory replica set (tests/setup.ts); no production database.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import {
  clearDb,
  makeBDCToken,
  makeB2BAgentToken,
  makeAdminToken,
  authedRequest,
  seedClient,
  seedOrder,
  seedInvoice,
} from "./helpers";
import { getDb } from "@/lib/db";
import { GET as clientsReport } from "@/app/api/reports/clients/route";
import { GET as collectionsReport } from "@/app/api/reports/collections/route";

async function seedClientsScenario() {
  const clientId = new ObjectId();
  await seedClient(clientId, "Alpha Client", "alpha@test.com");
  const orderId = new ObjectId();
  await seedOrder(
    orderId,
    clientId,
    new ObjectId(),
    new ObjectId(),
    new ObjectId(),
    new ObjectId(),
    { bdc_id: "bdc-user-1", b2b_agent_id: "b2b-user-1", sellingPrice: 5000, currency: "AUD" },
  );
  await seedInvoice(new ObjectId(), orderId, 5000);
  const db = await getDb();
  await db.collection("payments").insertOne({
    _id: new ObjectId(),
    orderId,
    invoiceId: new ObjectId(),
    allocatedAmount: 4000,
    currency: "AUD",
    status: "Completed",
    createdAt: new Date(),
  });
  return { clientId, orderId };
}

async function seedCollectionsScenario() {
  // BDC-owned order
  const bdcClientId = new ObjectId();
  await seedClient(bdcClientId, "BDC Client", "bdc@test.com");
  const bdcOrderId = new ObjectId();
  await seedOrder(
    bdcOrderId,
    bdcClientId,
    new ObjectId(),
    new ObjectId(),
    new ObjectId(),
    new ObjectId(),
    { bdc_id: "bdc-user-1", sellingPrice: 5000, currency: "AUD" },
  );
  await seedInvoice(new ObjectId(), bdcOrderId, 5000);
  const db = await getDb();
  await db.collection("payments").insertOne({
    _id: new ObjectId(),
    orderId: bdcOrderId,
    invoiceId: new ObjectId(),
    allocatedAmount: 3000,
    currency: "AUD",
    status: "Completed",
    createdAt: new Date(),
  });

  // B2B-owned order
  const b2bClientId = new ObjectId();
  await seedClient(b2bClientId, "B2B Client", "b2b@test.com");
  const b2bOrderId = new ObjectId();
  await seedOrder(
    b2bOrderId,
    b2bClientId,
    new ObjectId(),
    new ObjectId(),
    new ObjectId(),
    new ObjectId(),
    { b2b_agent_id: "b2b-user-1", sellingPrice: 8000, currency: "AUD" },
  );
  await seedInvoice(new ObjectId(), b2bOrderId, 8000);
  await db.collection("payments").insertOne({
    _id: new ObjectId(),
    orderId: b2bOrderId,
    invoiceId: new ObjectId(),
    allocatedAmount: 5000,
    currency: "AUD",
    status: "Completed",
    createdAt: new Date(),
  });

  return { bdcOrderId, b2bOrderId };
}

describe("M1.8 — clients report financial visibility", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("hides invoiced/collected/outstanding from B2B_AGENT", async () => {
    await seedClientsScenario();
    const res = await clientsReport(
      authedRequest("GET", "/api/reports/clients", undefined, makeB2BAgentToken("b2b-user-1")),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clients.length).toBeGreaterThan(0);
    for (const c of body.clients) {
      for (const cur of Object.keys(c.byCurrency ?? {})) {
        expect(c.byCurrency[cur].invoiced).toBeUndefined();
        expect(c.byCurrency[cur].collected).toBeUndefined();
        expect(c.byCurrency[cur].outstanding).toBeUndefined();
      }
    }
  });

  it("retains invoiced/collected/outstanding for BDC", async () => {
    await seedClientsScenario();
    const res = await clientsReport(
      authedRequest("GET", "/api/reports/clients", undefined, makeBDCToken("bdc-user-1")),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clients.length).toBeGreaterThan(0);
    const client = body.clients[0];
    const cur = Object.keys(client.byCurrency)[0];
    expect(client.byCurrency[cur].invoiced).toBe(10000);
    expect(client.byCurrency[cur].collected).toBe(4000);
    expect(client.byCurrency[cur].outstanding).toBe(6000);
  });

  it("shows all financial fields for ADMIN", async () => {
    await seedClientsScenario();
    const res = await clientsReport(
      authedRequest("GET", "/api/reports/clients", undefined, makeAdminToken()),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clients.length).toBeGreaterThan(0);
    const client = body.clients[0];
    const cur = Object.keys(client.byCurrency)[0];
    expect(client.byCurrency[cur].invoiced).toBe(10000);
    expect(client.byCurrency[cur].collected).toBe(4000);
    expect(client.byCurrency[cur].outstanding).toBe(6000);
  });
});

describe("M1.8 — collections report ownership and financial visibility", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("restricts invoices/payments to accessible orders for BDC", async () => {
    await seedCollectionsScenario();
    const res = await collectionsReport(
      authedRequest("GET", "/api/reports/collections", undefined, makeBDCToken("bdc-user-1")),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.months.length).toBe(1);
    expect(body.months[0].invoiced).toBe(5000);
    expect(body.months[0].collected).toBe(3000);
    expect(body.months[0].orders).toBe(1);
  });

  it("restricts invoices/payments to accessible orders for B2B_AGENT", async () => {
    await seedCollectionsScenario();
    const res = await collectionsReport(
      authedRequest("GET", "/api/reports/collections", undefined, makeB2BAgentToken("b2b-user-1")),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.months.length).toBe(1);
    expect(body.months[0].orders).toBe(1);
  });

  it("hides invoiced/collected from B2B_AGENT", async () => {
    await seedCollectionsScenario();
    const res = await collectionsReport(
      authedRequest("GET", "/api/reports/collections", undefined, makeB2BAgentToken("b2b-user-1")),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const m of body.months) {
      expect(m.invoiced).toBeUndefined();
      expect(m.collected).toBeUndefined();
    }
  });

  it("retains invoiced/collected for BDC", async () => {
    await seedCollectionsScenario();
    const res = await collectionsReport(
      authedRequest("GET", "/api/reports/collections", undefined, makeBDCToken("bdc-user-1")),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const m of body.months) {
      expect(typeof m.invoiced).toBe("number");
      expect(typeof m.collected).toBe("number");
    }
  });

  it("shows all data for ADMIN", async () => {
    await seedCollectionsScenario();
    const res = await collectionsReport(
      authedRequest("GET", "/api/reports/collections", undefined, makeAdminToken()),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.months.length).toBe(1);
    expect(body.months[0].invoiced).toBe(13000);
    expect(body.months[0].collected).toBe(8000);
    expect(body.months[0].orders).toBe(2);
  });
});
