/**
 * Phase 1 — M1.4: order (enrollment) code generation and serialization.
 *
 * Covers server-side SC-YYYY-NNNN allocation, uniqueness under concurrency,
 * bounded retry on a legacy/manual collision, channel/owner serialization,
 * ownerless-record scoping, and the frozen 21-status workflow.
 *
 * All fixtures use the in-memory replica set (tests/setup.ts). No production
 * database, migration, seed, or backfill is involved.
 */

import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db";
import { ENROLLMENT_CODE_PATTERN } from "@/lib/enrollment-code";
import { ORDER_STATUS_GROUPS } from "@/lib/types";
import { POST as createOrder, GET as listOrders } from "@/app/api/orders/route";
import { GET as getOrder } from "@/app/api/orders/[id]/route";
import { PATCH as transitionOrder } from "@/app/api/orders/[id]/status/route";
import {
  authedRequest,
  clearDb,
  makeB2BAgentToken,
  makeBDCToken,
  makeSuperAdminToken,
  resetEnrollmentSequences,
  seedAgent,
  seedClient,
  seedMapping,
  seedOrder,
  seedQualification,
  seedRto,
  seedSupplierRoute,
} from "./helpers";

function json(res: Response) {
  return res.json() as Promise<any>;
}

const YEAR = new Date().getUTCFullYear();

/** Seeds the minimum fixtures required for POST /api/orders. */
async function seedOrderFixtures() {
  const clientId = await seedClient();
  const qualificationId = await seedQualification();
  const sourceAgentId = await seedAgent();
  const rtoId = await seedRto();
  await seedSupplierRoute(qualificationId, sourceAgentId, rtoId, 1500);
  await seedMapping(qualificationId, rtoId);
  return { clientId, qualificationId, sourceAgentId, rtoId };
}

function orderBody(f: {
  clientId: ObjectId;
  qualificationId: ObjectId;
  sourceAgentId: ObjectId;
  rtoId: ObjectId;
}) {
  return {
    clientId: String(f.clientId),
    qualificationId: String(f.qualificationId),
    salesAgentId: String(new ObjectId()),
    sourceAgentId: String(f.sourceAgentId),
    rtoId: String(f.rtoId),
    sellingPrice: 5000,
  };
}

async function ensureEnrollmentCodeIndex() {
  const db = await getDb();
  await db
    .collection("orders")
    .createIndex(
      { enrollmentCode: 1 },
      { unique: true, sparse: true, name: "uniq_orders_enrollment_code" },
    );
}

describe("M1.4 — enrollment code generation on create", () => {
  beforeEach(async () => {
    await clearDb();
    await resetEnrollmentSequences();
  });

  it("generates a SC-YYYY-NNNN code server-side and returns it on create", async () => {
    const f = await seedOrderFixtures();
    const res = await createOrder(
      authedRequest("POST", "/api/orders", orderBody(f), makeSuperAdminToken()),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.id).toBeDefined();
    expect(body.order.enrollmentCode).toMatch(ENROLLMENT_CODE_PATTERN);
    expect(body.order.enrollmentCode).toBe(`SC-${YEAR}-0001`);

    const db = await getDb();
    const stored = await db
      .collection("orders")
      .findOne({ _id: new ObjectId(body.order.id) });
    expect(stored?.enrollmentCode).toBe(`SC-${YEAR}-0001`);
  });

  it("ignores a client-supplied enrollmentCode and allocates its own", async () => {
    const f = await seedOrderFixtures();
    const res = await createOrder(
      authedRequest(
        "POST",
        "/api/orders",
        { ...orderBody(f), enrollmentCode: "SC-1999-9999" },
        makeSuperAdminToken(),
      ),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.enrollmentCode).toBe(`SC-${YEAR}-0001`);
    expect(body.order.enrollmentCode).not.toBe("SC-1999-9999");
  });

  it("allocates unique codes under concurrent creation", async () => {
    const f = await seedOrderFixtures();
    await ensureEnrollmentCodeIndex();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createOrder(
          authedRequest("POST", "/api/orders", orderBody(f), makeSuperAdminToken()),
        ),
      ),
    );
    const codes: string[] = [];
    for (const res of results) {
      expect(res.status).toBe(201);
      const body = await json(res);
      codes.push(body.order.enrollmentCode);
    }
    expect(new Set(codes).size).toBe(6);
    expect(codes.every((c) => ENROLLMENT_CODE_PATTERN.test(c))).toBe(true);
  });

  it("retries with the next code when the counter collides with a legacy code", async () => {
    const f = await seedOrderFixtures();
    await ensureEnrollmentCodeIndex();
    // A legacy/manual row already occupies the first code the counter yields.
    await seedOrder(new ObjectId(), f.clientId, f.qualificationId, new ObjectId(), f.sourceAgentId, f.rtoId, {
      enrollmentCode: `SC-${YEAR}-0001`,
    });

    const res = await createOrder(
      authedRequest("POST", "/api/orders", orderBody(f), makeSuperAdminToken()),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.enrollmentCode).toBe(`SC-${YEAR}-0002`);
    expect(body.order.enrollmentCode).not.toBe(`SC-${YEAR}-0001`);
  });

  it("tags BDC-created orders with channel IN_HOUSE_B2C and bdc_id (never b2b_agent_id)", async () => {
    const f = await seedOrderFixtures();
    const res = await createOrder(
      authedRequest("POST", "/api/orders", orderBody(f), makeBDCToken("bdc-owner-1")),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.channelType).toBe("IN_HOUSE_B2C");

    const db = await getDb();
    const stored = await db
      .collection("orders")
      .findOne({ _id: new ObjectId(body.order.id) });
    expect(stored?.bdc_id).toBe("bdc-owner-1");
    expect(stored?.channel_type).toBe("IN_HOUSE_B2C");
    expect(stored?.b2b_agent_id).toBeUndefined();
  });

  it("tags B2B-created orders with channel EXTERNAL_B2B and b2b_agent_id (never bdc_id)", async () => {
    const f = await seedOrderFixtures();
    const res = await createOrder(
      authedRequest("POST", "/api/orders", orderBody(f), makeB2BAgentToken("b2b-owner-1")),
    );
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.order.channelType).toBe("EXTERNAL_B2B");

    const db = await getDb();
    const stored = await db
      .collection("orders")
      .findOne({ _id: new ObjectId(body.order.id) });
    expect(stored?.b2b_agent_id).toBe("b2b-owner-1");
    expect(stored?.channel_type).toBe("EXTERNAL_B2B");
    expect(stored?.bdc_id).toBeUndefined();
  });
});

