/**
 * Phase 6 — Testing & QA
 *
 * Route guard penetration testing, payload inspection (zero margin leakage),
 * B2B candidate isolation, 100-Point ID gate, immutable snapshot verification.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ObjectId } from "mongodb";

import { getDb } from "@/lib/db";
import { POST as createOrder } from "@/app/api/orders/route";
import { PATCH as setStatus } from "@/app/api/orders/[id]/status/route";
import { GET as listOrders } from "@/app/api/orders/route";
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
  makeSuperAdminToken,
  makeBDCToken,
  makeB2BAgentToken,
  makeToken,
} from "./helpers";
import { applyFinancialVisibility } from "@/lib/financial-visibility";

function json(res: Response) {
  return res.json() as Promise<any>;
}

async function seedBaseline() {
  const clientId = await seedClient(undefined, "Test Client", "client@test.com", {
    id_points_verified: 100,
  });
  const qId = await seedQualification();
  const rId = await seedRto();
  const aId = await seedAgent();
  const cId = await seedPriceCategory();
  await seedPriceList(new ObjectId(), qId, cId, 5000, "AUD");
  await seedSupplierRoute(qId, aId, rId, 1500);
  await seedMapping(qId, rId);
  return { clientId, qId, rId, aId };
}

async function seedOrderWithPricing(overrides: Record<string, unknown> = {}) {
  const { clientId, qId, rId, aId } = await seedBaseline();
  const orderRes = await createOrder(
    authedRequest("POST", "/api/orders", {
      clientId: String(clientId),
      qualificationId: String(qId),
      salesAgentId: String(new ObjectId()),
      sourceAgentId: String(aId),
      rtoId: String(rId),
      sellingPrice: 5000,
      trueRtoCost: 1500,
      approvedInternalCost: 3000,
      b2bWholesalePrice: 4000,
      b2cRetailPrice: 5000,
    }),
  );
  const { order } = await json(orderRes);
  return { order, ...overrides };
}

async function GETOrders(token: string) {
  const { GET } = await import("@/app/api/orders/route");
  return GET(authedRequest("GET", "/api/orders", undefined, token));
}

/* =========================================================================
 * 1. Route guard penetration testing
 * =========================================================================*/

describe("Phase 6 — Route guard penetration testing", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("SALES_BDC cannot access qualifications management (403)", async () => {
    await seedBaseline();
    const token = makeToken(["SALES_BDC"], [
      "clients.view", "clients.manage", "orders.view", "orders.manage",
      "documents.view", "reports.view", "commissions.view",
    ]);
    const { GET } = await import("@/app/api/masters/[type]/route");
    const res = await GET(
      authedRequest("GET", "/api/masters/qualifications", undefined, token),
      { params: { type: "qualifications" } },
    );
    expect(res.status).toBe(403);
  });

  it("SALES_BDC cannot access RTO management (403)", async () => {
    await seedBaseline();
    const token = makeToken(["SALES_BDC"], [
      "clients.view", "clients.manage", "orders.view", "orders.manage",
      "documents.view", "reports.view", "commissions.view",
    ]);
    const { GET } = await import("@/app/api/masters/[type]/route");
    const res = await GET(
      authedRequest("GET", "/api/masters/rtos", undefined, token),
      { params: { type: "rtos" } },
    );
    expect(res.status).toBe(403);
  });

  it("SALES_BDC cannot access scopes management (403)", async () => {
    await seedBaseline();
    const token = makeToken(["SALES_BDC"], [
      "clients.view", "clients.manage", "orders.view", "orders.manage",
      "documents.view", "reports.view", "commissions.view",
    ]);
    const { GET } = await import("@/app/api/scopes/route");
    const res = await GET(
      authedRequest("GET", "/api/scopes", undefined, token),
      undefined,
    );
    expect(res.status).toBe(403);
  });

  it("EXTERNAL_BROKER cannot access scopes management (403)", async () => {
    await seedBaseline();
    const token = makeToken(["EXTERNAL_BROKER"], [
      "clients.view", "clients.manage", "orders.view", "documents.view", "reports.view",
    ]);
    const { GET } = await import("@/app/api/scopes/route");
    const res = await GET(
      authedRequest("GET", "/api/scopes", undefined, token),
      undefined,
    );
    expect(res.status).toBe(403);
  });

  it("SUPER_ADMIN can access all Phase 4/5 routes (not 403)", async () => {
    await seedBaseline();
    // Direct import checks that route modules exist and are guarded (not 403
    // due to missing permission). Some routes may return 404/400 for bogus
    // params, which is fine — they're not permission errors.
    const checks = [
      () => import("@/app/api/masters/[type]/route").then((m) =>
        m.GET(authedRequest("GET", "/api/test", undefined, makeSuperAdminToken()), { params: { type: "qualifications" } })
      ),
      () => import("@/app/api/masters/[type]/route").then((m) =>
        m.GET(authedRequest("GET", "/api/test", undefined, makeSuperAdminToken()), { params: { type: "rtos" } })
      ),
      () => import("@/app/api/scopes/route").then((m) =>
        m.GET(authedRequest("GET", "/api/test", undefined, makeSuperAdminToken()), undefined)
      ),
      () => import("@/app/api/enrolment-kits/route").then((m) =>
        m.GET(authedRequest("GET", "/api/test", undefined, makeSuperAdminToken()), undefined)
      ),
    ];
    for (const check of checks) {
      const res = await check();
      expect(res.status).not.toBe(403);
    }
  });

  it("Unauthenticated request returns 401 on orders API", async () => {
    await seedBaseline();
    const { GET } = await import("@/app/api/orders/route");
    const res = await GET(new Request("http://localhost/api/orders"));
    expect(res.status).toBe(401);
  });
});

