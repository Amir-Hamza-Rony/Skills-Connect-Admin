import type {
  Agent,
  Qualification,
  Role,
  Rto,
  SupplierRoute,
  User,
} from "@/lib/types"

/**
 * PREVIEW seed data for Day-2 UI development only.
 * Clearly synthetic (DEMO-prefixed codes). Replaced by the real
 * backend + migrated workbook data. Never treat as production data.
 */

export const SEED_ROLES: Role[] = [
  { id: "role-superadmin", name: "Super Admin", permissions: [] },
  { id: "role-finance", name: "Finance", permissions: [] },
  { id: "role-operations", name: "Operations", permissions: [] },
  { id: "role-sales", name: "Sales / Closing Agent", permissions: [] },
  { id: "role-sourcing", name: "RTO / Sourcing Manager", permissions: [] },
  { id: "role-reviewer", name: "Document Reviewer", permissions: [] },
  { id: "role-readonly", name: "Read Only / Manager", permissions: [] },
]

export const SEED_USERS: User[] = [
  { id: "u-admin", name: "A. Admin", email: "admin@skillsconnect.example", phone: "0400 000 001", roleIds: ["role-superadmin"], active: true, lastLoginAt: "2026-10-10T09:00:00Z" },
  { id: "u-finance", name: "F. Finance", email: "finance@skillsconnect.example", phone: "0400 000 002", roleIds: ["role-finance"], active: true, lastLoginAt: "2026-10-09T14:20:00Z" },
  { id: "u-ops", name: "O. Operations", email: "operations@skillsconnect.example", phone: "0400 000 003", roleIds: ["role-operations"], active: true, lastLoginAt: "2026-10-10T08:15:00Z" },
  { id: "u-sales", name: "S. Closer", email: "sales@skillsconnect.example", phone: "0400 000 004", roleIds: ["role-sales"], active: true, lastLoginAt: "2026-10-08T11:00:00Z" },
  { id: "u-source", name: "R. Sourcer", email: "sourcing@skillsconnect.example", phone: "0400 000 005", roleIds: ["role-sourcing"], active: true, lastLoginAt: "2026-10-07T16:40:00Z" },
  { id: "u-review", name: "D. Reviewer", email: "review@skillsconnect.example", phone: "0400 000 006", roleIds: ["role-reviewer"], active: true, lastLoginAt: null },
  { id: "u-ro", name: "M. Manager", email: "manager@skillsconnect.example", phone: "0400 000 007", roleIds: ["role-readonly"], active: false, lastLoginAt: null },
]

export const SEED_QUALIFICATIONS: Qualification[] = [
  {
    id: "q-aur32120",
    code: "AUR32120",
    title: "Certificate III in Automotive Body Repair Technology",
    trainingPackage: "AUR Automotive Retail, Service and Repair",
    industry: "Automotive",
    status: "current",
    licensingRefs: [],
  },
  {
    id: "q-cpc30220",
    code: "CPC30220",
    title: "Certificate III in Carpentry",
    trainingPackage: "CPC Construction, Plumbing and Services",
    industry: "Construction",
    status: "current",
    licensingRefs: [
      { industry: "Construction", authority: "State licensing body", prerequisites: "White Card", outcome: "Licensed carpenter pathway" },
    ],
  },
  {
    id: "q-sit30821",
    code: "SIT30821",
    title: "Certificate III in Commercial Cookery",
    trainingPackage: "SIT Tourism, Travel and Hospitality",
    industry: "Hospitality",
    status: "current",
    licensingRefs: [],
  },
  {
    id: "q-chc33021",
    code: "CHC33021",
    title: "Certificate III in Individual Support",
    trainingPackage: "CHC Community Services",
    industry: "Aged & Disability Care",
    status: "superseded",
    licensingRefs: [],
  },
]

export const SEED_RTOS: Rto[] = [
  {
    id: "rto-1",
    legalName: "Demo Skills College Pty Ltd",
    tradingName: "Demo Skills College",
    rtoCode: "DEMO1",
    cricosCode: "DEMO01A",
    contacts: [{ name: "Demo Contact", role: "Enrolments", email: "enrol@demo-rto.example", phone: "02 0000 0001" }],
    status: "active",
    complianceNote: "Preview record — verify against training.gov.au at migration.",
    website: "https://example.invalid",
  },
  {
    id: "rto-2",
    legalName: "Demo Trade Institute Pty Ltd",
    tradingName: "Demo Trade Institute",
    rtoCode: "DEMO2",
    cricosCode: null,
    contacts: [{ name: "Demo Liaison", role: "Partnerships", email: "partner@demo-rto.example", phone: "02 0000 0002" }],
    status: "active",
    complianceNote: "Preview record — verify against training.gov.au at migration.",
    website: "https://example.invalid",
  },
  {
    id: "rto-3",
    legalName: "Demo Care Academy Pty Ltd",
    tradingName: "Demo Care Academy",
    rtoCode: "DEMO3",
    cricosCode: null,
    contacts: [],
    status: "at-risk",
    complianceNote: "Preview record flagged at-risk for UI testing.",
    website: "https://example.invalid",
  },
]

export const SEED_AGENTS: Agent[] = [
  { id: "ag-sales-1", name: "Demo Closer One", type: "sales_closing", contact: "sales1@example.invalid", commissionRule: "10% of margin", active: true },
  { id: "ag-sales-2", name: "Demo Closer Two", type: "sales_closing", contact: "sales2@example.invalid", commissionRule: "Fixed per order", active: true },
  { id: "ag-src-1", name: "Demo Source Agent", type: "certificate_source", contact: "source@example.invalid", commissionRule: "Wholesale schedule", active: true },
  { id: "ag-rto-1", name: "Demo RTO Liaison", type: "rto_contact", contact: "liaison@example.invalid", commissionRule: "N/A", active: true },
  { id: "ag-src-2", name: "Old Source (Inactive)", type: "certificate_source", contact: "old@example.invalid", commissionRule: "Legacy", active: false },
]

export const SEED_ROUTES: SupplierRoute[] = [
  { id: "sr-1", qualificationId: "q-aur32120", sourceAgentId: "ag-src-1", rtoId: "rto-1", wholesaleCost: 700, currency: "AUD", effectiveFrom: "2026-07-01", effectiveTo: null, status: "active" },
  { id: "sr-2", qualificationId: "q-aur32120", sourceAgentId: "ag-src-1", rtoId: "rto-2", wholesaleCost: 750, currency: "AUD", effectiveFrom: "2026-07-01", effectiveTo: null, status: "active" },
  { id: "sr-3", qualificationId: "q-cpc30220", sourceAgentId: "ag-src-1", rtoId: "rto-2", wholesaleCost: 900, currency: "AUD", effectiveFrom: "2026-08-01", effectiveTo: null, status: "active" },
  { id: "sr-4", qualificationId: "q-sit30821", sourceAgentId: "ag-src-1", rtoId: "rto-1", wholesaleCost: 650, currency: "AUD", effectiveFrom: "2026-09-01", effectiveTo: null, status: "active" },
  { id: "sr-5", qualificationId: "q-aur32120", sourceAgentId: "ag-src-2", rtoId: "rto-1", wholesaleCost: 680, currency: "AUD", effectiveFrom: "2025-01-01", effectiveTo: "2026-06-30", status: "expired" },
  { id: "sr-6", qualificationId: "q-chc33021", sourceAgentId: "ag-src-1", rtoId: "rto-3", wholesaleCost: 800, currency: "AUD", effectiveFrom: "2026-01-01", effectiveTo: null, status: "active" },
]
