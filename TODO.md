# Skills Connect Admin — Implementation To-Do List

## Source Requirements (audited)
- `C:\Users\Rony\Downloads\Based on this, give me docs for the developer for....docx` (v5.1)
- `C:\Users\Rony\Downloads\Yes.docx` (v5.0)

## Validation Commands (run after each task)
- `npm run lint` — oxlint (warnings OK, no errors)
- `npm run typecheck` — next typegen && tsc --noEmit
- `npm test` — vitest run (must pass all)

## Current State (per comprehensive audit)
Phases 1 (portal UIs) is now **IMPLEMENTED**. Phase 3 (application pipeline UI) and Phase 2 (candidates directory UI) are **NOT implemented**. Phase 4 and 5 are **partially implemented** (data/API layer done, UI gaps remain). Phase 6 is complete.

---

## ✅ PHASE 1 — 5-Portal Architecture & Portal UI Shells (COMPLETED)

Requirements from docs v5.1 §1 and v5.0 §1: 5 isolated portals — /admin (Super Admin), /ops (Ops Admin & Accounts), /sales (Internal Sales), /partner (External B2B Broker), /applicant (Candidate Portal).

- [x] Create `/admin` portal page — full platform control, master RTO/Partner costs, RBAC permissions, audit logs, true net profit analytics
- [x] Create `/ops` portal page — Ops Admin: verify 100-point ID/evidence, lodge portfolios with RTOs, upload final certificates; Accounts: B2B/B2C invoicing, payment reconciliation, RTO supplier bills, BDC commission payouts, QuickBooks sync
- [x] Create `/sales` portal page — In-house BDC/sales agents: Level 1 quick lead intake, Level 2 assisted enrolment, quote B2C retail prices, track personal pipeline, view commission ledger
- [x] Create `/partner` portal page — External B2B brokers: submit Level 1 & Level 2 B2B applications, view assigned fixed wholesale price list, track candidate progress, download certificates, pay wholesale invoices
- [x] Create `/applicant` portal page — Candidates/students: passwordless magic-link login, Level 2 AVETMISS/USI form, upload RPL evidence & 100-point ID, track progress bar, download certificate
- [x] Portal redirect enforcement — unauthorized URL navigation (e.g., SALES_BDC typing /admin) redirects to permitted portal via `RequirePortal` guard
- [x] Role → portal mapping UI enforcement (ROLE_PORTAL already exists in permissions.ts, wired to all portal pages)

Files created:
- `src/app/(app)/admin/page.tsx` — Super Admin portal
- `src/app/(app)/ops/page.tsx` — Ops Admin & Accounts portal
- `src/app/(app)/sales/page.tsx` — Sales/BDC portal
- `src/app/(app)/partner/page.tsx` — External Broker portal
- `src/app/applicant/layout.tsx` — Candidate portal (already existed with RequirePortal)

All portals wrapped in `RequirePortal` which uses `portalRedirectFor()` from `src/lib/route-guard.ts` to redirect unauthorized users to their permitted portal.

## 🔴 PHASE 2 — Candidates Directory & 1-Candidate-Many-Applications Model (NOT STARTED)

Requirements from docs v5.1 §2 Module 2 and v5.0 §6.

- [ ] Create Candidates Directory UI (`/candidates`) — master student profiles with legal name, DOB, gender, addresses, emergency contacts, AVETMISS demographic profile
- [ ] Reusable USI Verification UI — store 10-character USI number, verification status (Verified By, Date), USI application consent authority (Town/City of Birth + ID document metadata)
- [ ] Master 100-Point ID Vault UI — store verified identity documents at candidate level that auto-populate into future applications:
  - [ ] 70 Points: Passport, Citizenship Certificate, Birth Certificate
  - [ ] 40 Points: Australian Driver's Licence, Government Photo ID
  - [ ] 35 Points: Work ID Card
  - [ ] 25 Points: Medicare Card, Credit Card, Utility Bill, Bank Statement, Rental Lease Agreement, Foreign Driver's Licence
  - [ ] 20 Points: Student ID