/* =========================================================================
 * 2. Payload inspection — zero margin leakage
 * =========================================================================*/

describe("Phase 6 — Payload inspection (zero margin leakage)", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("trueRtoCost absent from JSON under SALES_BDC", async () => {
    const { order } = await seedOrderWithPricing();
    const token = makeToken(["SALES_BDC"], [
      "clients.view", "clients.manage", "orders.view", "orders.manage",
      "documents.view", "reports.view", "commissions.view",
    ]);
    const res = await GETOrders(token);
    expect(res.status).toBe(200);
    const body = await json(res);
    for (const o of body.orders) {
      expect(o.trueRtoCost).toBeUndefined();
      expect(o.snapTrueRtoCost).toBeUndefined();
      expect(o.supplierCostSnapshot).toBeUndefined();
    }
  });

  it("trueRtoCost absent from JSON under EXTERNAL_BROKER", async () => {
    const { order } = await seedOrderWithPricing();
    const token = makeToken(["EXTERNAL_BROKER"], [
      "clients.view", "clients.manage", "orders.view", "documents.view", "reports.view",
    ]);
    const res = await GETOrders(token);
    expect(res.status).toBe(200);
    const body = await json(res);
    for (const o of body.orders) {
      expect(o.trueRtoCost).toBeUndefined();
      expect(o.snapTrueRtoCost).toBeUndefined();
      expect(o.supplierCostSnapshot).toBeUndefined();
    }
  });

  it("trueRtoCost present under SUPER_ADMIN", async () => {
    const { order } = await seedOrderWithPricing();
    const res = await GETOrders(makeSuperAdminToken());
    const body = await json(res);
    const found = body.orders.find((o: any) => o.id === order.id);
    expect(found.trueRtoCost).toBe(1500);
    expect(found.snapTrueRtoCost).toBeNull(); // not yet RECEIVED
  });

  it("trueRtoCost present under ACCOUNTS", async () => {
    const { order } = await seedOrderWithPricing();
    const token = makeToken(["ACCOUNTS"], [
      "finance.view", "finance.manage", "qb.retry", "qb.manage",
      "reports.view", "orders.view", "documents.view", "commissions.view",
    ]);
    const res = await GETOrders(token);
    const body = await json(res);
    const found = body.orders.find((o: any) => o.id === order.id);
    expect(found.trueRtoCost).toBe(1500);
  });

  it("applyFinancialVisibility removes true_rto_cost from SALES_BDC", async () => {
    const auth: any = {
      userId: "bdc-1",
      email: "bdc@test.com",
      name: "BDC User",
      role: "SALES_BDC",
      roleNames: ["SALES_BDC"],
      channelType: "IN_HOUSE_B2C",
      permissions: [],
    };
    const item: any = {
      trueRtoCost: 1500,
      snapTrueRtoCost: 1500,
      supplierCostSnapshot: 1500,
      approvedInternalCost: 3000,
      sellingPrice: 5000,
      b2cRetailPrice: 5000,
    };
    const sanitized = applyFinancialVisibility(auth, item);
    expect(sanitized.trueRtoCost).toBeUndefined();
    expect(sanitized.snapTrueRtoCost).toBeUndefined();
    expect(sanitized.supplierCostSnapshot).toBeUndefined();
    expect(sanitized.approvedInternalCost).toBe(3000);
  });

  it("applyFinancialVisibility removes ALL cost layers except B2B wholesale from EXTERNAL_BROKER", async () => {
    const auth: any = {
      userId: "broker-1",
      email: "broker@test.com",
      name: "Broker User",
      role: "EXTERNAL_BROKER",
      roleNames: ["EXTERNAL_BROKER"],
      channelType: null,
      permissions: [],
    };
    const item: any = {
      trueRtoCost: 1500,
      approvedInternalCost: 3000,
      b2bWholesalePrice: 4000,
      b2cRetailPrice: 5000,
      sellingPrice: 5000,
    };
    const sanitized = applyFinancialVisibility(auth, item);
    expect(sanitized.trueRtoCost).toBeUndefined();
    expect(sanitized.approvedInternalCost).toBeUndefined();
    // EXTERNAL_BROKER sees assigned B2B wholesale tier
    expect(sanitized.b2bWholesalePrice).toBe(4000);
    expect(sanitized.b2cRetailPrice).toBeUndefined();
    expect(sanitized.sellingPrice).toBeUndefined();
  });
});

