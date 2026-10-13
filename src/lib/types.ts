/**
 * Core entity types — mirrors Spec §7 data model.
 * Day-2 uses an in-memory preview store with this exact shape so the
 * future REST/MongoDB backend can plug in without UI changes.
 */

export type RoleName =
  | "Super Admin"
  | "Finance"
  | "Operations"
  | "Sales / Closing Agent"
  | "RTO / Sourcing Manager"
  | "Document Reviewer"
  | "Read Only / Manager"

export interface Role {
  id: string
  name: RoleName
  permissions: Permission[]
}

export interface User {
  id: string
  name: string
  email: string
  phone: string
  roleIds: string[]
  active: boolean
  lastLoginAt: string | null
}

export type AgentType = "sales_closing" | "certificate_source" | "rto_contact"

export interface Agent {
  id: string
  name: string
  type: AgentType
  contact: string
  commissionRule: string
  active: boolean
}

export type QualificationStatus = "current" | "superseded"

export interface LicensingRef {
  industry: string
  authority: string
  prerequisites: string
  outcome: string
}

export interface Qualification {
  id: string
  code: string
  title: string
  trainingPackage: string
  industry: string
  status: QualificationStatus
  licensingRefs: LicensingRef[]
}

export type RtoStatus = "active" | "suspended" | "at-risk" | "inactive"

export interface RtoContact {
  name: string
  role: string
  email: string
  phone: string
}

export interface Rto {
  id: string
  legalName: string
  tradingName: string
  rtoCode: string
  cricosCode: string | null
  contacts: RtoContact[]
  status: RtoStatus
  complianceNote: string
  website: string
}

export type RouteStatus = "active" | "expired"

export interface SupplierRoute {
  id: string
  qualificationId: string
  sourceAgentId: string
  rtoId: string
  wholesaleCost: number
  currency: "AUD"
  effectiveFrom: string
  effectiveTo: string | null
  status: RouteStatus
}

/** Fine-grained permissions enforced server-side (Day-2: mirrored in UI guards). */
export type Permission =
  | "users.manage"
  | "roles.manage"
  | "clients.view"
  | "clients.manage"
  | "orders.view"
  | "orders.manage"
  | "rto.manage"
  | "agents.manage"
  | "qualifications.manage"
  | "pricing.manage"
  | "documents.view"
  | "documents.review"
  | "finance.view"
  | "finance.manage"
  | "qb.retry"
  | "reports.view"
  | "audit.view"
  | "settings.manage"

/* ================= Day-3: Clients, Orders, Workflow, Documents ========== */
/* Statuses use the exact vocabularies from Spec §5–§6. Never merge them. */

export type OrderStatus =
  | "Lead"
  | "Qualified"
  | "Won"
  | "Lost"
  | "New"
  | "Awaiting Payment"
  | "Awaiting Documents"
  | "Documents Under Review"
  | "Ready for Submission"
  | "Submitted to Source Agent"
  | "Submitted to RTO"
  | "RTO Acknowledged"
  | "Under Assessment"
  | "Additional Evidence Required"
  | "Rework Required"
  | "Approved"
  | "Certificate Issued"
  | "Completed"
  | "On Hold"
  | "Cancelled"
  | "Refunded"

export const ORDER_STATUS_GROUPS: Array<{
  group: string
  statuses: OrderStatus[]
}> = [
  { group: "Sales", statuses: ["Lead", "Qualified", "Won", "Lost"] },
  {
    group: "Onboarding",
    statuses: ["New", "Awaiting Payment", "Awaiting Documents", "Documents Under Review"],
  },
  {
    group: "Submission",
    statuses: ["Ready for Submission", "Submitted to Source Agent", "Submitted to RTO", "RTO Acknowledged"],
  },
  {
    group: "Assessment",
    statuses: ["Under Assessment", "Additional Evidence Required", "Rework Required"],
  },
  { group: "Completion", statuses: ["Approved", "Certificate Issued", "Completed"] },
  { group: "Exception", statuses: ["On Hold", "Cancelled", "Refunded"] },
]

export type DocumentStatus =
  | "Requested"
  | "Not Received"
  | "Received"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Superseded"

