import { NextRequest } from "next/server";
import { signAccessToken } from "@/lib/api-auth";
import { getDb } from "@/lib/db";
import { ObjectId } from "mongodb";

export function makeToken(roleNames: string[] = ["SUPER_ADMIN"], permissions: string[] = []) {
  return signAccessToken({
    userId: "test-user-1",
    name: "Test User",
    email: "test@example.com",
    full_name: "Test User",
    role: roleNames[0] as any,
    roleNames,
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
    permissions,
  });
}

export function makeSuperAdminToken() {
  return makeToken(["SUPER_ADMIN"], [
    "users.manage", "roles.manage", "clients.view", "clients.manage",
    "orders.view", "orders.manage", "rto.manage", "agents.manage",
    "qualifications.manage", "pricing.manage",
    "documents.view", "documents.review",
    "finance.view", "finance.manage", "qb.retry", "qb.manage",
    "reports.view", "audit.view", "settings.manage",
    "commissions.manage", "commissions.view", "finance.reconcile",
    "rplPartners.manage", "rplPartners.view",
  ]);
}

export function makeAdminToken() {
  return makeToken(["ADMIN"], [
    "users.manage", "roles.manage", "clients.view", "clients.manage",
    "orders.view", "orders.manage", "rto.manage", "agents.manage",
    "qualifications.manage", "pricing.manage",
    "documents.view", "documents.review",
    "finance.view", "finance.manage", "qb.retry", "qb.manage",
    "reports.view", "audit.view", "settings.manage",
    "commissions.manage", "commissions.view", "finance.reconcile",
    "rplPartners.manage", "rplPartners.view",
  ]);
}

export function makeBDCToken(userId = "test-bdc-1") {
  return signAccessToken({
    userId,
    name: "BDC User",
    email: "bdc@test.com",
    full_name: "BDC User",
    role: "BDC",
    roleNames: ["BDC"],
    agency_name: null,
    b2b_tier: "SILVER",
    default_commission_pct: 0,
    permissions: ["clients.view", "clients.manage", "orders.view", "orders.manage", "documents.view", "reports.view"],
  });
}

export function makeB2BAgentToken(userId = "test-b2b-1") {
  return signAccessToken({
    userId,
    name: "B2B Agent",
    email: "b2b@test.com",
    full_name: "B2B Agent",
    role: "B2B_AGENT",
    roleNames: ["B2B_AGENT"],
    agency_name: "Test Agency",
    b2b_tier: "SILVER",
    default_commission_pct: 0,
    permissions: ["clients.view", "clients.manage", "orders.view", "orders.manage", "documents.view", "reports.view"],
  });
}

export function authedRequest(method: string, url: string, body?: unknown, token = makeSuperAdminToken()) {
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
  const collections = await db.listCollections().toArray();
  for (const coll of collections) {
    await db.collection(coll.name).drop();
  }
}

export async function seedClient(
  id = new ObjectId(),
  legalName = "Test Client",
  email = "client@test.com",
  overrides: Record<string, unknown> = {},
) {
  const db = await getDb();
  await db.collection("clients").insertOne({
    _id: id,
    email: email.toLowerCase(),
    legalName,
    preferredName: "",
    contacts: [],
    addresses: [],
    status: "active",
    sourceAgentId: null,
    notes: "",
    createdAt: new Date(),
    ...overrides,
  });
  return id;
}

export async function seedMapping(
  qualificationId: ObjectId,
  rtoId: ObjectId,
  status = "active",
  id = new ObjectId(),
) {
  const db = await getDb();
  await db.collection("qualification-rto-mappings").insertOne({
    _id: id,
    qualificationId,
    rtoId,
    status,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
  overrides: Record<string, unknown> = {},
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
    ...overrides,
  });
  return id;
}

/** Test-only reset for the enrollment-code counter collection. */
export async function resetEnrollmentSequences() {
  const db = await getDb();
  await db.collection("enrollment_sequences").deleteMany({});
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

export async function seedQualification(id = new ObjectId(), code = "AUR32120") {
  const db = await getDb();
  await db.collection("qualifications").insertOne({
    _id: id,
    code,
    title: "Certificate III",
    trainingPackage: "AUR",
    industry: "Automotive",
    status: "current",
    licensingRefs: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export async function seedRto(id = new ObjectId(), code = "R001") {
  const db = await getDb();
  await db.collection("rtos").insertOne({
    _id: id,
    legalName: "Demo College Pty Ltd",
    tradingName: "Demo College",
    rtoCode: code,
    contacts: [],
    status: "active",
    complianceNote: "",
    website: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export async function seedAgent(type = "sales_closing", id = new ObjectId()) {
  const db = await getDb();
  await db.collection("agents").insertOne({
    _id: id,
    name: "Test Agent",
    type,
    contact: "agent@test.com",
    commissionRule: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export async function seedPriceCategory(id = new ObjectId(), code = "STANDARD") {
  const db = await getDb();
  await db.collection("price_categories").insertOne({
    _id: id,
    code,
    name: "Standard Price",
    description: null,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export async function seedPriceList(
  id = new ObjectId(),
  qualificationId = new ObjectId(),
  priceCategoryId = new ObjectId(),
  amount = 5000,
  currency = "AUD",
) {
  const db = await getDb();
  const now = new Date();
  await db.collection("price_lists").insertOne({
    _id: id,
    qualificationId,
    priceCategoryId,
    amount,
    currency,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function seedCommissionRule(
  id = new ObjectId(),
  agentId = new ObjectId(),
  currency = "AUD",
) {
  const db = await getDb();
  const now = new Date();
  await db.collection("agent_commission_rules").insertOne({
    _id: id,
    agentId,
    responsibility: null,
    effectiveFrom: new Date("2026-01-01"),
    effectiveTo: null,
    tiers: [{ minDeals: 1, maxDeals: null, commissionPerDeal: 4000 }],
    eligibleOrderStatuses: ["Completed"],
    commissionCurrency: currency,
    additionalIncentiveAmount: null,
    additionalIncentiveCurrency: null,
    status: "active",
    approvalStatus: "approved",
    approvedBy: "test-user-1",
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function seedUser(
  id = new ObjectId(),
  overrides: Record<string, unknown> = {},
) {
  const db = await getDb();
  await db.collection("users").insertOne({
    _id: id,
    email: (overrides.email ?? `user${id.toString().slice(-6)}@test.com`).toLowerCase(),
    name: overrides.name ?? "Test User",
    full_name: overrides.full_name ?? "Test User",
    phone: overrides.phone ?? "",
    passwordHash: overrides.passwordHash ?? "dummy-hash",
    role: overrides.role ?? "BDC",
    roleNames: overrides.roleNames ?? [overrides.role ?? "BDC"],
    agency_name: overrides.agency_name ?? null,
    b2b_tier: overrides.b2b_tier ?? "SILVER",
    default_commission_pct: overrides.default_commission_pct ?? 0,
    active: overrides.active ?? true,
    is_active: overrides.active ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
    failedLoginCount: 0,
  });
  return id;
}

