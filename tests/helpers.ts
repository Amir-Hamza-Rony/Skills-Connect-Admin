import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { ObjectId } from "mongodb";

export function makeToken(roleNames: string[] = ["Super Admin"], permissions: string[] = []) {
  return signAccessToken({
    userId: "test-user-1",
    name: "Test User",
    email: "test@example.com",
    roleNames,
    permissions,
  });
}

export function authedRequest(method: string, url: string, body?: unknown, token = makeToken()) {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function clearDb() {
  const db = await getDb();
  await db.dropDatabase();
}

export async function seedClient(id = new ObjectId()) {
  const db = await getDb();
  await db.collection("clients").insertOne({
    _id: id,
    email: "client@test.com",
    name: "Test Client",
    contacts: [],
    addresses: [],
    status: "active",
    sourceAgentId: null,
    notes: "",
    createdAt: new Date(),
  });
  return id;
}

export async function seedSupplierRoute(
  qualificationId: ObjectId,
  sourceAgentId: ObjectId,
  rtoId: ObjectId,
  wholesaleCost = 1500,
  id = new ObjectId(),
) {
  const db = await getDb();
    await db.collection("supplier-routes").insertOne({
      _id: id,
      qualificationId,
      sourceAgentId,
      rtoId,
      wholesaleCost,
      currency: "AUD",
      effectiveFrom: new Date("2026-01-01"),
      effectiveTo: null,
      status: "active",
    });
    return id;
}

export async function seedTask(id = new ObjectId(), orderId = new ObjectId()) {
  const db = await getDb();
  const now = new Date();
  await db.collection("workflow-tasks").insertOne({
    _id: id,
    orderId,
    stage: "Enrolment",
    title: "Collect ID",
    status: "Todo",
    assigneeId: null,
    dueDate: null,
    priority: "Medium",
    createdAt: now,
    updatedAt: now,
  });
  return { id, orderId };
}

export async function seedOrder(
  id = new ObjectId(),
  clientId = new ObjectId(),
  qualificationId = new ObjectId(),
  salesAgentId = new ObjectId(),
  sourceAgentId = new ObjectId(),
  rtoId = new ObjectId(),
) {
  const db = await getDb();
  const now = new Date();
  await db.collection("orders").insertOne({
    _id: id,
    clientId,
    qualificationId,
    salesAgentId,
    sourceAgentId,
    rtoId,
    status: "New",
    evidenceStatus: "Not Started",
    rtoSubmissionStatus: "Not Ready",
    certificateStatus: "Not Issued",
    sellingPrice: 5000,
    supplierCostSnapshot: 0,
    otherCost: 0,
    currency: "AUD",
    completedAt: null,
    history: [{ timestamp: now, field: "status", before: "—", after: "New" }],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function seedInvoice(id = new ObjectId(), orderId = new ObjectId(), total = 1000) {
  const db = await getDb();
  await db.collection("invoices").insertOne({
    _id: id,
    orderId,
    invoiceNumber: "INV-TEST",
    total,
    dueDate: new Date(),
    status: "Draft",
    createdAt: new Date(),
  });
  return id;
}

export async function seedPlan(id = new ObjectId(), orderId = new ObjectId(), total = 1000) {
  const db = await getDb();
  const now = new Date();
  await db.collection("payment-plans").insertOne({
    _id: id,
    orderId,
    total,
    instalments: [],
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function findAuditAction(entityType: string, action: string) {
  const db = await getDb();
  return db.collection("audit_logs").findOne({ entityType, action });
}