/* =========================================================================
 * 3. B2B candidate isolation
 * =========================================================================*/

describe("Phase 6 — B2B candidate isolation", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("CANDIDATE with EXTERNAL_BROKER channelType sees no pricing/invoice", async () => {
    const auth: any = {
      userId: "cand-1",
      email: "cand@test.com",
      name: "Candidate",
      role: "CANDIDATE",
      roleNames: ["CANDIDATE"],
      channelType: "EXTERNAL_BROKER",
      permissions: ["clients.view", "documents.view", "orders.view"],
    };
    const result = applyFinancialVisibility(auth, {
      trueRtoCost: 1500,
      sellingPrice: 5000,
      invoices: [{ invoiceNumber: "INV-1", total: 5000 }],
    });
    expect(result.trueRtoCost).toBeUndefined();
    expect(result.sellingPrice).toBeUndefined();
    expect(result.invoices).toBeUndefined();
  });

  it("CANDIDATE with IN_HOUSE_B2C channelType sees own invoice", async () => {
    const auth: any = {
      userId: "cand-1",
      email: "cand@test.com",
      name: "Candidate",
      role: "CANDIDATE",
      roleNames: ["CANDIDATE"],
      channelType: "IN_HOUSE_B2C",
      permissions: ["clients.view", "documents.view", "orders.view"],
    };
    const result = applyFinancialVisibility(auth, {
      trueRtoCost: 1500,
      sellingPrice: 5000,
      invoices: [{ invoiceNumber: "INV-1", total: 5000 }],
    });
    expect(result.trueRtoCost).toBeUndefined();
    expect(result.invoices).toBeDefined();
  });

  it("EXTERNAL_BROKER order gets EXTERNAL_B2B channelType", async () => {
    const { clientId, qId, rId, aId } = await seedBaseline();
    const token = makeToken(["EXTERNAL_BROKER"], [
      "clients.view", "clients.manage", "orders.view", "orders.manage",
      "documents.view", "reports.view",
    ]);
    const res = await createOrder(
      authedRequest("POST", "/api/orders", {
        clientId: String(clientId),
        qualificationId: String(qId),
        salesAgentId: String(new ObjectId()),
        sourceAgentId: String(aId),
        rtoId: String(rId),
        sellingPrice: 5000,
      }, token),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.channelType).toBe("EXTERNAL_B2B");
  });
});

/* =========================================================================
 * 4. 100-Point ID gate
 * =========================================================================*/

