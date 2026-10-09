import type {
  AuditEvent,
  Instalment,
  Invoice,
  InvoiceStatus,
  Payment,
  PaymentMethod,
  PaymentPlan,
  QBSyncRecord,
  QBSyncStatus,
} from "@/lib/types"
import {
  SEED_AUDIT,
  SEED_INVOICES,
  SEED_PAYMENTS,
  SEED_PLANS,
  SEED_QB,
} from "@/mocks/fin-seed"

/**
 * Preview finance layer (Day-4). Formulas per Spec §6:
 * amountPaid = Σ allocated · balanceDue = invoiced − paid − credits ·
 * overdue = unpaid scheduled amount with dueDate < today.
 * No transaction is ever deleted — reversals/voids only, all audited.
 */

const latency = () => new Promise((r) => setTimeout(r, 120))

let invoices: Invoice[] = structuredClone(SEED_INVOICES)
let plans: PaymentPlan[] = structuredClone(SEED_PLANS)
let payments: Payment[] = structuredClone(SEED_PAYMENTS)
let qb: QBSyncRecord[] = structuredClone(SEED_QB)
let audit: AuditEvent[] = structuredClone(SEED_AUDIT)
let invSeq = 3

const uid = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`

const nowIso = () => new Date().toISOString()
const today = () => nowIso().slice(0, 10)

function log(entityType: string, entityId: string, action: string, before: string, after: string, actorId: string) {
  audit = [
    { id: uid("a"), timestamp: nowIso(), actorId, entityType, entityId, action, before, after },
    ...audit,
  ]
}

/* ---------- Invoices ---------- */

export async function listInvoices(orderId?: string): Promise<Invoice[]> {
  await latency()
  const rows = orderId ? invoices.filter((i) => i.orderId === orderId) : [...invoices]
  return rows.map(refreshInvoiceStatus)
}

function refreshInvoiceStatus(inv: Invoice): Invoice {
  if (inv.status === "Void" || inv.status === "Draft") return inv
  const paid = payments
    .filter((p) => p.invoiceId === inv.id && p.status !== "Void" && p.status !== "Refunded")
    .reduce((s, p) => s + p.allocatedAmount, 0)
  let status: InvoiceStatus = "Sent"
  if (paid >= inv.total) status = "Paid"
  else if (paid > 0) status = "Part Paid"
  else if (inv.dueDate < today()) status = "Overdue"
  return { ...inv, status }
}

export async function createInvoice(
  o: { orderId: string; total: number; dueDate: string },
  actorId: string,
): Promise<Invoice> {
  await latency()
  const created: Invoice = {
    id: uid("inv"),
    orderId: o.orderId,
    invoiceNumber: `INV-2026-${String(invSeq++).padStart(4, "0")}`,
    total: o.total,
    dueDate: o.dueDate,
    status: "Sent",
    createdAt: nowIso(),
  }
  invoices = [created, ...invoices]
  qb = [
    { entityType: "invoice", entityId: created.id, idempotencyKey: `qb-${created.id}-v1`, status: "Not Synced", attempts: 0, lastSyncAt: null, syncError: null, qbReference: null },
    ...qb,
  ]
  log("invoice", created.id, "create", "—", `${created.invoiceNumber} · AUD ${o.total}`, actorId)
  return refreshInvoiceStatus(created)
}

export async function voidInvoice(id: string, actorId: string): Promise<Invoice> {
  await latency()
  const i = invoices.findIndex((x) => x.id === id)
  if (i === -1) throw new Error("Invoice not found")
  const before = invoices[i].status
  invoices[i] = { ...invoices[i], status: "Void" }
  log("invoice", id, "void", before, "Void", actorId)
  return invoices[i]
}

/* ---------- Payment plans ---------- */

export async function getPlan(orderId: string): Promise<PaymentPlan | undefined> {
  await latency()
  return plans.find((p) => p.orderId === orderId)
}

export async function listPlans(): Promise<PaymentPlan[]> {
  await latency()
  return [...plans]
}

export async function createPlan(
  orderId: string,
  total: number,
  actorId: string,
): Promise<PaymentPlan> {
  await latency()
  const created: PaymentPlan = { id: uid("pp"), orderId, total, instalments: [] }
  plans = [created, ...plans]
  log("payment_plan", created.id, "create", "—", `Order ${orderId} · AUD ${total}`, actorId)
  return created
}

export async function addInstalment(
  planId: string,
  dueDate: string,
  amount: number,
  actorId: string,
): Promise<PaymentPlan> {
  await latency()
  const i = plans.findIndex((p) => p.id === planId)
  if (i === -1) throw new Error("Plan not found")
  const inst: Instalment = {
    id: uid("ins"),
    dueDate,
    amount,
    paidAmount: 0,
    status: dueDate < today() ? "Due" : "Pending",
  }
  plans[i] = { ...plans[i], instalments: [...plans[i].instalments, inst] }
  log("payment_plan", planId, "add-instalment", "—", `AUD ${amount} due ${dueDate}`, actorId)
  return plans[i]
}

/* ---------- Payments + allocation ---------- */

/** Oldest-due-first auto-allocation across the order's plan instalments. */
function allocate(orderId: string, amount: number): number {
  const plan = plans.find((p) => p.orderId === orderId)
  if (!plan) return 0
  let remaining = amount
  for (const inst of plan.instalments) {
    if (remaining <= 0) break
    if (inst.status === "Waived" || inst.status === "Cancelled" || inst.status === "Paid") continue
    const due = inst.amount - inst.paidAmount
    const take = Math.min(due, remaining)
    inst.paidAmount += take
    remaining -= take
    inst.status = inst.paidAmount >= inst.amount ? "Paid" : "Part Paid"
  }
  return amount - remaining
}

export async function listPayments(orderId?: string): Promise<Payment[]> {
  await latency()
  return orderId ? payments.filter((p) => p.orderId === orderId) : [...payments]
}

export async function recordPayment(
  o: { orderId: string; invoiceId: string | null; amount: number; date: string; method: PaymentMethod; reference: string },
  actorId: string,
): Promise<Payment> {
  await latency()
  if (!Number.isFinite(o.amount) || o.amount <= 0) throw new Error("Amount must be positive.")
  const allocated = allocate(o.orderId, o.amount)
  const created: Payment = {
    id: uid("pay"),
    orderId: o.orderId,
    invoiceId: o.invoiceId,
    amount: o.amount,
    date: o.date,
    method: o.method,
    reference: o.reference,
    allocatedAmount: allocated,
    status: allocated >= o.amount ? "Allocated" : allocated > 0 ? "Partially Allocated" : "Unallocated",
  }
  payments = [created, ...payments]
  qb = [
    { entityType: "payment", entityId: created.id, idempotencyKey: `qb-${created.id}-v1`, status: "Not Synced", attempts: 0, lastSyncAt: null, syncError: null, qbReference: null },
    ...qb,
  ]
  log("payment", created.id, "record", "—", `AUD ${o.amount} · ${o.method} · allocated ${allocated}`, actorId)
  return created
}

export async function refundPayment(id: string, actorId: string): Promise<Payment> {
  await latency()
  const i = payments.findIndex((p) => p.id === id)
  if (i === -1) throw new Error("Payment not found")
  const before = payments[i].status
  payments[i] = { ...payments[i], status: "Refunded" }
  log("payment", id, "refund", before, "Refunded", actorId)
  return payments[i]
}

/* ---------- Summaries ---------- */

export interface FinanceSummary {
  invoiced: number
  paid: number
  outstanding: number
  overdue: number
}

export async function financeSummary(orderId?: string): Promise<FinanceSummary> {
  await latency()
  const invs = orderId ? invoices.filter((i) => i.orderId === orderId) : invoices
  const pays = (orderId ? payments.filter((p) => p.orderId === orderId) : payments).filter(
    (p) => p.status !== "Void" && p.status !== "Refunded",
  )
  const invoiced = invs.filter((i) => i.status !== "Void").reduce((s, i) => s + i.total, 0)
  const paid = pays.reduce((s, p) => s + p.allocatedAmount, 0)
  const relevantPlans = orderId ? plans.filter((p) => p.orderId === orderId) : plans
  const overdue = relevantPlans
    .flatMap((p) => p.instalments)
    .filter((x) => x.dueDate < today() && x.status !== "Paid" && x.status !== "Waived" && x.status !== "Cancelled")
    .reduce((s, x) => s + (x.amount - x.paidAmount), 0)
  return { invoiced, paid, outstanding: Math.max(0, invoiced - paid), overdue }
}

/* ---------- QuickBooks sync (simulated idempotent queue) ---------- */

export async function listQBSync(): Promise<QBSyncRecord[]> {
  await latency()
  return [...qb]
}

export async function qbStatusFor(entityType: "invoice" | "payment", entityId: string): Promise<QBSyncStatus> {
  await latency()
  return qb.find((q) => q.entityType === entityType && q.entityId === entityId)?.status ?? "Not Synced"
}

/**
 * Idempotent retry: same idempotency key is reused, so a retried job can
 * never create a duplicate. Preview transport fails the first attempt of
 * previously-failed records, then succeeds — the STATUS FLOW (not the
 * transport) is what Day-4 demonstrates.
 */
export async function retryQBSync(
  entityType: "invoice" | "payment",
  entityId: string,
  actorId: string,
): Promise<QBSyncRecord> {
  await latency()
  const i = qb.findIndex((q) => q.entityType === entityType && q.entityId === entityId)
  if (i === -1) throw new Error("Sync record not found")
  const rec = qb[i]
  const attempts = rec.attempts + 1
  const succeed = rec.status !== "Failed" || attempts >= 2
  qb[i] = {
    ...rec,
    attempts,
    status: succeed ? "Synced" : "Failed",
    lastSyncAt: nowIso(),
    syncError: succeed ? null : "QuickBooks sandbox unreachable (preview).",
    qbReference: succeed ? (rec.qbReference ?? `QB-${1000 + attempts * 7}`) : rec.qbReference,
  }
  log("qb_sync", entityId, "retry", rec.status, qb[i].status, actorId)
  return qb[i]
}

/* ---------- Audit ---------- */

export async function listAudit(entityId?: string): Promise<AuditEvent[]> {
  await latency()
  return entityId ? audit.filter((a) => a.entityId === entityId) : [...audit]
}

export function auditLog(
  entityType: string,
  entityId: string,
  action: string,
  before: string,
  after: string,
  actorId: string,
) {
  log(entityType, entityId, action, before, after, actorId)
}
