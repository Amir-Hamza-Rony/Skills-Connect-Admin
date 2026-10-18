import { api } from "@/lib/api"
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

/**
 * Finance data-access layer.
 *
 * CUTOVER STATE (Phase B5): invoices, payment plans, payments and the
 * QuickBooks sync queue all come from the real API. The audit trail stays on
 * the in-memory preview store until B6 builds the audit viewer — the server
 * already writes its own append-only audit rows for every mutation.
 *
 * Every function keeps its original async signature, so pages never change —
 * only the body behind it does.
 */

/* ---------- Invoices (real API) ---------- */

export async function listInvoices(orderId?: string): Promise<Invoice[]> {
  const query = orderId ? `?orderId=${encodeURIComponent(orderId)}` : ""
  const data = await api.get<{ invoices: Invoice[] }>(`/invoices${query}`)
  return data.invoices
}

export async function createInvoice(
  o: { orderId: string; total: number; dueDate: string },
  _actorId: string,
): Promise<Invoice> {
  const data = await api.post<{ invoice: Invoice }>("/invoices", o)
  return data.invoice
}

export async function voidInvoice(id: string, _actorId: string): Promise<Invoice> {
  return api.post(`/invoices/${id}/void`)
}

/* ---------- Payment plans (real API) ---------- */

export async function getPlan(orderId: string): Promise<PaymentPlan | undefined> {
  try {
    const data = await api.get<{ plan: PaymentPlan }>(`/orders/${orderId}/payment-plan`)
    return data.plan
  } catch {
    return undefined
  }
}

export async function listPlans(): Promise<PaymentPlan[]> {
  const data = await api.get<{ plans: PaymentPlan[] }>("/payment-plans")
  return data.plans
}

export async function createPlan(
  orderId: string,
  total: number,
  _actorId: string,
): Promise<PaymentPlan> {
  const data = await api.post<{ plan: PaymentPlan }>(`/orders/${orderId}/payment-plan`, { total })
  return data.plan
}

export async function addInstalment(
  planId: string,
  dueDate: string,
  amount: number,
  _actorId: string,
): Promise<PaymentPlan> {
  const data = await api.post<{ plan: PaymentPlan }>(
    `/payment-plans/${planId}/instalments`,
    { dueDate, amount },
  )
  return data.plan
}

/* ---------- Payments (real API) ---------- */

export async function listPayments(orderId?: string): Promise<Payment[]> {
  const query = orderId ? `?orderId=${encodeURIComponent(orderId)}` : ""
  const data = await api.get<{ payments: Payment[] }>(`/payments${query}`)
  return data.payments
}

export async function recordPayment(
  o: {
    orderId: string
    invoiceId: string | null
    amount: number
    date: string
    method: PaymentMethod
    reference: string
  },
  _actorId: string,
): Promise<Payment> {
  const data = await api.post<{ payment: Payment }>("/payments", o)
  return data.payment
}

export async function refundPayment(id: string, _actorId: string): Promise<Payment> {
  return api.post(`/payments/${id}/refund`)
}

/* ---------- Summary (real API) ---------- */

export interface FinanceSummary {
  invoiced: number
  paid: number
  outstanding: number
  overdue: number
}

export async function financeSummary(orderId?: string): Promise<FinanceSummary> {
  const query = orderId ? `?orderId=${encodeURIComponent(orderId)}` : ""
  return api.get(`/finance/summary${query}`)
}

/* ---------- QuickBooks sync (real API) ---------- */

export async function listQBSync(): Promise<QBSyncRecord[]> {
  const data = await api.get<{ records: QBSyncRecord[] }>("/integrations/quickbooks/sync")
  return data.records
}

export async function qbStatusFor(
  entityType: "invoice" | "payment",
  entityId: string,
): Promise<QBSyncStatus> {
  const records = await listQBSync()
  return (
    records.find((q) => q.entityType === entityType && q.entityId === entityId)?.status ??
    "Not Synced"
  )
}

export async function retryQBSync(
  entityType: "invoice" | "payment",
  entityId: string,
  _actorId: string,
): Promise<QBSyncRecord> {
  return api.post(`/integrations/quickbooks/sync/${entityType}/${entityId}`)
}

/* ---------- Audit (preview until B6) ---------- */

const latency = () => new Promise((r) => setTimeout(r, 120))

let audit: AuditEvent[] = []

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
  audit = [
    {
      id: `a-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`,
      timestamp: new Date().toISOString(),
      actorId,
      entityType,
      entityId,
      action,
      before,
      after,
    },
    ...audit,
  ]
}

export type { Instalment, InvoiceStatus }