describe("Phase 6 — 100-Point ID gate", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("RECEIVED transition blocked when id_points_verified < 100", async () => {
    const clientId = await seedClient(undefined, "Test Client", "client@test.com", {
      id_points_verified: 70,
    });
    const qId = await seedQualification();
    const rId = await seedRto();
    const aId = await seedAgent();
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

    const res = await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "RECEIVED" }),
      { params: { id: order.id } },
    );
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error.code).toBe("ID_POINTS_NOT_VERIFIED");
  });

  it("RECEIVED transition allowed when id_points_verified >= 100", async () => {
    const clientId = await seedClient(undefined, "Test Client", "client@test.com", {
      id_points_verified: 100,
    });
    const qId = await seedQualification();
    const rId = await seedRto();
    const aId = await seedAgent();
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

    const res = await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "RECEIVED" }),
      { params: { id: order.id } },
    );
    expect(res.status).toBe(200);
  });

  it("id_points_verified defaults below 100 for new client", async () => {
    const clientId = await seedClient();
    const db = await getDb();
    const client = await db.collection("clients").findOne({ _id: new ObjectId(clientId) });
    const idPoints = client?.id_points_verified ?? 0;
    expect(idPoints).toBeLessThan(100);
  });
});

/* =========================================================================
 * 5. Immutable snapshot verification
 * =========================================================================*/

describe("Phase 6 — Immutable snapshot verification", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("snapshots locked on RECEIVED are not altered by master price edits", async () => {
    const { order } = await seedOrderWithPricing();

    const statusRes = await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "RECEIVED" }),
      { params: { id: order.id } },
    );
    expect(statusRes.status).toBe(200);

    const orderRes = await GETOrders(makeSuperAdminToken());
    const body = await json(orderRes);
    const received = body.orders.find((o: any) => o.id === order.id);
    expect(received.snapTrueRtoCost).toBe(1500);
    expect(received.snapApprovedInternalCost).toBe(3000);
    expect(received.snapSalePrice).toBe(5000);
    expect(received.snapTotalBilled).toBe(5000);

    const db = await getDb();
    await db.collection("supplier-routes").updateOne(
      { qualificationId: new ObjectId(order.qualificationId) },
      { $set: { wholesaleCost: 9999 } },
    );

    const orderRes2 = await GETOrders(makeSuperAdminToken());
    const body2 = await json(orderRes2);
    const received2 = body2.orders.find((o: any) => o.id === order.id);
    expect(received2.snapTrueRtoCost).toBe(1500);
    expect(received2.snapApprovedInternalCost).toBe(3000);
    expect(received2.snapSalePrice).toBe(5000);
    expect(received2.snapTotalBilled).toBe(5000);
  });

  it("snapshots not present before RECEIVED status", async () => {
    const { order } = await seedOrderWithPricing();
    const orderRes = await GETOrders(makeSuperAdminToken());
    const body = await json(orderRes);
    const draft = body.orders.find((o: any) => o.id === order.id);
    expect(draft.snapTrueRtoCost).toBeNull();
    expect(draft.snapSalePrice).toBeNull();
  });

  it("IN_PROGRESS preserves RECEIVED snapshots", async () => {
    const { order } = await seedOrderWithPricing();

    await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "RECEIVED" }),
      { params: { id: order.id } },
    );
    await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "IN_PROGRESS" }),
      { params: { id: order.id } },
    );

    const orderRes = await GETOrders(makeSuperAdminToken());
    const body = await json(orderRes);
    const inProgress = body.orders.find((o: any) => o.id === order.id);
    expect(inProgress.status).toBe("IN_PROGRESS");
    expect(inProgress.snapTrueRtoCost).toBe(1500);
    expect(inProgress.snapSalePrice).toBe(5000);
  });

  it("DELIVERED preserves RECEIVED snapshots", async () => {
    const { order } = await seedOrderWithPricing();

    await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "RECEIVED" }),
      { params: { id: order.id } },
    );
    await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "IN_PROGRESS" }),
      { params: { id: order.id } },
    );
    await setStatus(
      authedRequest("PATCH", `/api/orders/${order.id}/status`, { status: "DELIVERED" }),
      { params: { id: order.id } },
    );

    const orderRes = await GETOrders(makeSuperAdminToken());
    const body = await json(orderRes);
    const delivered = body.orders.find((o: any) => o.id === order.id);
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.snapTrueRtoCost).toBe(1500);
    expect(delivered.snapSalePrice).toBe(5000);
  });
});
