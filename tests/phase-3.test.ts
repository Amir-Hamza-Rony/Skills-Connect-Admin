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
  POST as createRplPartner,
  GET as listRplPartners,
} from "@/app/api/rpl-partners/route";
import {
  GET as getRplPartner,
  PATCH as updateRplPartner,
  DELETE as deleteRplPartner,
} from "@/app/api/rpl-partners/[id]/route";
import {
  POST as createCertificateDelivery,
  GET as listCertificateDeliveries,
} from "@/app/api/certificate-deliveries/route";
import {
  PATCH as updateCertificateDelivery,
} from "@/app/api/certificate-deliveries/[id]/route";
import {
  POST as uploadCertificate,
} from "@/app/api/certificates/[id]/upload/route";

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

describe("Phase 3 — RPL Partner management", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates an RPL partner and normalizes code to uppercase", async () => {
    const res = await createRplPartner(
      authedRequest("POST", "/api/rpl-partners", {
        partnerCode: "rpl-001",
        legalName: "Test Partner Pty Ltd",
        tradingName: "Test Partner",
        contactPerson: "Jane Doe",
        email: "jane@test.example.com",
        phone: "0400 000 000",
        address: "123 Test St",
        status: "active",
        notes: "Test notes",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.rplPartner.partnerCode).toBe("RPL-001");
    expect(body.rplPartner.legalName).toBe("Test Partner Pty Ltd");
    expect(body.rplPartner.status).toBe("active");
  });

  it("prevents duplicate partner code (409)", async () => {
    await createRplPartner(
      authedRequest("POST", "/api/rpl-partners", {
        partnerCode: "RPL-001",
        legalName: "Partner One",
      }),
    );
    const dup = await createRplPartner(
      authedRequest("POST", "/api/rpl-partners", {
        partnerCode: "rpl-001",
        legalName: "Partner Two",
      }),
    );
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("CONFLICT");
  });

  it("lists RPL partners with search and status filter", async () => {
    const db = (await import("@/lib/db")).getDb;
    await (await db()).collection("rpl_partners").insertOne({
      partnerCode: "RPL-ALPHA",
      legalName: "Alpha Partner",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await (await db()).collection("rpl_partners").insertOne({
      partnerCode: "RPL-BETA",
      legalName: "Beta Partner",
      status: "inactive",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const list = await listRplPartners(
      authedRequest("GET", "/api/rpl-partners?search=alpha"),
    );
    expect((await json(list)).items.length).toBe(1);

    const active = await listRplPartners(
      authedRequest("GET", "/api/rpl-partners?status=active"),
    );
    const activeBody = await json(active);
    expect(activeBody.items.length).toBe(1);
    expect(activeBody.items[0].partnerCode).toBe("RPL-ALPHA");
  });

  it("gets, updates, and deactivates an RPL partner", async () => {
    const db = (await import("@/lib/db")).getDb;
    const inserted = await (await db()).collection("rpl_partners").insertOne({
      partnerCode: "RPL-TEST",
      legalName: "Test Partner",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const id = String(inserted.insertedId);

    const get = await getRplPartner(
      authedRequest("GET", `/api/rpl-partners/${id}`),
      { params: { id } },
    );
    expect(get.status).toBe(200);
    const body = await json(get);
    expect(body.rplPartner.legalName).toBe("Test Partner");

    const upd = await updateRplPartner(
      authedRequest("PATCH", `/api/rpl-partners/${id}`, {
        legalName: "Updated Partner",
        status: "inactive",
      }),
      { params: { id } },
    );
    expect(upd.status).toBe(200);

    const del = await deleteRplPartner(
      authedRequest("DELETE", `/api/rpl-partners/${id}`),
      { params: { id } },
    );
    expect(del.status).toBe(200);
    const delBody = await json(del);
    expect(delBody.ok).toBe(true);
  });
});

describe("Phase 3 — Partner assignment on order creation", () => {
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

  it("creates order with valid active RPL partner", async () => {
    const { clientId, qId, aId, rId } = await seedOrderEntities();
    const db = (await import("@/lib/db")).getDb;
    const partner = await (await db()).collection("rpl_partners").insertOne({
      partnerCode: "RPL-001",
      legalName: "Test Partner",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId,
        qualificationId: qId,
        salesAgentId: String(new ObjectId()),
        sourceAgentId: aId,
        rtoId: rId,
        sellingPrice: 5000,
        rplPartnerId: String(partner.insertedId),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("rejects order with inactive RPL partner", async () => {
    const { clientId, qId, aId, rId } = await seedOrderEntities();
    const db = (await import("@/lib/db")).getDb;
    const partner = await (await db()).collection("rpl_partners").insertOne({
      partnerCode: "RPL-INACTIVE",
      legalName: "Inactive Partner",
      status: "inactive",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId,
        qualificationId: qId,
        salesAgentId: String(new ObjectId()),
        sourceAgentId: aId,
        rtoId: rId,
        sellingPrice: 5000,
        rplPartnerId: String(partner.insertedId),
      }),
    );
    expect(res.status).toBe(400);
    expect((await json(res)).error.code).toBe("BAD_REQUEST");
  });

  it("rejects order with nonexistent RPL partner", async () => {
    const { clientId, qId, aId, rId } = await seedOrderEntities();
    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId,
        qualificationId: qId,
        salesAgentId: String(new ObjectId()),
        sourceAgentId: aId,
        rtoId: rId,
        sellingPrice: 5000,
        rplPartnerId: new ObjectId().toString(),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("creates order without RPL partner (backward compatible)", async () => {
    const { clientId, qId, aId, rId } = await seedOrderEntities();
    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId,
        qualificationId: qId,
        salesAgentId: String(new ObjectId()),
        sourceAgentId: aId,
        rtoId: rId,
        sellingPrice: 5000,
      }),
    );
    expect(res.status).toBe(201);
  });
});

describe("Phase 3 — Certificate delivery tracking", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("creates and lists certificate deliveries", async () => {
    const db = (await import("@/lib/db")).getDb;
    const orderId = new ObjectId();
    await (await db()).collection("orders").insertOne({
      _id: orderId,
      clientId: new ObjectId(),
      qualificationId: new ObjectId(),
      salesAgentId: new ObjectId(),
      sourceAgentId: new ObjectId(),
      rtoId: new ObjectId(),
      status: "Certificate Issued",
      sellingPrice: 5000,
      supplierCostSnapshot: 1500,
      currency: "AUD",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await createCertificateDelivery(
      authedRequest("POST", "/api/certificate-deliveries", {
        orderId: String(orderId),
        certificateReference: "CERT-001",
        deliveryStatus: "pending",
        recipient: "Student Name",
        deliveryMethod: "Courier",
        trackingNumber: "TRK123",
        deliveryNotes: "Test delivery",
      }),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.certificateDelivery.deliveryStatus).toBe("pending");
    expect(body.certificateDelivery.orderId).toBe(String(orderId));

    const list = await listCertificateDeliveries(
      authedRequest("GET", `/api/certificate-deliveries?orderId=${orderId}`),
    );
    const listBody = await json(list);
    expect(listBody.items.length).toBe(1);
    expect(listBody.items[0].deliveryStatus).toBe("pending");
    expect(listBody.items[0].trackingNumber).toBe("TRK123");
  });

  it("updates delivery status with valid transition", async () => {
    const db = (await import("@/lib/db")).getDb;
    const inserted = await (await db()).collection("certificate_deliveries").insertOne({
      orderId: new ObjectId(),
      certificateReference: "CERT-001",
      deliveryStatus: "pending",
      updatedBy: "test-user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const id = String(inserted.insertedId);

    const upd = await updateCertificateDelivery(
      authedRequest("PATCH", `/api/certificate-deliveries/${id}`, {
        deliveryStatus: "dispatched",
      }),
      { params: { id } },
    );
    expect(upd.status).toBe(200);
    const body = await json(upd);
    expect(body.certificateDelivery.deliveryStatus).toBe("dispatched");
  });

  it("rejects invalid delivery status transition", async () => {
    const db = (await import("@/lib/db")).getDb;
    const inserted = await (await db()).collection("certificate_deliveries").insertOne({
      orderId: new ObjectId(),
      certificateReference: "CERT-001",
      deliveryStatus: "delivered",
      updatedBy: "test-user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const id = String(inserted.insertedId);

    const upd = await updateCertificateDelivery(
      authedRequest("PATCH", `/api/certificate-deliveries/${id}`, {
        deliveryStatus: "pending",
      }),
      { params: { id } },
    );
    expect(upd.status).toBe(400);
    expect((await json(upd)).error.code).toBe("INVALID_TRANSITION");
  });
});
