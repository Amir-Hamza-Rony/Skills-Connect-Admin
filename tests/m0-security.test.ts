/**
 * Phase 1 — M0 security preconditions.
 *
 * Regression coverage for order/client/document ownership hardening:
 *  - user-space vs agent-space identifiers are never conflated
 *  - legacy ownerless records fail closed for BDC / B2B_AGENT
 *  - every mutation is authorized server-side before side effects
 *
 * All fixtures are seeded into the in-memory test database (tests/setup.ts).
 */

import { NextRequest } from "next/server";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it } from "vitest";
import { signAccessToken } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import {
  clearDb,
  makeAdminToken,
  makeB2BAgentToken,
  makeBDCToken,
  makeSuperAdminToken,
} from "./helpers";

const BDC_1 = "m0-bdc-1";
const BDC_2 = "m0-bdc-2";
const B2B_1 = "m0-b2b-1";
const B2B_2 = "m0-b2b-2";

async function seedStudent(overrides: Record<string, unknown> = {}) {
  const db = await getDb();
  const _id = new ObjectId();
  await db.collection("clients").insertOne({
    _id,
    legalName: "M0 Student",
    preferredName: "",
    email: `m0-${_id.toString()}@test.com`,
    phone: "",
    contacts: [],
    addresses: [],
    status: "active",
    sourceAgentId: null,
    notes: "",
    createdAt: new Date(),
    ...overrides,
  });
  return _id;
}