- [ ] 1 Candidate → Many Applications relational model — repeat students never re-upload identity records
- [ ] Client API already exists (`/api/clients/*`) — wire to UI views

## 🔴 PHASE 3 — Applications Pipeline UI (Level 1 & Level 2 AVETMISS) (NOT STARTED)

Requirements from docs v5.1 §2 Module 3 and v5.0 §6. Backend API exists but NO UI.

- [ ] Level 1 Quick Lead Intake UI (DRAFT status) — Legal Given Names, Family Name, Email, Mobile, Interested Qualification, Issuing RTO/Partner (auto-filtered from synced scopes)
- [ ] Magic Link trigger on DRAFT creation — send passwordless Magic Link via Email & SMS to /applicant
- [ ] Level 2 5-Step AVETMISS & RPL Vault UI:
  - [ ] Step 1 — Course & Delivery: Enrolment Type (RPL/Full Fee/Government Funded), Delivery Mode (Work Based/RPL/Classroom/Online), Credit Transfer flag, Intake Date
  - [ ] Step 2 — Personal & USI Verification: Legal Name, DOB, Residential Address, Postal Address, Emergency Contact, inline USI verification or RTO USI application consent
  - [ ] Step 3 — AVETMISS Demographics: Citizenship/Residency, Country of Birth, Language at home & English proficiency, Indigenous status, Disability flags, Highest school level, Employment status, Study reason
  - [ ] Step 4 — RPL Checklist & Live 100-Point ID Vault: Real-time 100-Point ID counter (blocks RECEIVED until 100 points), upload slots for Academic Certificates, Resume, 2 Referee Letters, Work Samples/Portfolio, USI VET Transcript, Visa Copy
  - [ ] Step 5 — Policies & Digital E-Signature: Emergency Medical Indemnity, Media Consent, Refund/Cancellation Policy, NCVER Privacy Notice, Electronic Student Signature + Date, Parent/Guardian Signature (if under 18)
- [ ] Missing Docs & Progress Bar UI — dynamic completion percentage, missing document badges in /applicant, /sales, /partner, /ops, automated SMS/Email reminders
- [ ] Pipeline Status Workflow UI — DRAFT → RECEIVED → IN_PROGRESS → DELIVERED → ON_HOLD/CANCELLED with status_reason_note for ON_HOLD/CANCELLED
- [ ] Auto-attach RTO enrolment kit on application creation (from rto_qualification_scopes / enrolment_kits collections)

## 🟡 PHASE 4 — Qualifications, RTOs & Bidirectional Sync (PARTIALLY COMPLETE)

Data layer and APIs complete. UI gaps remain.

- [ ] Qualifications UI — already exists (`src/views/qualifications.tsx`) but missing:
  - [ ] Click Course → View Mapped Colleges side-by-side comparison table (every mapped Issuing RTO, Intermediary Partner GMQ/Educube/ACL, delivery mode, RTO enrolment kit, role-appropriate pricing)
  - [ ] Training package tag filtering (CHC, AUR, BSB, CPC, CPP, HLT, ICT, FNS, TLI, SIS)
  - [ ] Bundle (is_bundle) badge/display for dual qualifications
- [ ] RTOs UI — already exists (`src/views/rtos.tsx`) but missing:
  - [ ] True RTO Base Cost display on RTO detail
  - [ ] Intermediary partner (GMQ, Educube, ACL) association display
- [ ] Qualification Scopes UI — exists (`src/views/scopes.tsx`) ✅
- [ ] Enrolment Kits UI — exists (`src/views/enrolment-kits.tsx`) ✅
- [ ] Bidirectional sync UI — updates in Qualifications screen reflect immediately in RTO screen and vice versa (data layer shares composite key; UI needs to reflect this)
- [ ] Provider-First Filter — filter RTOs & Partners by Course Code/Name/Training Package, sortable by lowest True RTO Base Cost (Super Admin/Accounts)
- [ ] Live Application Dropdown Sync — selecting qualification on Create Application form filters Issuing RTO/Partner dropdown and auto-fills matching price layer for user's role

