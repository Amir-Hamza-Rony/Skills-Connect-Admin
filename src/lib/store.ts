import { apiFetch, uploadFile } from "@/lib/api"
import type {
  Agent,
  EnrolmentKit,
  Order,
  Permission,
  PriceCategory,
  PriceList,
  AdditionalFee,
  Qualification,
  Role,
  RoleName,
  Rto,
  RtoQualificationScope,
  SupplierRoute,
  User,
  UserRef,
  AgentCommissionRule,
  CommissionRecord,
  CommissionPayout,
  RplPartner,
  CertificateDelivery,
} from "@/lib/types"

/**
 * Data-access layer.
 *
 * CUTOVER STATE: everything is on the real API.
 *
 * Users and roles moved in B2; agents, qualifications, RTOs and supplier routes
 * moved in B3. Before that the masters served synthetic in-memory data while
 * the orders snapshotting their wholesale cost were already real — so the
 * pricing matrix on screen was not the matrix an order was priced from. Both
 * looked correct, which is what made it dangerous.
 *
 * Every function keeps its original async signature, so pages never change —
 * only the body behind it does.
 */

/* ---------- Roles & users ---------- */

interface ApiRole {
  _id: string
  name: RoleName
  description: string
  permissions: Permission[]
}

/**
 * The server is the single source of truth for the RBAC matrix
 * (`server/src/services/permissions.ts`). The local copy in
 * `lib/permissions.ts` survives only to filter nav links — it grants nothing.
 */
export async function listRoles(): Promise<Role[]> {
  const data = await apiFetch<{ roles: ApiRole[] }>("/roles")
  return data.roles.map((r) => ({
    id: r._id,
    name: r.name,
    permissions: r.permissions,
  }))
}

/** Admin listing. Server-enforced: needs `users.manage`. */
export async function listUsers(): Promise<User[]> {
  const data = await apiFetch<{ users: User[] }>("/users")
  return data.users
}

/**
 * Name-only staff list for rendering an actor id.
 *
 * Replaces the old `listUsers()` calls on the task board, document queues,
 * audit viewer, client profile and order timeline. Those screens are visible to
 * roles that are correctly refused `GET /users`, so they must not call it — a
 * 403 there would blank the page for most of the business.
 */
export async function listUserDirectory(): Promise<UserRef[]> {
  const data = await apiFetch<{ users: UserRef[] }>("/users/directory")
  return data.users
}

export async function updateUser(
  id: string,
  patch: Partial<Pick<User, "name" | "phone" | "roleNames" | "active" | "role" | "agency_name" | "b2b_tier" | "default_commission_pct">>,
): Promise<User> {
  const data = await apiFetch<{ user: User }>(`/users/${id}`, { method: "PATCH", body: patch })
  return data.user
}

/** Create a new staff account (needs `users.manage`). */
export async function createUser(input: {
  email: string
  name: string
  phone?: string
  password: string
  role: RoleName
  roleNames: RoleName[]
  agency_name?: string
  b2b_tier?: "SILVER" | "GOLD" | "PLATINUM"
  default_commission_pct?: number
  active?: boolean
}): Promise<User> {
  const data = await apiFetch<{ user: User }>("/users", {
    method: "POST",
    body: input,
  })
  return data.user
}

/* ---------- Qualifications ---------- */

export async function listQualifications(): Promise<Qualification[]> {
  const data = await apiFetch<{ items: Qualification[] }>("/masters/qualifications")
  return data.items
}

export async function createQualification(
  q: Omit<Qualification, "id">,
): Promise<Qualification> {
  const data = await apiFetch<{ qualification: Qualification }>("/masters/qualifications", {
    method: "POST",
    body: q,
  })
  return data.qualification
}

export async function updateQualification(
  id: string,
  patch: Partial<Pick<Qualification, "code" | "title" | "trainingPackage" | "industry" | "status" | "licensingRefs" | "isBundle" | "deliveryModes" | "trainingPackageTags">>,
): Promise<Qualification> {
  const data = await apiFetch<{ item: Qualification }>(`/masters/qualifications/${id}`, {
    method: "PATCH",
    body: patch,
  })
  return data.item
}

/* ---------- RTOs ---------- */

export async function listRtos(): Promise<Rto[]> {
  const data = await apiFetch<{ items: Rto[] }>("/masters/rtos")
  return data.items
}

