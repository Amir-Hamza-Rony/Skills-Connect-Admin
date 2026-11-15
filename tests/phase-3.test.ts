import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import {
  POST as createClient,
  GET as listClients,
} from "@/app/api/clients/route";
import {
  POST as createOrder,
} from "@/app/api/orders/route";
import {
  POST as createRtoProcessing,
  GET as listRtoProcessing,
} from "@/app/api/rto-processing/route";

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
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

describe("Phase 3 — Client management", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates a client and prevents duplicate email", async () => {
    const res = await createClient(
      authedRequest("POST", "/api/clients", {
        legalName: "Jane Client",
        email: "jane@example.com",
        phone: "0400 000 000",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.client.legalName).toBe("Jane Client");
    expect(body.client.email).toBe("jane@example.com");

    const dup = await createClient(
      authedRequest("POST", "/api/clients", {
        legalName: "Jane Duplicate",
        email: "JANE@example.com",
      }),
    );
    expect(dup.status).toBe(409);
  });

  it("lists clients with search", async () => {
    await seedClient(new ObjectId(), "Alpha Client", "alpha@example.com");
    await seedClient(new ObjectId(), "Beta Client", "beta@example.com");

    const list = await listClients(
      authedRequest("GET", "/api/clients?search=alpha"),
    );
    const body = await json(list);
    expect(body.clients.length).toBe(1);
    expect(body.clients[0].legalName).toBe("Alpha Client");
  });
});

describe("Phase 3 — Multiple orders per client", () => {
  beforeEach(async () => {
    await clearDb();
  });

  async function seedOrderEntities() {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rId, 1500);
    // seed qualification–rto mapping
    const db = (await import("@/lib/db")).getDb;
    await (await db()).collection("qualification-rto-mappings").insertOne({
      qualificationId: new ObjectId(qId),
      rtoId: new ObjectId(rId),
      status: "active",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return { clientId: String(clientId), qId: String(qId), aId: String(aId), rId: String(rId) };
  }

  it("creates multiple orders for one client", async () => {
    const { clientId, qId, aId, rId } = await seedOrderEntities();

    const o1 = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId,
        qualificationId: qId,
        salesAgentId: String(new ObjectId()),
        sourceAgentId: aId,
        rtoId: rId,
        sellingPrice: 5000,
      }),
    );
    expect(o1.status).toBe(201);

    const o2 = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId,
        qualificationId: qId,
        salesAgentId: String(new ObjectId()),
        sourceAgentId: aId,
        rtoId: rId,
        sellingPrice: 7000,
      }),
    );
    expect(o2.status).toBe(201);

    const list = await listClients(
      authedRequest("GET", "/api/clients"),
    );
    const body = await json(list);
    expect(body.clients.length).toBe(1);
  });

  it("rejects order when qualification–RTO mapping missing", async () => {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rId, 1500);
    // deliberately NO qualification–rto mapping

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 5000,
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("NO_QUALIFICATION_RTO_MAPPING");
  });

  it("allows order when qualification–RTO mapping exists", async () => {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rId, 1500);
    // seed mapping
    const db = (await import("@/lib/db")).getDb;
    await (await db()).collection("qualification-rto-mappings").insertOne({
      qualificationId: new ObjectId(qId),
      rtoId: new ObjectId(rId),
      status: "active",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 5000,
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("Phase 3 — Order pricing snapshot preservation", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("preserves selling price and supplier cost when price list changes", async () => {
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const rId = await seedRto();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rId, 1500);
    // mapping
    const db = (await import("@/lib/db")).getDb;
    await (await db()).collection("qualification-rto-mappings").insertOne({
      qualificationId: new ObjectId(qId),
      rtoId: new ObjectId(rId),
      status: "active",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const created = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 5000,
      }),
    );
    const { order } = await json(created);

    const orders = await (await db()).collection("orders");
    const stored = await orders.findOne({ _id: new ObjectId(order.id) });
    expect(stored.sellingPrice).toBe(5000);
    expect(stored.supplierCostSnapshot).toBe(1500);
    expect(stored.currency).toBe("AUD");
  });
});

describe("Phase 3 — RTO processing", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates and lists an RTO processing record", async () => {
    const orderId = new ObjectId();
    const rtoId = await seedRto();

    // seed order
    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rtoId, 1500);
    const db = (await import("@/lib/db")).getDb;
    await (await db()).collection("qualification-rto-mappings").insertOne({
      qualificationId: new ObjectId(qId),
      rtoId: new ObjectId(rtoId),
      status: "active",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await (await db()).collection("orders").insertOne({
      _id: orderId,
      clientId: new ObjectId(clientId),
      qualificationId: new ObjectId(qId),
      salesAgentId: new ObjectId(),
      sourceAgentId: new ObjectId(aId),
      rtoId: new ObjectId(rtoId),
      status: "Submitted to RTO",
      sellingPrice: 5000,
      supplierCostSnapshot: 1500,
      currency: "AUD",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await createRtoProcessing(
      authedRequest("POST", "/rto-processing", {
        orderId: String(orderId),
        rtoId: String(rtoId),
        submissionStatus: "Submitted to RTO",
        processingStatus: "Under Assessment",
        submissionDate: "2027-02-01",
        rtoReference: "RTO-REF-1",
        processingFees: 300,
        processingCurrency: "AUD",
        notes: "Waiting on RTO",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.rtoProcessing.processingStatus).toBe("Under Assessment");
    expect(body.rtoProcessing.processingFees).toBe(300);

    const list = await listRtoProcessing(
      authedRequest("GET", `/rto-processing?orderId=${orderId}`),
    );
    expect((await json(list)).items.length).toBe(1);
  });

  it("prevents duplicate RTO processing record per order", async () => {
    const orderId = new ObjectId();
    const rtoId = await seedRto();

    const clientId = await seedClient();
    const qId = await seedQualification();
    const aId = await seedAgent();
    const cId = await seedPriceCategory();
    await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
    await seedSupplierRoute(qId, aId, rtoId, 1500);
    const db = (await import("@/lib/db")).getDb;
    await (await db()).collection("qualification-rto-mappings").insertOne({
      qualificationId: new ObjectId(qId),
      rtoId: new ObjectId(rtoId),
      status: "active",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await (await db()).collection("orders").insertOne({
      _id: orderId,
      clientId: new ObjectId(clientId),
      qualificationId: new ObjectId(qId),
      salesAgentId: new ObjectId(),
      sourceAgentId: new ObjectId(aId),
      rtoId: new ObjectId(rtoId),
      status: "New",
      sellingPrice: 5000,
      supplierCostSnapshot: 1500,
      currency: "AUD",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await createRtoProcessing(
      authedRequest("POST", "/rto-processing", {
        orderId: String(orderId),
        rtoId: String(rtoId),
        processingStatus: "Not Started",
      }),
    );
    const dup = await createRtoProcessing(
      authedRequest("POST", "/rto-processing", {
        orderId: String(orderId),
        rtoId: String(rtoId),
        processingStatus: "Not Started",
      }),
    );
    expect(dup.status).toBe(409);
  });
});
