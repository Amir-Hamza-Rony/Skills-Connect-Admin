# 06 — Implementation Roadmap (vs Boss Reference Documents)

**Based on the corrected gap analysis (03-REQUIREMENT-GAP-ANALYSIS.md v2) using the actual boss reference documents.**
**All work must be done on the existing MongoDB architecture (no database migration unless business explicitly requires it).**
**No source code or database modifications are permitted during this audit phase.**

---

## Phase 0: Role System & Security Foundation (Weeks 1-2)

**Objective:** Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping.

### Required Features
- 4 boss roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT
- User fields: full_name, b2b_tier, default_commission_pct, agency_name
- Column-level visibility: partner_cost_price hidden from BDC/B2B_AGENT; bdc_base/standard price hidden from B2B_AGENT; b2b tier price hidden from BDC
- Data scoping: BDC sees own B2C enrollments only; B2B Agent sees own agency enrollments only
- Admin sees all enrollments

### Dependencies
- Existing auth infrastructure (JWT, refresh tokens, `withAuth` middleware)

### Backend Tasks
1. Replace `RoleName` union in `src/lib/types.ts:7` with 4 boss roles
2. Replace `ROLE_PERMISSIONS` in `src/lib/permissions.ts:12-66` with 4-role matrix
3. Replace `ROUTE_PERMISSIONS` in `src/lib/permissions.ts:76-94`
4. Update `GET /api/auth/permissions` (`src/app/api/auth/permissions/route.ts`)
5. Add `b2b_tier`, `default_commission_pct`, `agency_name`, `full_name` to User type and API
6. Implement column-level field masking middleware (strip partner_cost_price for non-Admin)
7. Implement data scoping middleware (filter enrollments by bdc_id/b2b_agent_id)
8. Create MongoDB unique indexes: users.email

### Frontend Tasks
1. Update default view routing in `src/views/dashboard.tsx:81-90`
2. Update role-based UI visibility for 4 roles
3. Update navigation permissions

### Database Tasks
1. Create unique index on users.email