export async function createRto(r: Omit<Rto, "id">): Promise<Rto> {
  const data = await apiFetch<{ rto: Rto }>("/masters/rtos", { method: "POST", body: r })
  return data.rto
}

export async function updateRto(
  id: string,
  patch: Partial<Pick<Rto, "legalName" | "tradingName" | "rtoCode" | "cricosCode" | "contacts" | "status" | "complianceNote" | "website" | "accreditationNumber" | "accreditationBody" | "accreditationExpiry" | "lastAuditDate" | "accreditationStatus" | "supportingDocumentIds" | "accreditationNotes">>,
): Promise<Rto> {
  const data = await apiFetch<{ item: Rto }>(`/masters/rtos/${id}`, {
    method: "PATCH",
    body: patch,
  })
  return data.item
}

/* ---------- Agents ---------- */

export async function listAgents(): Promise<Agent[]> {
  const data = await apiFetch<{ items: Agent[] }>("/masters/agents")
  return data.items
}

export async function createAgent(a: Omit<Agent, "id">): Promise<Agent> {
  const data = await apiFetch<{ agent: Agent }>("/masters/agents", { method: "POST", body: a })
  return data.agent
}

export async function updateAgent(
  id: string,
  patch: Partial<Pick<Agent, "name" | "type" | "contact" | "commissionRule" | "active">>,
): Promise<Agent> {
  const data = await apiFetch<{ item: Agent }>(`/masters/agents/${id}`, {
    method: "PATCH",
    body: patch,
  })
  return data.item
}

/* ---------- Qualification–RTO mappings ---------- */

export interface MappingItem {
  id: string
  qualificationId: string
  rtoId: string
  status: "active" | "inactive"
  effectiveFrom: string
  effectiveTo: string | null
  createdAt: string
  updatedAt: string
}

export async function listMappings({
  qualificationId,
  rtoId,
  status,
}: {
  qualificationId?: string
  rtoId?: string
  status?: string
} = {}): Promise<MappingItem[]> {
  const params = new URLSearchParams()
  if (qualificationId) params.set("qualificationId", qualificationId)
  if (rtoId) params.set("rtoId", rtoId)
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: MappingItem[]; total: number }>(
    `/masters/qualification-rto-mappings?${params.toString()}`,
  )
  return data.items
}

export async function createMapping(m: {
  qualificationId: string
  rtoId: string
  status?: "active" | "inactive"
  effectiveFrom?: string
  effectiveTo?: string
}): Promise<MappingItem> {
  const data = await apiFetch<{ mapping: MappingItem }>("/masters/qualification-rto-mappings", {
    method: "POST",
    body: m,
  })
  return data.mapping
}

export async function updateMapping(
  id: string,
  patch: Partial<Pick<MappingItem, "status" | "effectiveFrom" | "effectiveTo">>,
): Promise<MappingItem> {
  const data = await apiFetch<{ mapping: MappingItem }>(`/masters/qualification-rto-mappings/${id}`, {
    method: "PATCH",
    body: patch,
  })
  return data.mapping
}

export async function deleteMapping(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/masters/qualification-rto-mappings/${id}`, {
    method: "DELETE",
  })
}

/* ---------- Qualification → RTO scopes (Phase 4) ---------- */

export interface ScopeItem extends RtoQualificationScope {}

export async function listScopes({
  qualificationId,
  issuingRtoId,
  deliveryMode,
  status,
}: {
  qualificationId?: string
  issuingRtoId?: string
  deliveryMode?: string
  status?: string
} = {}): Promise<RtoQualificationScope[]> {
  const params = new URLSearchParams()
  if (qualificationId) params.set("qualificationId", qualificationId)
  if (issuingRtoId) params.set("issuingRtoId", issuingRtoId)
  if (deliveryMode) params.set("deliveryMode", deliveryMode)
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: RtoQualificationScope[]; total: number }>(
    `/scopes?${params.toString()}`,
  )
  return data.items
}

export async function listScopesForQualification(
  qualificationId: string,
): Promise<RtoQualificationScope[]> {
  const data = await apiFetch<{ items: RtoQualificationScope[] }>(
    `/qualifications/${qualificationId}/scopes`,
  )
  return data.items
}

export async function createScope(
  s: Omit<RtoQualificationScope, "id" | "createdAt" | "updatedAt">,
): Promise<RtoQualificationScope> {
  const data = await apiFetch<{ scope: RtoQualificationScope }>("/scopes", {
    method: "POST",
    body: s,
  })
  return data.scope
}

export async function updateScope(
  id: string,
  patch: Partial<
    Pick<
      RtoQualificationScope,
      | "intermediaryPartnerId"
      | "issuingRtoId"
      | "deliveryMode"
      | "trueRtoCost"
      | "currency"
      | "effectiveFrom"
      | "effectiveTo"
      | "status"
    >
  >,
): Promise<RtoQualificationScope> {
  const data = await apiFetch<{ scope: RtoQualificationScope }>(
    `/scopes/${id}`,
    { method: "PATCH", body: patch },
  )
  return data.scope
}

export async function deleteScope(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/scopes/${id}`, { method: "DELETE" })
}