async function seedEnrollment(overrides: Record<string, unknown> = {}) {
  const db = await getDb();
  const clientId = (overrides.clientId as ObjectId | undefined) ?? (await seedStudent());
  const _id = new ObjectId();
  const order = {
    _id,
    clientId,
    qualificationId: new ObjectId(),
    // salesAgentId/sourceAgentId live in the agents collection (agent-id
    // space). They must never be compared with auth.userId.
    salesAgentId: new ObjectId(),
    sourceAgentId: new ObjectId(),
    rtoId: new ObjectId(),
    status: "New",
    evidenceStatus: "Not Started",
    rtoSubmissionStatus: "Not Ready",
    certificateStatus: "Not Issued",
    sellingPrice: 5000,
    supplierCostSnapshot: 1500,
    otherCost: 0,
    currency: "AUD",
    history: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
  await db.collection("orders").insertOne(order);
  return order;
}

async function seedDocument(
  orderId: ObjectId,
  clientId: ObjectId,
  overrides: Record<string, unknown> = {},
) {
  const db = await getDb();
  const _id = new ObjectId();
  const doc = {
    _id,
    orderId,
    clientId,
    type: "Identification",
    version: 1,
    fileName: "id.pdf",
    contentType: "application/pdf",
    sizeBytes: 4,
    data: Buffer.from("test"),
    status: "Received",
    receivedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
  await db.collection("documents").insertOne(doc);
  return doc;
}

function req(url: string, token: string, method = "GET", body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** BDC/B2B token that also carries documents.review, to test ownership
 * rather than the permission middleware. */
function reviewerToken(role: "BDC" | "B2B_AGENT", userId: string) {
  return signAccessToken({
    userId,
    name: "Reviewer",
    email: `${role.toLowerCase()}@review.test`,
    full_name: "Reviewer",
    role,
    roleNames: [role],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
    permissions: [
      "clients.view", "orders.view", "orders.manage",
      "documents.view", "documents.review",
    ],
  });
}

function uploadRequest(orderId: string, clientId: string, token: string, file?: File) {
  const formData = new FormData();
  formData.append("orderId", orderId);
  formData.append("clientId", clientId);
  formData.append("type", "Identification");
  formData.append("file", file ?? new File(["test"], "id.pdf", { type: "application/pdf" }));
  return new NextRequest("http://localhost/api/documents/upload", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
}

beforeEach(async () => {
  await clearDb();
});

describe("M0 — order ownership hardening", () => {
  it("BDC can access its own order; supplier cost stays masked", async () => {
    const order = await seedEnrollment({ bdc_id: BDC_1, channel_type: "B2C_BDC" });
    const { GET } = await import("@/app/api/orders/[id]/route");
    const res = await GET(
      req(`/api/orders/${order._id}`, makeBDCToken(BDC_1)),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(String(order._id));
    expect(body.supplierCostSnapshot).toBeUndefined();
    expect(body.sellingPrice).toBe(5000);
  });

  it("BDC cannot access another BDC's order (403)", async () => {
    const order = await seedEnrollment({ bdc_id: BDC_2, channel_type: "B2C_BDC" });
    const { GET } = await import("@/app/api/orders/[id]/route");
    const res = await GET(
      req(`/api/orders/${order._id}`, makeBDCToken(BDC_1)),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(403);
  });

  it("B2B_AGENT can access its own agency's order", async () => {
    const order = await seedEnrollment({ b2b_agent_id: B2B_1, channel_type: "B2B_AGENT" });
    const { GET } = await import("@/app/api/orders/[id]/route");
    const res = await GET(
      req(`/api/orders/${order._id}`, makeB2BAgentToken(B2B_1)),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(200);
  });

  it("B2B_AGENT cannot access another agency's order (403)", async () => {
    const order = await seedEnrollment({ b2b_agent_id: B2B_2, channel_type: "B2B_AGENT" });
    const { GET } = await import("@/app/api/orders/[id]/route");
    const res = await GET(
      req(`/api/orders/${order._id}`, makeB2BAgentToken(B2B_1)),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(403);
  });

  it("ownerless legacy orders fail closed for BDC/B2B but stay admin-only accessible", async () => {
    // salesAgentId/sourceAgentId deliberately set to user-id strings: proves
    // the removed fallback no longer grants access to ownerless records.
    const order = await seedEnrollment({
      salesAgentId: BDC_1,
      sourceAgentId: B2B_1,
    });
    const { GET } = await import("@/app/api/orders/[id]/route");
    const params = { params: { id: String(order._id) } };

    const bdc = await GET(req(`/api/orders/${order._id}`, makeBDCToken(BDC_1)), params);
    expect(bdc.status).toBe(403);
    const b2b = await GET(req(`/api/orders/${order._id}`, makeB2BAgentToken(B2B_1)), params);
    expect(b2b.status).toBe(403);

    const admin = await GET(req(`/api/orders/${order._id}`, makeAdminToken()), params);
    expect(admin.status).toBe(200);
    const adminBody = await admin.json();
    expect(adminBody.supplierCostSnapshot).toBe(1500);

    const superAdmin = await GET(req(`/api/orders/${order._id}`, makeSuperAdminToken()), params);
    expect(superAdmin.status).toBe(200);
  });

  it("unauthorized PATCH returns 403 without mutating data or writing audit", async () => {
    const order = await seedEnrollment({
      bdc_id: BDC_2,
      channel_type: "B2C_BDC",
      notes: "original",
    });
    const { PATCH } = await import("@/app/api/orders/[id]/route");
    const res = await PATCH(
      req(
        `/api/orders/${order._id}`,
        makeBDCToken(BDC_1),
        "PATCH",
        { notes: "hacked", bdc_id: BDC_1, b2b_agent_id: B2B_1 },
      ),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(403);

    const db = await getDb();
    const after = await db.collection("orders").findOne({ _id: order._id });
    expect(after.notes).toBe("original");
    expect(after.bdc_id).toBe(BDC_2);
    expect(after.b2b_agent_id).toBeUndefined();
    const audits = await db.collection("audit_logs")
      .find({ entityType: "order", action: "update" }).toArray();
    expect(audits).toHaveLength(0);
  });

  it("B2B_AGENT cannot PATCH another agency's order (403)", async () => {
    const order = await seedEnrollment({ b2b_agent_id: B2B_2, channel_type: "B2B_AGENT" });
    const { PATCH } = await import("@/app/api/orders/[id]/route");
    const res = await PATCH(
      req(`/api/orders/${order._id}`, makeB2BAgentToken(B2B_1), "PATCH", { notes: "hacked" }),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(403);
  });

  it("authorized PATCH succeeds, ignores body owner/cost fields, masks cost and audits", async () => {
    const order = await seedEnrollment({ bdc_id: BDC_1, channel_type: "B2C_BDC" });
    const { PATCH } = await import("@/app/api/orders/[id]/route");
    const res = await PATCH(
      req(
        `/api/orders/${order._id}`,
        makeBDCToken(BDC_1),
        "PATCH",
        {
          notes: "updated",
          bdc_id: BDC_2,
          b2b_agent_id: B2B_2,
          supplierCostSnapshot: 1,
        },
      ),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.notes).toBe("updated");
    expect(body.order.supplierCostSnapshot).toBeUndefined();

    const db = await getDb();
    const after = await db.collection("orders").findOne({ _id: order._id });
    expect(after.bdc_id).toBe(BDC_1);
    expect(after.b2b_agent_id).toBeUndefined();
    expect(after.supplierCostSnapshot).toBe(1500);
    const audit = await db.collection("audit_logs")
      .findOne({ entityType: "order", action: "update", entityId: String(order._id) });
    expect(audit).not.toBeNull();
  });

  it("ADMIN can PATCH any order and retains financial visibility", async () => {
    const order = await seedEnrollment({ bdc_id: BDC_2, channel_type: "B2C_BDC" });
    const { PATCH } = await import("@/app/api/orders/[id]/route");
    const res = await PATCH(
      req(`/api/orders/${order._id}`, makeAdminToken(), "PATCH", { notes: "admin edit" }),
      { params: { id: String(order._id) } },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.supplierCostSnapshot).toBe(1500);
  });
});

describe("M0 — client ownership (ID-space fix)", () => {
  it("client access is derived from owned orders, never from client.sourceAgentId", async () => {
    const ownClient = await seedStudent();
    const otherClient = await seedStudent();
    // sourceAgentId equals a user id, but no owned order links this client.
    const ownerlessClient = await seedStudent({ sourceAgentId: BDC_1 });

    await seedEnrollment({ clientId: ownClient, bdc_id: BDC_1, channel_type: "B2C_BDC" });
    await seedEnrollment({ clientId: otherClient, bdc_id: BDC_2, channel_type: "B2C_BDC" });

    const token = makeBDCToken(BDC_1);
    const { GET: getClient } = await import("@/app/api/clients/[id]/route");

    const own = await getClient(req(`/api/clients/${ownClient}`, token), { params: { id: String(ownClient) } });
    expect(own.status).toBe(200);

    const other = await getClient(req(`/api/clients/${otherClient}`, token), { params: { id: String(otherClient) } });
    expect(other.status).toBe(403);

    const ownerless = await getClient(req(`/api/clients/${ownerlessClient}`, token), { params: { id: String(ownerlessClient) } });
    expect(ownerless.status).toBe(403);
  });

  it("client list is scoped to clients of owned orders only", async () => {
    const ownClient = await seedStudent();
    const otherClient = await seedStudent();
    const ownerlessClient = await seedStudent({ sourceAgentId: BDC_1 });
    await seedEnrollment({ clientId: ownClient, bdc_id: BDC_1 });
    await seedEnrollment({ clientId: otherClient, bdc_id: BDC_2 });

    const { GET: listClients } = await import("@/app/api/clients/route");
    const res = await listClients(req("/api/clients", makeBDCToken(BDC_1)));
    expect(res.status).toBe(200);
    const ids = (await res.json()).clients.map((c: any) => c.id);
    expect(ids).toContain(String(ownClient));
    expect(ids).not.toContain(String(otherClient));
    expect(ids).not.toContain(String(ownerlessClient));
  });

  it("client PATCH rejects cross-account access", async () => {
    const otherClient = await seedStudent();
    await seedEnrollment({ clientId: otherClient, bdc_id: BDC_2 });
    const { PATCH: patchClient } = await import("@/app/api/clients/[id]/route");
    const res = await patchClient(
      req(`/api/clients/${otherClient}`, makeBDCToken(BDC_1), "PATCH", { legalName: "Hacked" }),
      { params: { id: String(otherClient) } },
    );
    expect(res.status).toBe(403);
    const db = await getDb();
    const after = await db.collection("clients").findOne({ _id: otherClient });
    expect(after.legalName).toBe("M0 Student");
  });

  it("B2B_AGENT client scoping derives from its own agency's orders", async () => {
    const ownClient = await seedStudent();
    const otherClient = await seedStudent();
    const ownerlessClient = await seedStudent({ sourceAgentId: B2B_1 });
    await seedEnrollment({ clientId: ownClient, b2b_agent_id: B2B_1, channel_type: "B2B_AGENT" });
    await seedEnrollment({ clientId: otherClient, b2b_agent_id: B2B_2, channel_type: "B2B_AGENT" });

    const token = makeB2BAgentToken(B2B_1);
    const { GET: getClient } = await import("@/app/api/clients/[id]/route");
    expect((await getClient(req(`/api/clients/${ownClient}`, token), { params: { id: String(ownClient) } })).status).toBe(200);
    expect((await getClient(req(`/api/clients/${otherClient}`, token), { params: { id: String(otherClient) } })).status).toBe(403);
    expect((await getClient(req(`/api/clients/${ownerlessClient}`, token), { params: { id: String(ownerlessClient) } })).status).toBe(403);
  });

  it("ADMIN and SUPER_ADMIN retain full client access", async () => {
    const client = await seedStudent();
    const { GET: getClient } = await import("@/app/api/clients/[id]/route");
    const params = { params: { id: String(client) } };
    expect((await getClient(req(`/api/clients/${client}`, makeAdminToken()), params)).status).toBe(200);
    expect((await getClient(req(`/api/clients/${client}`, makeSuperAdminToken()), params)).status).toBe(200);
  });
});

describe("M0 — document ownership", () => {
  it("unauthorized uploads return 403 and store nothing", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client, bdc_id: BDC_2 });
    const { POST } = await import("@/app/api/documents/upload/route");
    const res = await POST(uploadRequest(String(order._id), String(client), makeBDCToken(BDC_1)));
    expect(res.status).toBe(403);

    const db = await getDb();
    expect(await db.collection("documents").countDocuments()).toBe(0);
  });

  it("uploads to ownerless legacy orders return 403 for non-admins", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client, salesAgentId: BDC_1 });
    const { POST } = await import("@/app/api/documents/upload/route");
    const res = await POST(uploadRequest(String(order._id), String(client), makeBDCToken(BDC_1)));
    expect(res.status).toBe(403);
  });

  it("uploads reject a clientId that does not match the order", async () => {
    const client = await seedStudent();
    const otherClient = await seedStudent();
    const order = await seedEnrollment({ clientId: client, bdc_id: BDC_1 });
    const { POST } = await import("@/app/api/documents/upload/route");
    const res = await POST(uploadRequest(String(order._id), String(otherClient), makeBDCToken(BDC_1)));
    expect(res.status).toBe(400);
  });

  it("unauthorized downloads return 403 and write no access log", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client, bdc_id: BDC_2 });
    const doc = await seedDocument(order._id, client);
    const { GET } = await import("@/app/api/documents/[id]/download/route");
    const res = await GET(
      req(`/api/documents/${doc._id}/download`, makeBDCToken(BDC_1)),
      { params: { id: String(doc._id) } },
    );
    expect(res.status).toBe(403);

    const db = await getDb();
    expect(await db.collection("document_access_logs").countDocuments()).toBe(0);
  });

  it("downloads of documents on ownerless orders return 403 for non-admins", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client });
    const doc = await seedDocument(order._id, client);
    const { GET } = await import("@/app/api/documents/[id]/download/route");
    for (const token of [makeBDCToken(BDC_1), makeB2BAgentToken(B2B_1)]) {
      const res = await GET(req(`/api/documents/${doc._id}/download`, token), { params: { id: String(doc._id) } });
      expect(res.status).toBe(403);
    }
  });

  it("unauthorized reviews return 403 and leave document state unchanged", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client, bdc_id: BDC_2 });
    const doc = await seedDocument(order._id, client);
    const { PATCH } = await import("@/app/api/documents/[id]/review/route");
    const res = await PATCH(
      req(`/api/documents/${doc._id}/review`, reviewerToken("BDC", BDC_1), "PATCH", { status: "Approved" }),
      { params: { id: String(doc._id) } },
    );
    expect(res.status).toBe(403);

    const db = await getDb();
    const after = await db.collection("documents").findOne({ _id: doc._id });
    expect(after.status).toBe("Received");
    expect(await db.collection("audit_logs").countDocuments()).toBe(0);
  });

  it("ownerless-order document reviews return 403 for non-admins", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client });
    const doc = await seedDocument(order._id, client);
    const { PATCH } = await import("@/app/api/documents/[id]/review/route");
    const res = await PATCH(
      req(`/api/documents/${doc._id}/review`, reviewerToken("B2B_AGENT", B2B_1), "PATCH", { status: "Approved" }),
      { params: { id: String(doc._id) } },
    );
    expect(res.status).toBe(403);
  });

  it("authorized upload → download → review lifecycle remains operational", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client, bdc_id: BDC_1 });
    const token = makeBDCToken(BDC_1);

    const { POST } = await import("@/app/api/documents/upload/route");
    const uploaded = await POST(uploadRequest(String(order._id), String(client), token));
    expect(uploaded.status).toBe(201);
    const { id } = await uploaded.json();

    const { GET } = await import("@/app/api/documents/[id]/download/route");
    const downloaded = await GET(req(`/api/documents/${id}/download`, token), { params: { id } });
    expect(downloaded.status).toBe(200);
    expect(await downloaded.text()).toBe("test");

    const { PATCH } = await import("@/app/api/documents/[id]/review/route");
    const reviewed = await PATCH(
      req(`/api/documents/${id}/review`, makeAdminToken(), "PATCH", { status: "Approved" }),
      { params: { id } },
    );
    expect(reviewed.status).toBe(200);

    const db = await getDb();
    const after = await db.collection("documents").findOne({ _id: new ObjectId(id) });
    expect(after.status).toBe("Approved");
    const audit = await db.collection("audit_logs").findOne({ entityType: "document", action: "review" });
    expect(audit).not.toBeNull();
  });

  it("SUPER_ADMIN and ADMIN retain document access on ownerless orders", async () => {
    const client = await seedStudent();
    const order = await seedEnrollment({ clientId: client });
    const doc = await seedDocument(order._id, client);

    const { GET: download } = await import("@/app/api/documents/[id]/download/route");
    const { PATCH: review } = await import("@/app/api/documents/[id]/review/route");

    for (const token of [makeAdminToken(), makeSuperAdminToken()]) {
      const res = await download(req(`/api/documents/${doc._id}/download`, token), { params: { id: String(doc._id) } });
      expect(res.status).toBe(200);
      const rev = await review(
        req(`/api/documents/${doc._id}/review`, token, "PATCH", { status: "Approved" }),
        { params: { id: String(doc._id) } },
      );
      expect(rev.status).toBe(200);
    }

    const { POST } = await import("@/app/api/documents/upload/route");
    const uploaded = await POST(uploadRequest(String(order._id), String(client), makeAdminToken()));
    expect(uploaded.status).toBe(201);
  });
});