### Security Requirements
- Column-level field masking at API level (not just UI)
- Data scoping at API query level (BDC/B2B Agent cannot see other users' enrollments)
- Super Admin bypasses all checks

### Testing Requirements
- Unit test: role-based field masking returns correct fields per role
- Unit test: data scoping returns correct subset per role
- Integration test: BDC cannot see another BDC's enrollments
- Integration test: B2B Agent cannot see another agency's enrollments
- Integration test: Admin can see all enrollments

### Acceptance Criteria
- Only 4 roles exist in system
- BDC user logs in and sees only their own B2C enrollments
- B2B Agent user logs in and sees only their own agency's enrollments
- Partner cost and net profit hidden from BDC/B2B_AGENT API responses
- BDC Base & Standard price hidden from B2B_AGENT

### Complexity: Medium
### Business Decisions: None required

---

## Phase 1: Student & Enrollment Core (Weeks 2-4)

**Objective:** Replace Client/Order entities with Student/Enrollment entities per boss spec.

### Required Features
- Student entity: first_name, last_name, email, phone, usi_number, visa_status, referred_by_student_id, external_referrer_name
- Enrollment entity: enrollment_code (unique, human-readable), channel_type ('B2C_BDC'/'B2B_AGENT'), bdc_id, b2b_agent_id, rpl_partner_id, status (8 boss statuses), offered_price, partner_cost_snapshot, gross_profit, net_profit, payment_status (4 statuses)
- Enrollment status lifecycle: LEAD → DISCOUNT_APPROVAL → DOCS_PENDING → ADMIN_REVIEW → SENT_TO_PARTNER → SENT_TO_RTO → CERTIFIED → CANCELLED

### Dependencies
- Phase 0 (roles and permissions)

### Backend Tasks
1. Create `students` collection with boss-spec fields
2. Create `enrollments` collection replacing `orders`
3. Add `enrollment_code` generation (unique, human-readable, e.g., SC-2026-1042)
4. Add `channel_type` field ('B2C_BDC' or 'B2B_AGENT')
5. Add `bdc_id`, `b2b_agent_id` fields (UUID refs to users)
6. Add `gross_profit`, `net_profit` fields (calculated server-side)
7. Replace 23 order statuses with boss's 8 enrollment statuses
8. Replace 6 payment statuses with boss's 4 (UNPAID/PARTIAL/PAID/REFUNDED)
9. Update `POST /api/enrollments` (replaces `POST /api/orders`)
10. Update `PATCH /api/enrollments/[id]/status` with new status transitions
11. Server-side gross_profit = offered_price - partner_cost_snapshot
12. Server-side net_profit = gross_profit - total_commissions

### Frontend Tasks
1. Replace `src/views/clients.tsx` with Student view
2. Replace `src/views/orders.tsx` with Enrollment view
3. Add USI, visa status, referral fields to student form
4. Add channel_type selector to enrollment form
5. Display enrollment_code on enrollment list/detail

### Database Tasks
1. Create `students` collection
2. Create `enrollments` collection (replace `orders`)
3. Unique index on enrollments.enrollment_code
4. Index on students.email, students.usiNumber

### Security Requirements
- USI number is sensitive PII — restrict visibility to authorized roles
- Enrollment code must be unique
- gross_profit/net_profit calculated server-side only

### Testing Requirements
- Unit test: enrollment code uniqueness
- Unit test: gross_profit/net_profit calculation
- Integration test: student creation with USI and visa status
- Integration test: enrollment creation with channel_type and bdc_id/b2b_agent_id
- Integration test: status transition follows boss's 8-status lifecycle

### Acceptance Criteria
- Student profile includes USI number and visa status
- Enrollment includes enrollment_code and channel_type (B2C_BDC/B2B_AGENT)
- Enrollment codes are unique
- gross_profit and net_profit calculated server-side and stored
- Status lifecycle follows boss's 8 statuses

### Complexity: High
### Business Decisions:
- Enrollment code format (e.g., "SC-2026-1042")
- Whether to keep existing `orders` collection alongside new `enrollments` during transition

---

## Phase 2: Dynamic Pricing Engine (Weeks 4-6)

**Objective:** Replace PriceList + SupplierRoute with qualification_pricing per boss spec.

### Required Features
- qualification_pricing: qualification_id, rpl_partner_id, partner_cost_price (Admin only), bdc_base_price, bdc_standard_price, b2b_silver_price, b2b_gold_price (NULL), effective_from, currency
- Constraint: bdc_standard_price >= bdc_base_price
- Unique: (qualification_id, rpl_partner_id, effective_from)
- BDC quotes between Base & Standard price (read-only, enforces floor)
- B2B Agent sees assigned tier price only (Silver/Gold/Platinum → Silver price for Platinum)
- partner_cost_price hidden from BDC/B2B_AGENT

### Dependencies
- Phase 0 (roles and permissions)
- Phase 1 (enrollment entity)

### Backend Tasks
1. Create `qualification_pricing` collection replacing `price_lists` + `supplier_routes`
2. Add all 5 price columns + currency + effective_from
3. Add bdc_standard_price >= bdc_base_price constraint
4. Add unique constraint on (qualification_id, rpl_partner_id, effective_from)
5. Server-side price resolution: B2C uses bdc_base/bdc_standard, B2B uses tier price based on user's b2b_tier
6. Column-level masking: strip partner_cost_price from BDC/B2B_AGENT responses
7. Column-level masking: strip bdc_base/standard_price from B2B_AGENT responses
8. Column-level masking: strip b2b_silver/gold_price from BDC responses

### Frontend Tasks
1. Replace `src/views/price-lists.tsx` with qualification pricing view
2. Replace `src/views/pricing.tsx` (supplier routes) with partner pricing view
3. Add tier selector (Silver/Gold/Platinum) to pricing form
4. Add base/standard price fields for BDC pricing
5. Add partner cost field (Admin only)

### Database Tasks
1. Create `qualification_pricing` collection
2. Unique index on (qualificationId, rplPartnerId, effectiveFrom)

### Security Requirements
- partner_cost_price visible only to Admin/SUPER_ADMIN
- bdc_base/standard_price visible only to Admin/SUPER_ADMIN/BDC (read-only for BDC)
- b2b_silver/gold_price visible only to Admin/SUPER_ADMIN/B2B_AGENT (read-only for B2B_AGENT)

### Testing Requirements
- Unit test: tier-based price resolution (Silver/Gold/Platinum)
- Unit test: bdc_standard_price >= bdc_base_price constraint
- Integration test: B2C enrollment uses bdc_standard_price
- Integration test: B2B enrollment uses tier price based on agent's b2b_tier
- Integration test: partner_cost_price stripped from BDC/B2B_AGENT API responses

### Acceptance Criteria
- B2B Silver/Gold/Platinum tiers produce different prices (Platinum = Silver price, no b2b_gold_price column)
- BDC base price != standard price
- Partner cost hidden from non-Admin roles
- Pricing effective dates enforced

### Complexity: High
### Business Decisions:
- Whether Platinum tier gets b2b_gold_price or falls back to Silver (boss spec: b2b_gold_price is NULL, Platinum sees Silver)

---

## Phase 3: RPL Partners & RTOs (Weeks 6-7)

**Objective:** Replace separate agents + RTOs with combined rpl_partners_rtos table.

### Required Features
- rpl_partners_rtos: partner_name, rto_code, rto_name, submission_email (NOT NULL), is_active
- Combined entity (RPL Partner + issuing RTO in one table)
- submission_email for Admin dispatch

### Dependencies
- Phase 1 (enrollment entity with rpl_partner_id)

### Backend Tasks
1. Create `rpl_partners_rtos` collection replacing `agents` + `rtos`
2. Add submission_email field (NOT NULL)
3. Replace `POST /api/masters/agents` and `POST /api/masters/rtos` with `POST /api/rpl-partners-rtos`
4. Update enrollment creation to use rpl_partner_id instead of rtoId + sourceAgentId

### Frontend Tasks
1. Replace `src/views/agents.tsx` and `src/views/rtos.tsx` with RPL Partners & RTOs view
2. Add submission_email field to form
3. Update enrollment form to select RPL Partner/RTO instead of separate agent + RTO

### Database Tasks
1. Create `rpl_partners_rtos` collection
2. Index on partnerName, rtoCode

### Security Requirements
- Partner management requires Admin/SUPER_ADMIN

### Testing Requirements
- Unit test: RPL Partner creation with submission_email
- Integration test: enrollment creation references rpl_partner_id

### Acceptance Criteria
- RPL Partners & RTOs managed in single table
- submission_email captured for each partner
- Enrollment references rpl_partner_id

### Complexity: Medium
### Business Decisions: None required

---

## Phase 4: Document & Compliance Workflow (Weeks 7-9)

**Objective:** Implement checklist_templates, enrollment_documents, mandatory enforcement, 100-point ID.

### Required Features
- checklist_templates: qualification_id (NULL=global), document_name, description, is_mandatory, sort_order, id_points_value
- enrollment_documents: enrollment_id, checklist_item_id, file_url, file_name, uploaded_by_user_id, verification_status ('UPLOADED'/'APPROVED'/'REJECTED'), rejection_reason, verified_by_admin_id, uploaded_at, mime_type
- 100-point ID check with point values (70 Passport/Birth Cert, 40 Driver License, 25 Medicare/Utility)
- Mandatory checklist enforcement: block SENT_TO_PARTNER until all mandatory docs APPROVED
- PDF format validation for standard document packs
- Document types: 100 Points ID, USI & VET Transcript, Visa Copy, Resume, 2-Referee Letters, Trade Work Photos/Videos

### Dependencies
- Phase 1 (enrollment entity)
- Phase 3 (qualifications for checklist template linkage)

### Backend Tasks
1. Create `checklist_templates` collection
2. Create `enrollment_documents` collection replacing `documents`
3. Link enrollment_documents to checklist_templates via checklist_item_id
4. Add 100-point ID calculation logic
5. Implement mandatory checklist gate: `PATCH /api/enrollments/[id]/status` checks all mandatory docs APPROVED before allowing SENT_TO_PARTNER
6. Add verified_by_admin_id to document review
7. Add mime_type field; restrict to PDF for standard document packs
8. Document access logging for enrollment_documents

### Frontend Tasks
1. Replace `src/views/documents.tsx` with enrollment documents view
2. Add 100-point ID check UI with points calculator
3. Add checklist template management view
4. Block Partner submission button when mandatory docs not approved (with clear message)
5. Add Resume and Trade Video document types

### Database Tasks
1. Create `checklist_templates` collection
2. Create `enrollment_documents` collection
3. Indexes on checklist_templates.qualificationId, enrollment_documents.enrollmentId, enrollment_documents.checklistItemId

### Security Requirements
- Mandatory checklist enforcement at API level (not just UI)
- Document approval requires documents.review permission (Admin only)
- 100-point ID check results are sensitive

### Testing Requirements
- Unit test: 100-point ID calculation
- Unit test: checklist validation (all mandatory approved → allowed; any missing → blocked)
- Integration test: enrollment cannot transition to SENT_TO_PARTNER with unapproved mandatory docs
- Integration test: document approval unblocks Partner submission

### Acceptance Criteria
- 100-point ID check calculates correctly
- Enrollment cannot be sent to Partner until all mandatory documents approved
- USI verification workflow functional
- Video files can be uploaded (for trade courses)
- Qualification-specific checklist templates work

### Complexity: High
### Business Decisions:
- Which documents are "mandatory" vs "optional" per qualification
- 100-point ID point values per document type
- Whether to restrict uploads to PDF only (boss spec) or allow images (existing)

---

## Phase 5: Financial & Commission Engine (Weeks 9-11)

**Objective:** Implement payments with verification, commissions (BDC + referral), net profit.

### Required Features
- payments: enrollment_id, amount_paid, payment_method ('BANK_TRANSFER'/'STRIPE'/'CASH'/'B2B_INVOICE'), transaction_ref, paid_at, verified_by_admin_id
- Payment verification workflow: admin confirms funds clearance
- commissions: commission_type ('BDC_COMMISSION'/'REFERRAL_COMMISSION'), beneficiary_user_id, external_payee_name, amount, payout_status ('PENDING'/'ELIGIBLE'/'PAID'/'VOID')
- Commission payout workflow
- Net profit = gross_profit - (bdc_commission + referral_commission)

### Dependencies
- Phase 1 (enrollment entity with gross_profit/net_profit)
- Phase 0 (roles and permissions)

### Backend Tasks
1. Update `payments` collection: replace invoiceId with verified_by_admin_id; update payment_method enum
2. Add `POST /api/payments/[id]/verify` endpoint (verified_by_admin_id)
3. Create `commissions` collection replacing `commission_rules` + `commission_records`
4. Add commission_type enum (BDC_COMMISSION/REFERRAL_COMMISSION)
5. Add payout_status enum (PENDING/ELIGIBLE/PAID/VOID)
6. Server-side net_profit calculation: gross_profit - total_commissions
7. Commission eligibility rules (which enrollment statuses count)

### Frontend Tasks
1. Replace `src/views/finance.tsx` payment section with boss-spec payments view
2. Add payment verification UI (admin confirms funds)
3. Add commission management view (BDC + referral)
4. Add commission payout workflow
5. Display net_profit on finance dashboard

### Database Tasks
1. Update `payments` collection schema
2. Create `commissions` collection
3. Indexes on payments.enrollmentId, payments.verifiedByAdminId, commissions.enrollmentId, commissions.beneficiaryUserId

### Security Requirements
- Payment verification requires finance.manage or Admin
- Net profit visible only to Admin/SUPER_ADMIN
- Commission amounts visible only to authorized roles

### Testing Requirements
- Unit test: net profit formula
- Unit test: commission eligibility rules
- Unit test: payment verification state transitions
- Integration test: payment verification workflow end-to-end
- Integration test: commission calculation with eligibility rules

### Acceptance Criteria
- Payment can be verified by admin (verified_by_admin_id set)
- Net profit calculated server-side and stored on enrollment
- BDC and referral commissions calculated correctly
- Commission payout workflow (PENDING → ELIGIBLE → PAID)

### Complexity: High
### Business Decisions:
- Net profit formula (what counts as commissions to subtract?)
- Commission eligibility rules (which enrollment statuses count toward commission?)
- Referral commission percentage/formula

---

## Phase 6: Business Intelligence & Reporting (Weeks 11-12)

**Objective:** Implement BDC/B2B Agent performance reports, commission liabilities, net profit reports.

### Required Features
- BDC performance report (own B2C leads only)
- B2B Agent performance report (own agency students only, tier-filtered)
- Commission liabilities report (unpaid approved commissions)
- Net profit report by period
- Revenue report (gross profit)

### Dependencies
- Phase 5 (financial engine)
- Phase 0 (data scoping)

### Backend Tasks
1. Add `GET /api/reports/bdc-performance`
2. Add `GET /api/reports/b2b-agent-performance`
3. Add `GET /api/reports/commission-liabilities`
4. Add `GET /api/reports/net-profit`
5. All reports respect data scoping (BDC sees own, B2B sees own agency, Admin sees all)

### Frontend Tasks
1. Add BDC performance report to dashboard/reports
2. Add B2B Agent performance report
3. Add commission liabilities report view
4. Add net profit report view

### Database Tasks
1. Indexes for report queries (bdcId + status, b2bAgentId + status, etc.)

### Security Requirements
- BDC report visible only to BDC and Admin/SUPER_ADMIN
- B2B Agent report visible only to that agent and Admin/SUPER_ADMIN
- Commission liabilities visible only to Admin/SUPER_ADMIN

### Testing Requirements
- Unit test: report aggregation accuracy
- Integration test: report data matches source records

### Acceptance Criteria
- BDC performance report shows enrollment volume and revenue
- B2B Agent performance report shows referrals and commissions
- Commission liability report shows unpaid amounts
- Net profit report accurate per Phase 5 formula

### Complexity: Medium
### Business Decisions: None required

---

## Phase 7: Polish & Production Readiness (Weeks 12-14)

**Objective:** Pagination, server-side search, optimistic locking, final QA.

### Required Features
- Pagination on all list pages
- Server-side search
- Optimistic locking on enrollments and students
- Production readiness checklist

### Dependencies
- All previous phases

### Backend Tasks
1. Add pagination (`page`, `limit`) to all list APIs
2. Add server-side search (`search` param) to enrollments, students
3. Add `version` field to Enrollment and Student for optimistic locking
4. Add ETag/If-Match support on update endpoints

### Frontend Tasks
1. Add pagination controls to all list views
2. Add server-side search bars
3. Add conflict detection UI (optimistic locking errors)

### Testing Requirements
- Load test: pagination with 1000+ records
- Integration test: optimistic locking conflict detection

### Complexity: Medium
### Business Decisions: None required

---

## Phase Summary

| Phase | Objective | Weeks | Complexity | Business Decisions Required |
|-------|-----------|-------|------------|----------------------------|
| 0 | Role System & Security | 1-2 | Medium | None |
| 1 | Student & Enrollment Core | 2-4 | High | Enrollment code format |
| 2 | Dynamic Pricing Engine | 4-6 | High | Platinum tier fallback to Silver |
| 3 | RPL Partners & RTOs | 6-7 | Medium | None |
| 4 | Document & Compliance | 7-9 | High | Mandatory docs per qual, 100-point values, PDF-only |
| 5 | Financial & Commission | 9-11 | High | Net profit formula, commission eligibility, referral formula |
| 6 | BI & Reporting | 11-12 | Medium | None |
| 7 | Polish & Production | 12-14 | Medium | None |

**Total estimated duration: 12-14 weeks**

---

## Critical Path

Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7

Phase 0 (role system) is the critical foundation — without the 4 boss roles and data scoping, no subsequent phase can be securely implemented.

---

## First Recommended Implementation Milestone

**Milestone: Phase 0 — Role System & Security Foundation**

**Objective:** Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping.

**Why first:** Without the correct roles and data scoping, BDCs and B2B Agents cannot be securely isolated. All subsequent phases (student management, pricing, financial, documents) depend on this foundation. The existing 7-role system (Super Admin, Finance, Operations, Sales/Closing Agent, RTO/Sourcing Manager, Document Reviewer, Read Only/Manager) does not match the boss's 4-role model at all.

**Key tasks:**
1. Replace `RoleName` union in `src/lib/types.ts:7` with `SUPER_ADMIN`, `ADMIN`, `BDC`, `B2B_AGENT`
2. Replace `ROLE_PERMISSIONS` in `src/lib/permissions.ts` with 4-role matrix
3. Add `b2b_tier`, `default_commission_pct`, `agency_name`, `full_name` to User type
4. Implement column-level field masking middleware
5. Implement data scoping middleware for enrollment queries
6. Create unique index on users.email

**Estimated effort: 1-2 weeks**

**Business decisions required:** None for Phase 0 (standard RBAC pattern)

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines — all sections (§1–§6) including workflow, ER diagram, 10 table specs, DDL
- DOCX document: 706 lines — all sections (§1–§5) including data flow, visibility matrix, detailed specs, DDL

### Requirements Extracted from Each Document
**From MD document:** 4 roles (M-01), user fields incl. b2b_tier/default_commission_pct/agency_name (M-02), rpl_partners_rtos (M-03), qualifications (M-04), qualification_pricing with 5 price columns + currency + effective_from (M-05), students with USI/visa/referral (M-06), enrollments with enrollment_code/channel_type/bdc_id/b2b_agent_id/gross_profit/net_profit/8 statuses/4 payment statuses (M-07), payments with verified_by_admin_id (M-08), commissions with 2 types + 4 payout statuses (M-09), checklist_templates with is_mandatory/sort_order (M-10), enrollment_documents with verification workflow (M-11), workflow gate blocking partner submission (M-12), column-level masking (M-13), PostgreSQL DDL (M-14).

**From DOCX document:** End-to-end B2C/B2B data flow (D-01), 100-Point ID verification (D-02), mandatory checklist enforcement (D-03), Role-Based Visibility Matrix (D-04), submission_email NOT NULL (D-05), delivery_mode/requires_trade_media on qualifications (D-06), visa_status on students (D-07), enrollment code SC-2026-1042 without DISCOUNT_APPROVAL (D-08), id_points_value on checklist templates (D-09), mime_type/PDF validation on documents (D-10), pgcrypto DDL with CHECK constraints (D-11).

### Differences from Previous Audit
- Document paths corrected from "project root" to `docs_reference/`
- Roadmap phases already based on boss documents; verified all phase dependencies against actual source files
- Phase 0 confirmed as correct first milestone (no business decisions required; unblocks all subsequent phases)

### Final Requirement Coverage Statistics
| Status | Count | Percentage |
|--------|-------|------------|
| IMPLEMENTED | 5 | 10% |
| PARTIALLY IMPLEMENTED | 17 | 35% |
| MISSING | 26 | 54% |
| NOT VERIFIED | 0 | 0% |
| REQUIRES BUSINESS APPROVAL | 10 | N/A (decisions) |
| **Total assessed** | **48** | **100%** |

### Recommended First Implementation Milestone
**Phase 0 — Role System & Security Foundation** (Weeks 1-2)
Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping. Key tasks: replace `RoleName` union in `src/lib/types.ts:7`, replace `ROLE_PERMISSIONS` in `src/lib/permissions.ts`, add `b2b_tier`/`default_commission_pct`/`agency_name`/`full_name` to User type, implement field masking middleware, implement data scoping middleware, create unique index on users.email. Estimated effort: 1-2 weeks. No business decisions required.