/* ---------- Enrolment kits (Phase 4) ---------- */

export interface EnrolmentKitItem extends EnrolmentKit {}

export async function listEnrolmentKits({
  qualificationId,
  issuingRtoId,
  active,
}: {
  qualificationId?: string
  issuingRtoId?: string
  active?: boolean
} = {}): Promise<EnrolmentKit[]> {
  const params = new URLSearchParams()
  if (qualificationId) params.set("qualificationId", qualificationId)
  if (issuingRtoId) params.set("issuingRtoId", issuingRtoId)
  if (active !== undefined) params.set("active", String(active))
  const data = await apiFetch<{ items: EnrolmentKit[]; total: number }>(
    `/enrolment-kits?${params.toString()}`,
  )
  return data.items
}

export async function createEnrolmentKit(
  k: Omit<EnrolmentKit, "id" | "createdAt" | "updatedAt">,
): Promise<EnrolmentKit> {
  const data = await apiFetch<{ kit: EnrolmentKit }>("/enrolment-kits", {
    method: "POST",
    body: k,
  })
  return data.kit
}

export async function updateEnrolmentKit(
  id: string,
  patch: Partial<
    Pick<
      EnrolmentKit,
      | "qualificationId"
      | "issuingRtoId"
      | "fileName"
      | "fileUrl"
      | "contentType"
      | "sizeBytes"
      | "active"
    >
  >,
): Promise<EnrolmentKit> {
  const data = await apiFetch<{ kit: EnrolmentKit }>(
    `/enrolment-kits/${id}`,
    { method: "PATCH", body: patch },
  )
  return data.kit
}

export async function deleteEnrolmentKit(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/enrolment-kits/${id}`, {
    method: "DELETE",
  })
}

/* ---------- Supplier routes / pricing ---------- */

export async function listRoutes(): Promise<SupplierRoute[]> {
  const data = await apiFetch<{ items: SupplierRoute[] }>("/masters/supplier-routes")
  return data.items
}

/**
 * A cost change is recorded by expiring the old route and creating a new one.
 * Orders already created keep their own snapshot either way.
 */
export async function createRoute(r: Omit<SupplierRoute, "id">): Promise<SupplierRoute> {
  const data = await apiFetch<{ route: SupplierRoute }>("/masters/supplier-routes", {
    method: "POST",
    body: r,
  })
  return data.route
}

/** History is preserved: expiring sets status + effectiveTo on the server, never deletes. */
export async function expireRoute(id: string): Promise<SupplierRoute> {
  const data = await apiFetch<{ route: SupplierRoute }>(`/masters/supplier-routes/${id}/expire`, {
    method: "POST",
    body: {},
  })
  return data.route
}

/* ---------- Display helpers ---------- */

export function qualificationLabel(q: Qualification): string {
  return `${q.code} — ${q.title}`
}

export function agentLabel(a: Agent): string {
  return a.name
}

export function rtoLabel(r: Rto): string {
  return `${r.tradingName} (${r.rtoCode})`
}

export function orderLabel(o: Order): string {
  return `Order ${o.id}`
}

export function priceListLabel(p: PriceList): string {
  return `${p.amount} ${p.currency}`
}

/* ---------- Price categories ---------- */

export interface PriceCategoryItem extends PriceCategory {}

export async function listPriceCategories({
  status,
}: { status?: string } = {}): Promise<PriceCategory[]> {
  const params = new URLSearchParams()
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: PriceCategory[]; total: number }>(
    `/masters/price-categories?${params.toString()}`,
  )
  return data.items
}

export async function createPriceCategory(
  c: Omit<PriceCategory, "id" | "createdAt" | "updatedAt">,
): Promise<PriceCategory> {
  const data = await apiFetch<{ priceCategory: PriceCategory }>(
    "/masters/price-categories",
    { method: "POST", body: c },
  )
  return data.priceCategory
}

export async function updatePriceCategory(
  id: string,
  patch: Partial<Pick<PriceCategory, "code" | "name" | "description" | "status">>,
): Promise<PriceCategory> {
  const data = await apiFetch<{ priceCategory: PriceCategory }>(
    `/masters/price-categories/${id}`,
    { method: "PATCH", body: patch },
  )
  return data.priceCategory
}

export async function deletePriceCategory(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/masters/price-categories/${id}`, {
    method: "DELETE",
  })
}

