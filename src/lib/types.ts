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