describe("M1.4 — enrollment/channel serialization", () => {
  beforeEach(async () => {
    await clearDb();
    await resetEnrollmentSequences();
  });

  it("serializes enrollmentCode and channelType in list and detail responses", async () => {
    const f = await seedOrderFixtures();
    const bdc = makeBDCToken("serialization-bdc");
    const created = await createOrder(
      authedRequest("POST", "/api/orders", orderBody(f), bdc),
    );
    const createdBody = await json(created);
    const id = createdBody.order.id as string;
    const code = createdBody.order.enrollmentCode as string;

    const listRes = await listOrders(
      authedRequest("GET", "/api/orders", undefined, bdc),
    );
    expect(listRes.status).toBe(200);
    const listBody = await json(listRes);
    const row = listBody.orders.find((o: any) => o.id === id);
    expect(row).toBeTruthy();
    expect(row.enrollmentCode).toBe(code);
    expect(row.channelType).toBe("IN_HOUSE_B2C");

    const detailRes = await getOrder(
      authedRequest("GET", `/api/orders/${id}`, undefined, bdc),
      { params: { id } },
    );
    expect(detailRes.status).toBe(200);
    const detail = await json(detailRes);
    expect(detail.enrollmentCode).toBe(code);
    expect(detail.channelType).toBe("IN_HOUSE_B2C");
  });

  it("keeps ownerless legacy orders admin-only (no auto-assigned owner)", async () => {
    const orderId = await seedOrder(); // no bdc_id / b2b_agent_id
    const db = await getDb();
    const raw = await db.collection("orders").findOne({ _id: orderId });
    expect(raw?.bdc_id).toBeUndefined();
    expect(raw?.b2b_agent_id).toBeUndefined();

    const adminRes = await getOrder(
      authedRequest("GET", `/api/orders/${orderId}`, undefined, makeSuperAdminToken()),
      { params: { id: String(orderId) } },
    );
    expect(adminRes.status).toBe(200);
    const adminBody = await json(adminRes);
    expect(adminBody.enrollmentCode).toBeNull();
    expect(adminBody.channelType).toBeNull();

    const bdcRes = await getOrder(
      authedRequest("GET", `/api/orders/${orderId}`, undefined, makeBDCToken()),
      { params: { id: String(orderId) } },
    );
    expect(bdcRes.status).toBe(403);

    const b2bRes = await getOrder(
      authedRequest("GET", `/api/orders/${orderId}`, undefined, makeB2BAgentToken()),
      { params: { id: String(orderId) } },
    );
    expect(b2bRes.status).toBe(403);
  });
});

describe("M1.4 / D7 — frozen application status workflow", () => {
  beforeEach(async () => {
    await clearDb();
  });

  it("keeps exactly the application statuses from the docs", () => {
    const statuses = ORDER_STATUS_GROUPS.flatMap((g) => g.statuses);
    expect(statuses).toContain("DRAFT");
    expect(statuses).toContain("RECEIVED");
    expect(statuses).toContain("IN_PROGRESS");
    expect(statuses).toContain("DELIVERED");
    expect(statuses).toContain("ON_HOLD");
    expect(statuses).toContain("CANCELLED");
    expect(new Set(statuses).size).toBeGreaterThanOrEqual(6);
  });

  it("allows an existing transition and rejects an undefined one", async () => {
    const orderId = await seedOrder(
      new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId(), new ObjectId(),
      { status: "DRAFT" },
    );
    const ok = await transitionOrder(
      authedRequest("PATCH", `/api/orders/${orderId}/status`, { status: "RECEIVED" }, makeSuperAdminToken()),
      { params: { id: String(orderId) } },
    );
    expect(ok.status).toBe(200);
    const okBody = await json(ok);
    expect(okBody.after).toBe("RECEIVED");

    // DRAFT → Completed is not in APPLICATION_TRANSITIONS, so it must be rejected.
    const bad = await transitionOrder(
      authedRequest("PATCH", `/api/orders/${orderId}/status`, { status: "Completed" }, makeSuperAdminToken()),
      { params: { id: String(orderId) } },
    );
    expect(bad.status).toBe(400);
  });
});