/* ---------- Price lists ---------- */

export interface PriceListItem extends PriceList {}

export async function listPriceLists({
  qualificationId,
  priceCategoryId,
  status,
}: {
  qualificationId?: string
  priceCategoryId?: string
  status?: string
} = {}): Promise<PriceList[]> {
  const params = new URLSearchParams()
  if (qualificationId) params.set("qualificationId", qualificationId)
  if (priceCategoryId) params.set("priceCategoryId", priceCategoryId)
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: PriceList[]; total: number }>(
    `/masters/price-lists?${params.toString()}`,
  )
  return data.items
}

export async function createPriceList(
  pl: Omit<PriceList, "id" | "createdAt" | "updatedAt">,
): Promise<PriceList> {
  const data = await apiFetch<{ priceList: PriceList }>(
    "/masters/price-lists",
    { method: "POST", body: pl },
  )
  return data.priceList
}

export async function updatePriceList(
  id: string,
  patch: Partial<
    Pick<
      PriceList,
      "amount" | "currency" | "effectiveFrom" | "effectiveTo" | "status"
    >
  >,
): Promise<PriceList> {
  const data = await apiFetch<{ priceList: PriceList }>(
    `/masters/price-lists/${id}`,
    { method: "PATCH", body: patch },
  )
  return data.priceList
}

export async function deletePriceList(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/masters/price-lists/${id}`, {
    method: "DELETE",
  })
}

/* ---------- Additional fees ---------- */

export interface AdditionalFeeItem extends AdditionalFee {}

export async function listAdditionalFees({
  applicability,
  referenceId,
  status,
}: {
  applicability?: string
  referenceId?: string
  status?: string
} = {}): Promise<AdditionalFee[]> {
  const params = new URLSearchParams()
  if (applicability) params.set("applicability", applicability)
  if (referenceId) params.set("referenceId", referenceId)
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: AdditionalFee[]; total: number }>(
    `/masters/additional-fees?${params.toString()}`,
  )
  return data.items
}

export async function createAdditionalFee(
  f: Omit<AdditionalFee, "id" | "createdAt" | "updatedAt">,
): Promise<AdditionalFee> {
  const data = await apiFetch<{ additionalFee: AdditionalFee }>(
    "/masters/additional-fees",
    { method: "POST", body: f },
  )
  return data.additionalFee
}

/* ---------- Commission rules ---------- */

export interface CommissionRuleItem extends AgentCommissionRule {}

export async function listCommissionRules({
  agentId,
  responsibility,
  status,
  approvalStatus,
}: {
  agentId?: string
  responsibility?: string
  status?: string
  approvalStatus?: string
} = {}): Promise<AgentCommissionRule[]> {
  const params = new URLSearchParams()
  if (agentId) params.set("agentId", agentId)
  if (responsibility) params.set("responsibility", responsibility)
  if (status) params.set("status", status)
  if (approvalStatus) params.set("approvalStatus", approvalStatus)
  const data = await apiFetch<{ items: AgentCommissionRule[]; total: number }>(
    `/masters/commission-rules?${params.toString()}`,
  )
  return data.items
}

export async function createCommissionRule(
  r: Omit<AgentCommissionRule, "id" | "createdAt" | "updatedAt">,
): Promise<AgentCommissionRule> {
  const data = await apiFetch<{ commissionRule: AgentCommissionRule }>(
    "/masters/commission-rules",
    { method: "POST", body: r },
  )
  return data.commissionRule
}

export async function updateCommissionRule(
  id: string,
  patch: Partial<
    Pick<
      AgentCommissionRule,
      | "tiers"
      | "commissionCurrency"
      | "effectiveFrom"
      | "effectiveTo"
      | "status"
      | "approvalStatus"
      | "eligibleOrderStatuses"
      | "additionalIncentiveAmount"
      | "additionalIncentiveCurrency"
    >
  >,
): Promise<AgentCommissionRule> {
  const data = await apiFetch<{ commissionRule: AgentCommissionRule }>(
    `/masters/commission-rules/${id}`,
    { method: "PATCH", body: patch },
  )
  return data.commissionRule
}

export async function deleteCommissionRule(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/masters/commission-rules/${id}`, {
    method: "DELETE",
  })
}