export type EvidenceStatus =
  | "Not Started"
  | "In Progress"
  | "Complete"
  | "Additional Evidence Required"

export type RtoSubmissionStatus =
  | "Not Ready"
  | "Ready"
  | "Submitted"
  | "Acknowledged"
  | "Under Assessment"
  | "Additional Evidence Required"
  | "Issued"

export type CertificateStatus =
  | "Not Issued"
  | "Pending"
  | "Issued"
  | "Certificate File Received"
  | "Delivered to Client"

export type PaymentStatus =
  | "Unpaid"
  | "Part Paid"
  | "Paid"
  | "Overdue"
  | "Refunded"
  | "Written Off"

export type TaskStatus = "Todo" | "In Progress" | "Done" | "Blocked"

export interface Client {
  id: string
  legalName: string
  preferredName: string
  phone: string
  email: string
  address: string
  status: string
  sourceAgentId: string | null
  notes: string
  createdAt: string
}

export interface StatusChange {
  timestamp: string
  actorId: string
  field: string
  before: string
  after: string
}

export interface Order {
  id: string
  clientId: string
  qualificationId: string
  salesAgentId: string
  sourceAgentId: string
  rtoId: string
  status: OrderStatus
  evidenceStatus: EvidenceStatus
  rtoSubmissionStatus: RtoSubmissionStatus
  certificateStatus: CertificateStatus
  sellingPrice: number
  supplierCostSnapshot: number
  otherCost: number
  currency: "AUD"
  createdAt: string
  updatedAt: string
  completedAt: string | null
  history: StatusChange[]
}

export interface OrderDocument {
  id: string
  clientId: string
  orderId: string
  type: string
  storageKey: string
  version: number
  status: DocumentStatus
  receivedAt: string | null
  reviewedAt: string | null
  reviewedBy: string | null
  rejectionReason: string | null
}

export interface WorkflowTask {
  id: string
  orderId: string
  stage: string
  title: string
  assigneeId: string | null
  dueDate: string | null
  status: TaskStatus
  priority: "Low" | "Medium" | "High"
}

/** Per-qualification document checklist template. */
export const DOC_CHECKLISTS: Record<string, string[]> = {
  default: [
    "Identity (passport / licence)",
    "USI transcript",
    "Employment evidence",
    "Reference letter",
    "Photos / skills evidence",
    "RTO enrolment kit",
  ],
}

/* ================= Day-4: Finance, QuickBooks, Audit =================== */

export type InvoiceStatus =
  | "Draft"
  | "Sent"
  | "Part Paid"
  | "Paid"
  | "Overdue"
  | "Void"

export interface Invoice {
  id: string
  orderId: string
  invoiceNumber: string
  total: number
  dueDate: string
  status: InvoiceStatus
  createdAt: string
}

export type InstalmentStatus =
  | "Pending"
  | "Due"
  | "Paid"
  | "Part Paid"
  | "Overdue"
  | "Waived"
  | "Cancelled"

export interface Instalment {
  id: string
  dueDate: string
  amount: number
  paidAmount: number
  status: InstalmentStatus
}

export interface PaymentPlan {
  id: string
  orderId: string
  total: number
  instalments: Instalment[]
}

export type PaymentMethod = "Bank Transfer" | "Card" | "Cash" | "Other"

export interface Payment {
  id: string
  orderId: string
  invoiceId: string | null
  amount: number
  date: string
  method: PaymentMethod
  reference: string
  allocatedAmount: number
  status: "Allocated" | "Partially Allocated" | "Unallocated" | "Refunded" | "Void"
}

export type QBSyncStatus = "Not Synced" | "Pending" | "Synced" | "Failed"

export interface QBSyncRecord {
  entityType: "invoice" | "payment"
  entityId: string
  idempotencyKey: string
  status: QBSyncStatus
  attempts: number
  lastSyncAt: string | null
  syncError: string | null
  qbReference: string | null
}

export interface AuditEvent {
  id: string
  timestamp: string
  actorId: string
  entityType: string
  entityId: string
  action: string
  before: string
  after: string
}
