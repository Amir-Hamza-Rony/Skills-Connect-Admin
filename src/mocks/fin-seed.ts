import type {
  AuditEvent,
  Invoice,
  Payment,
  PaymentPlan,
  QBSyncRecord,
} from "@/lib/types"

/** PREVIEW finance seed. Synthetic — replaced by real backend + migration. */

export const SEED_INVOICES: Invoice[] = [
  {
    id: "inv-1",
    orderId: "o-1",
    invoiceNumber: "INV-2026-0001",
    total: 2500,
    dueDate: "2026-09-15",
    status: "Part Paid",
    createdAt: "2026-08-04T10:00:00Z",
  },
  {
    id: "inv-2",
    orderId: "o-2",
    invoiceNumber: "INV-2026-0002",
    total: 2800,
    dueDate: "2026-10-20",
    status: "Sent",
    createdAt: "2026-08-22T10:00:00Z",
  },
]

export const SEED_PLANS: PaymentPlan[] = [
  {
    id: "pp-1",
    orderId: "o-1",
    total: 2500,
    instalments: [
      { id: "ins-1", dueDate: "2026-08-10", amount: 500, paidAmount: 500, status: "Paid" },
      { id: "ins-2", dueDate: "2026-09-15", amount: 1000, paidAmount: 700, status: "Part Paid" },
      { id: "ins-3", dueDate: "2026-10-25", amount: 1000, paidAmount: 0, status: "Due" },
    ],
  },
  {
    id: "pp-2",
    orderId: "o-2",
    total: 2800,
    instalments: [
      { id: "ins-4", dueDate: "2026-09-01", amount: 800, paidAmount: 0, status: "Due" },
      { id: "ins-5", dueDate: "2026-10-20", amount: 1000, paidAmount: 0, status: "Pending" },
      { id: "ins-6", dueDate: "2026-11-20", amount: 1000, paidAmount: 0, status: "Pending" },
    ],
  },
]

export const SEED_PAYMENTS: Payment[] = [
  {
    id: "pay-1",
    orderId: "o-1",
    invoiceId: "inv-1",
    amount: 500,
    date: "2026-08-09",
    method: "Bank Transfer",
    reference: "BT-0001",
    allocatedAmount: 500,
    status: "Allocated",
  },
  {
    id: "pay-2",
    orderId: "o-1",
    invoiceId: "inv-1",
    amount: 700,
    date: "2026-09-12",
    method: "Card",
    reference: "CARD-0442",
    allocatedAmount: 700,
    status: "Allocated",
  },
]

export const SEED_QB: QBSyncRecord[] = [
  {
    entityType: "invoice",
    entityId: "inv-1",
    idempotencyKey: "qb-inv-1-v1",
    status: "Synced",
    attempts: 1,
    lastSyncAt: "2026-08-04T11:00:00Z",
    syncError: null,
    qbReference: "QB-1001",
  },
  {
    entityType: "invoice",
    entityId: "inv-2",
    idempotencyKey: "qb-inv-2-v1",
    status: "Failed",
    attempts: 1,
    lastSyncAt: "2026-08-22T11:00:00Z",
    syncError: "QuickBooks sandbox unreachable (preview).",
    qbReference: null,
  },
]

export const SEED_AUDIT: AuditEvent[] = [
  { id: "a-1", timestamp: "2026-08-04T10:00:00Z", actorId: "u-finance", entityType: "invoice", entityId: "inv-1", action: "create", before: "—", after: "INV-2026-0001 · AUD 2,500" },
  { id: "a-2", timestamp: "2026-08-09T10:00:00Z", actorId: "u-finance", entityType: "payment", entityId: "pay-1", action: "record", before: "—", after: "AUD 500 · Bank Transfer" },
  { id: "a-3", timestamp: "2026-09-12T10:00:00Z", actorId: "u-finance", entityType: "payment", entityId: "pay-2", action: "record", before: "—", after: "AUD 700 · Card" },
]