/* ---------- Commission records ---------- */

export interface CommissionRecordItem extends CommissionRecord {}

export async function listCommissionRecords({
  agentId,
  periodMonth,
  periodYear,
  status,
}: {
  agentId?: string
  periodMonth?: number
  periodYear?: number
  status?: string
} = {}): Promise<CommissionRecord[]> {
  const params = new URLSearchParams()
  if (agentId) params.set("agentId", agentId)
  if (periodMonth !== undefined) params.set("periodMonth", String(periodMonth))
  if (periodYear !== undefined) params.set("periodYear", String(periodYear))
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: CommissionRecord[]; total: number }>(
    `/commission-records?${params.toString()}`,
  )
  return data.items
}

export async function calculateCommission({
  agentId,
  periodMonth,
  periodYear,
}: {
  agentId: string
  periodMonth: number
  periodYear: number
}): Promise<CommissionRecord> {
  const data = await apiFetch<{ commissionRecord: CommissionRecord }>(
    "/commission-records",
    {
      method: "POST",
      body: { action: "calculate", agentId, periodMonth, periodYear },
    },
  )
  return data.commissionRecord
}

export async function approveCommissionRecord(
  id: string,
): Promise<CommissionRecord> {
  const data = await apiFetch<{ commissionRecord: CommissionRecord }>(
    `/commission-records/${id}/approve`,
    { method: "POST" },
  )
  return data.commissionRecord
}

export async function rejectCommissionRecord(
  id: string,
  rejectionReason: string,
): Promise<CommissionRecord> {
  const data = await apiFetch<{ commissionRecord: CommissionRecord }>(
    `/commission-records/${id}/reject`,
    { method: "POST", body: { rejectionReason } },
  )
  return data.commissionRecord
}

/* ---------- Commission payouts ---------- */

export interface CommissionPayoutItem extends CommissionPayout {}

export async function listCommissionPayouts({
  commissionRecordId,
  status,
}: {
  commissionRecordId?: string
  status?: string
} = {}): Promise<CommissionPayout[]> {
  const params = new URLSearchParams()
  if (commissionRecordId) params.set("commissionRecordId", commissionRecordId)
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: CommissionPayout[]; total: number }>(
    `/commission-payouts?${params.toString()}`,
  )
  return data.items
}

export async function createCommissionPayout({
  commissionRecordId,
  amount,
  currency,
  paymentDate,
  paymentReference,
}: {
  commissionRecordId: string
  amount: number
  currency: string
  paymentDate?: string
  paymentReference?: string
}): Promise<CommissionPayout> {
  const data = await apiFetch<{ ok: boolean }>("/commission-payouts", {
    method: "POST",
    body: { commissionRecordId, amount, currency, paymentDate, paymentReference },
  })
  return {
    id: "",
    commissionRecordId,
    amount,
    currency,
    paymentDate: paymentDate ?? null,
    paymentReference: paymentReference ?? null,
    status: "paid",
    paidBy: null,
    paidAt: null,
    createdAt: "",
    updatedAt: "",
  } as CommissionPayout
}

/* ---------- RPL Partners ---------- */

export interface RplPartnerItem extends RplPartner {}

export async function listRplPartners({
  status,
  search,
}: { status?: string; search?: string } = {}): Promise<RplPartner[]> {
  const params = new URLSearchParams()
  if (status) params.set("status", status)
  if (search) params.set("search", search)
  const data = await apiFetch<{ items: RplPartner[]; total: number }>(
    `/rpl-partners?${params.toString()}`,
  )
  return data.items
}

export async function createRplPartner(
  p: Omit<RplPartner, "id" | "createdAt" | "updatedAt">,
): Promise<RplPartner> {
  const data = await apiFetch<{ rplPartner: RplPartner }>(
    "/rpl-partners",
    { method: "POST", body: p },
  )
  return data.rplPartner
}

