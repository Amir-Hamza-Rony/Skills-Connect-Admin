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
 * CUTOVER STATE (Phases B5–B6): invoices, payment plans, payments, the
 * QuickBooks sync queue and the audit trail all come from the real API. The
 * server writes its own append-only audit rows for every mutation; the client
 * only reads them via `GET /audit`.
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
  const data = await api.post<{ invoice: Invoice }>(`/invoices/${id}/void`)
  return data.invoice
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
  const data = await api.post<{ payment: Payment }>(`/payments/${id}/refund`)
  return data.payment
}

/* ---------- Summary (real API) ---------- */

export interface FinanceSummary {
  invoiced: number
  collected: number
  outstanding: number
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
  const data = await api.post<{ record: QBSyncRecord }>(`/integrations/quickbooks/sync/${entityType}/${entityId}`)
  return data.record
}

/* ---------- Audit (real API, B6 cutover) ---------- */

/**
 * Reads the append-only audit trail from `GET /audit`. Server-side filtering
 * and pagination mean we never pull the whole collection to the browser.
 * `entityId` is passed as a search term so callers can scope to one record.
 */
export async function listAudit(entityId?: string): Promise<AuditEvent[]> {
  const params = new URLSearchParams()
  if (entityId) params.set("search", entityId)
  params.set("pageSize", "100")
  const data = await api.get<{ events: AuditEvent[]; total: number }>(
    `/audit?${params.toString()}`,
  )
  return data.events
}

export type { Instalment, InvoiceStatus }