## 🟡 PHASE 5 — Sidebar, Finance & Ops UI (PARTIALLY COMPLETE)

Sidebar structure complete. Some UI views missing.

- [ ] Sidebar navigation — already complete (`src/components/layout/nav.ts` with 9 sections) ✅
- [ ] 301 legacy redirects — already complete (`next.config.ts`) ✅
- [ ] Dashboard page (`/dashboard`) — referenced in ROUTE_PERMISSIONS but NO page component exists
- [ ] QuickBooks connection management UI — API routes exist (`/api/integrations/quickbooks/*`) but no UI for connect/disconnect/status
- [ ] Ops Admin: RTO Processing UI — already exists (`/api/rto-processing/*`) but no dedicated view
- [ ] Ops Admin: Certificate Deliveries UI — already exists (`/api/certificate-deliveries/*`) but no dedicated view
- [ ] Finance page — already exists (`src/views/finance.tsx`) ✅
- [ ] Commission Rules/Records/Payouts UI — already exists ✅
- [ ] BDC Commission Ledger UI — already exists (`src/views/bdc-commission-ledger.tsx`) ✅
- [ ] External Agents UI — already exists (`src/views/external-agents.tsx`) ✅

## ✅ PHASE 6 — Testing & QA (COMPLETE)

All QA checklist items implemented and tested:
- [x] Route guard penetration testing (403 for unauthorized roles)
- [x] Payload inspection / zero margin leakage (financial field masking)
- [x] B2B candidate isolation (EXTERNAL_BROKER channel hides all pricing/invoices)
- [x] 100-Point ID gate (RECEIVED blocked when < 100)
- [x] Immutable snapshot verification (snapshots locked on RECEIVED)
- [x] 399/399 tests passing

## 🟢 PHASE 7 — Production Readiness (NOT STARTED)

- [ ] End-to-end smoke tests across all 9 sidebar sections
- [ ] Performance benchmarks on large order lists
- [ ] Accessibility audit (WCAG AA) on all forms and tables
- [ ] Error boundary coverage for all API routes
- [ ] Deployment checklist and rollback procedure
- [ ] API version prefix `/api/v1/` (docs specify `/api/v1/` but routes use `/api/`)

## 🔧 SECURITY GAP (CRITICAL)

- [ ] Apply `applyFinancialVisibility()` masking to ALL financial API routes, not just `/api/orders`
  - Currently only orders GET applies masking
  - Missing: `/api/scopes`, `/api/masters/supplier-routes`, `/api/invoices`, `/api/payments`, `/api/commission-*`, `/api/enrolment-kits`
  - This creates margin leakage for SALES_BDC and EXTERNAL_BROKER roles on unmasked endpoints

---

## How to Resume Work (for future sessions)

1. Open terminal in `C:\Skills-Connect-Admin`
2. Read this `TODO.md` file to see current phase status
3. Run validation: `npm run lint`, `npm run typecheck`, `npm test`
4. Start with Phase 1 (5-Portal Architecture & Portal UI Shells)
5. After each task, update this TODO.md (mark item as completed) and run lint + typecheck + tests
6. Commit and push to `origin/rony-dev` after each phase

## Key Files Reference
- `src/lib/types.ts` — Core entity types (roles, order, pricing, statuses)
- `src/lib/permissions.ts` — RBAC matrix, ROLE_PORTAL, ROUTE_PERMISSIONS
- `src/lib/financial-visibility.ts` — 4-layer pricing visibility matrix
- `src/lib/dto-sanitizer.ts` — Backend financial field stripping
- `src/middleware/auth.ts` — Auth middleware, checkOrderAccess, maskFinancialFields
- `src/components/layout/nav.ts` — NAV_SECTIONS (9 grouped menus)
- `next.config.ts` — 301 legacy path redirects
- `src/app/(app)/` — Page routes (provider, finance, settings, etc.)
- `src/views/` — React view components
- `tests/` — 30 test files, 399 tests