export async function updateRplPartner(
  id: string,
  patch: Partial<Pick<RplPartner, "partnerCode" | "legalName" | "tradingName" | "contactPerson" | "email" | "phone" | "address" | "status" | "notes">>,
): Promise<RplPartner> {
  const data = await apiFetch<{ rplPartner: RplPartner }>(
    `/rpl-partners/${id}`,
    { method: "PATCH", body: patch },
  )
  return data.rplPartner
}

export async function deleteRplPartner(id: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/rpl-partners/${id}`, {
    method: "DELETE",
  })
}

export function rplPartnerLabel(p: RplPartner): string {
  return `${p.tradingName ?? p.legalName} (${p.partnerCode})`
}

/* ---------- Certificate Deliveries ---------- */

export interface CertificateDeliveryItem extends CertificateDelivery {}

export async function listCertificateDeliveries({
  orderId,
  status,
}: { orderId?: string; status?: string } = {}): Promise<CertificateDelivery[]> {
  const params = new URLSearchParams()
  if (orderId) params.set("orderId", orderId)
  if (status) params.set("status", status)
  const data = await apiFetch<{ items: CertificateDelivery[]; total: number }>(
    `/certificate-deliveries?${params.toString()}`,
  )
  return data.items
}

export async function createCertificateDelivery(
  d: Omit<CertificateDelivery, "id" | "createdAt" | "updatedAt">,
): Promise<CertificateDelivery> {
  const data = await apiFetch<{ certificateDelivery: CertificateDelivery }>(
    "/certificate-deliveries",
    { method: "POST", body: d },
  )
  return data.certificateDelivery
}

export async function updateCertificateDelivery(
  id: string,
  patch: Partial<Pick<CertificateDelivery, "deliveryStatus" | "deliveryDate" | "recipient" | "deliveryMethod" | "trackingNumber" | "confirmationDetails" | "deliveryNotes">>,
): Promise<CertificateDelivery> {
  const data = await apiFetch<{ certificateDelivery: CertificateDelivery }>(
    `/certificate-deliveries/${id}`,
    { method: "PATCH", body: patch },
  )
  return data.certificateDelivery
}

/* ---------- Price Matrix Import ---------- */

export interface PriceMatrixPreviewRow {
  rowNum: number
  qualificationCode: string | null
  qualificationTitle: string | null
  qualificationId: string | null
  rtoName: string | null
  rtoCode: string | null
  rtoId: string | null
  wholesaleCost: number | null
  currency: string
  status: "Ready" | "Pending Review" | "Conflict" | "Invalid" | "Imported"
  errors: string[]
}

export interface PriceMatrixPreview {
  filename: string
  sheet: string
  headers: string[]
  rtoPricePairs: Array<{ rtoCol: number; priceCol: number; rtoHeader: string }>
  totalRows: number
  readyCount: number
  pendingCount: number
  rows: PriceMatrixPreviewRow[]
}

export interface PriceMatrixAgent {
  id: string
  name: string
  contact: string
}

export interface PriceMatrixPreviewResult {
  preview: PriceMatrixPreview
  agents: PriceMatrixAgent[]
}

export interface PriceMatrixImportRow {
  qualificationId: string
  rtoId: string
  sourceAgentId: string
  wholesaleCost: number
  currency: "AUD"
  effectiveFrom: string
  effectiveTo: string | null
}

export interface PriceMatrixImportResult {
  totalRows: number
  importedCount: number
  pendingCount: number
  errorCount: number
  imported: Array<{
    rowIndex: number
    id: string
    qualificationId: string
    rtoId: string
    sourceAgentId: string
    wholesaleCost: number
  }>
  pending: Array<{
    rowIndex: number
    reason: string
    row: PriceMatrixImportRow
  }>
  errors: Array<{
    rowIndex: number
    code: string
    message: string
  }>
}

/** Upload and parse the Price Matrix sheet for preview. Returns unresolved rows flagged as "Pending Review". */
export async function previewPriceMatrix(file: File): Promise<PriceMatrixPreviewResult> {
  const formData = new FormData()
  formData.append("file", file)
  const data = await uploadFile<PriceMatrixPreviewResult>("/excel/price-matrix/preview", formData)
  return data
}

/** Import verified Price Matrix rows as supplier routes. Unresolved rows are reported as pending and not imported. */
export async function importPriceMatrix(rows: PriceMatrixImportRow[]): Promise<PriceMatrixImportResult> {
  const data = await apiFetch<{ result: PriceMatrixImportResult }>("/excel/price-matrix/import", {
    method: "POST",
    body: { rows },
  })
  return data.result
}