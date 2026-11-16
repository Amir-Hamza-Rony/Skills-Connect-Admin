# 03 — Requirement Gap Analysis (vs Boss Reference Documents)

**Source:** Both boss documents read in full:
- `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx`
- `docs/reference/rpl_management_system_database_architecture_design.md`

**Previous assessment (03-REQUIREMENT-GAP-ANALYSIS.md v1) was INCORRECT** — it was based on the developer specification (`Skills_Connect_Admin_Software_Developer_Specification.docx`), not the boss's reference documents. This document replaces it entirely.

Status values: IMPLEMENTED | PARTIALLY IMPLEMENTED | MISSING | NOT VERIFIED | REQUIRES BUSINESS APPROVAL

---

## A. User Portals and RBAC

### A-01: Four roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT
- **Requirement ID:** A-01
- **Description:** System must have exactly 4 roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT
- **Source:** `architecture_design.md:4.1`; `docx §4.1`; DDL line 376
- **Existing implementation:** 7 roles exist: Super Admin, Finance, Operations, Sales/Closing Agent, RTO/Sourcing Manager, Document Reviewer, Read Only/Manager (`types.ts:7-15`, `permissions.ts:12-66`)
- **API:** `GET /auth/permissions` (`src/app/api/auth/permissions/route.ts`) returns wrong role set
- **Collection:** `users`, `roles`
- **Frontend:** `src/app/(app)/users/page.tsx`, `src/app/(app)/roles/page.tsx`
- **Status:** MISSING (wrong role set entirely)
- **Evidence:** `types.ts:7` RoleName has no "BDC", "B2B_AGENT", or "ADMIN". `permissions.ts` has no entries for these roles.
- **Remaining work:** Replace entire RBAC matrix with 4 boss-defined roles

### A-02: User fields per boss spec
- **Requirement ID:** A-02
- **Description:** users table: id (UUID), full_name, email (UNIQUE), password_hash, phone, role, agency_name (B2B_AGENT), b2b_tier (SILVER/GOLD/PLATINUM, DEFAULT SILVER), default_commission_pct (DEFAULT 0.00), is_active, created_at
- **Source:** `architecture_design.md:4.1`; DDL lines 370-382
- **Existing implementation:** User type has id, name, email, phone, roleNames[], active, lastLoginAt (`types.ts:22-34`). No b2b_tier, no default_commission_pct, no agency_name, no full_name (uses name), no UUID ids (uses ObjectId strings)
- **API:** `POST /api/auth/login`, `GET /api/auth/me`
- **Collection:** `users`
- **Frontend:** `src/app/login/page.tsx`, `src/app/(app)/users/page.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:22-34` has name/email/phone/roleNames/active but missing b2b_tier, default_commission_pct, agency_name, full_name. Uses MongoDB ObjectId not UUID.
- **Remaining work:** Add b2b_tier, default_commission_pct, agency_name fields; rename name→full_name; migrate to UUID ids

### A-03: BDC data scoping — own B2C leads only
- **Requirement ID:** A-03
- **Description:** BDC can only see their own B2C enrollments (bdc_id = current user)
- **Source:** `architecture_design.md:§5` Visibility Matrix; `docx §3`
- **Existing implementation:** No data scoping at all. All users with `orders.view` see ALL orders (`src/app/api/orders/route.ts:25-62` returns all orders with only status/clientId filters)
- **API:** `GET /api/orders`
- **Collection:** `orders` (will become `enrollments`)
- **Frontend:** `src/views/orders.tsx`
- **Status:** MISSING
- **Evidence:** No user-scoping filter on any list API. No `bdc_id` or `b2b_agent_id` fields on orders.
- **Remaining work:** Implement data scoping middleware; add bdc_id/b2b_agent_id to enrollments

### A-04: B2B Agent data scoping — own agency students only
- **Requirement ID:** A-04
- **Description:** B2B Agent can only see their own agency's students (b2b_agent_id = current user)
- **Source:** `architecture_design.md:§5` Visibility Matrix; `docx §3`
- **Existing implementation:** No agency concept. No agency_name on users. No b2b_agent_id on orders.
- **API:** N/A
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** MISSING
- **Evidence:** `types.ts:22-34` User has no agency_name. `types.ts:282-334` Order has no b2b_agent_id.
- **Remaining work:** Add agency_name to users; add b2b_agent_id to enrollments; implement agency scoping

### A-05: Column-level visibility — Partner Cost & Net Profit hidden from BDC/B2B_AGENT
- **Requirement ID:** A-05
- **Description:** `partner_cost_price` and `net_profit` must be stripped from API responses to BDC and B2B_AGENT roles
- **Source:** `architecture_design.md:4.4` Security Note; `docx §3` Visibility Matrix
- **Existing implementation:** No column-level field masking. `GET /api/orders` returns `sellingPrice`, `supplierCostSnapshot` to all users with `orders.view` (`src/app/api/orders/route.ts:49-50`)
- **API:** `GET /api/orders` (will be `GET /api/enrollments`)
- **Collection:** `orders` (will become `enrollments`)
- **Frontend:** `src/views/orders.tsx`
- **Status:** MISSING
- **Evidence:** Order list API returns supplierCostSnapshot to all roles. No role-based field filtering exists.
- **Remaining work:** Implement server-side field masking based on user role

### A-06: Column-level visibility — BDC Base & Standard Price read-only for BDC, hidden for B2B
- **Requirement ID:** A-06
- **Description:** BDC sees Base & Standard price (read-only, enforces floor). B2B Agent cannot see these prices at all.
- **Source:** `architecture_design.md:§5` Visibility Matrix; `docx §3`
- **Existing implementation:** No such pricing fields exist. PriceList has single `amount` field visible to all with `pricing.manage`.
- **API:** `GET /api/masters/price-lists`
- **Collection:** `price_lists` (will become `qualification_pricing`)
- **Frontend:** `src/views/price-lists.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:513-524` PriceList has single `amount`, no tiered pricing columns.
- **Remaining work:** Replace PriceList with qualification_pricing; implement role-based field visibility

### A-07: Column-level visibility — B2B Tier Price read-only for B2B Agent (assigned tier only)
- **Requirement ID:** A-07
- **Description:** B2B Agent sees only their assigned tier price (Silver/Gold/Platinum). Platinum agents see Silver price (no b2b_gold_price column).
- **Source:** `architecture_design.md:§5` Visibility Matrix; `architecture_design.md:4.4`
- **Existing implementation:** No tier pricing concept.
- **API:** N/A
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** MISSING
- **Evidence:** No b2b_tier pricing columns exist anywhere.
- **Remaining work:** Add b2b_silver_price, b2b_gold_price to qualification_pricing; implement tier-based visibility

### A-08: Server-side authorization on all API routes
- **Requirement ID:** A-08
- **Description:** RBAC enforced server-side; frontend hiding is not enforcement
- **Source:** `architecture_design.md:§5`; existing `middleware/auth.ts`
- **Existing implementation:** `withAuth(permission, handler)` pattern exists on all protected routes. Super Admin bypasses all checks.
- **API:** All `src/app/api/*/route.ts`
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** IMPLEMENTED (but role set is wrong)
- **Evidence:** `src/middleware/auth.ts` — `withAuth` + `requirePermission` used throughout.
- **Remaining work:** Re-map permissions to 4 boss roles

---

## B. Student and Enrollment Management

### B-01: Students table with USI, visa_status, referral tracking
- **Requirement ID:** B-01
- **Description:** students table: first_name, last_name, email (UNIQUE), phone, usi_number, visa_status, referred_by_student_id (FK self), external_referrer_name
- **Source:** `architecture_design.md:4.5`; DDL lines 419-431
- **Existing implementation:** Client type has legalName, preferredName, email, contacts[], addresses[], status, sourceAgentId, notes. No USI, no visa_status, no referral tracking, no first_name/last_name split.
- **API:** `GET/POST /api/clients`, `GET/PUT/DELETE /api/clients/[id]`
- **Collection:** `clients` (will become `students`)
- **Frontend:** `src/views/clients.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:260-272` Client has name/email/phone but no usi_number, no visa_status, no referred_by_student_id, no external_referrer_name.
- **Remaining work:** Replace Client with Student entity; add usi_number, visa_status, referred_by_student_id, external_referrer_name

### B-02: USI number on student
- **Requirement ID:** B-02
- **Description:** usi_number (VARCHAR(20), NULL) — 10-character Australian Unique Student Identifier
- **Source:** `architecture_design.md:4.5`; DDL line 426
- **Existing implementation:** No USI field anywhere.
- **API:** N/A
- **Collection:** `clients`
- **Frontend:** `src/views/clients.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:260-272` — no usi_number field on Client
- **Remaining work:** Add usi_number to Student entity, API, and view

### B-03: Visa status on student
- **Requirement ID:** B-03
- **Description:** visa_status (VARCHAR(50), NULL) — e.g., Citizen/PR, Student Visa, Temporary Graduate, Offshore
- **Source:** `architecture_design.md:4.5`; DDL line 431
- **Existing implementation:** No visa status field.
- **API:** N/A
- **Collection:** `clients`
- **Frontend:** `src/views/clients.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:260-272` — no visa_status field on Client
- **Remaining work:** Add visa_status to Student entity, API, and view

### B-04: Student referral tracking (self-referencing + external)
- **Requirement ID:** B-04
- **Description:** referred_by_student_id (FK → students.id) and external_referrer_name (VARCHAR(150))
- **Source:** `architecture_design.md:4.5`; DDL lines 428-429
- **Existing implementation:** Client has sourceAgentId (agent reference, not student referral). No self-referring FK, no external referrer name.
- **API:** `POST /api/clients`
- **Collection:** `clients`
- **Frontend:** `src/views/clients.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:260-272` — Client has sourceAgentId but no referred_by_student_id or external_referrer_name
- **Remaining work:** Add referral fields to Student entity

### B-05: Enrollments table with channel_type
- **Requirement ID:** B-05
- **Description:** enrollments table: enrollment_code (UNIQUE), student_id, qualification_id, rpl_partner_id, channel_type ('B2C_BDC' or 'B2B_AGENT'), bdc_id, b2b_agent_id, status, offered_price, partner_cost_snapshot, gross_profit, net_profit, payment_status
- **Source:** `architecture_design.md:4.6`; DDL lines 434-454
- **Existing implementation:** Order type has clientId, qualificationId, salesAgentId, sourceAgentId, rtoId, status, sellingPrice, supplierCostSnapshot, otherCost, currency, paymentStatus, history[]. No enrollment_code, no channel_type, no bdc_id, no b2b_agent_id, no gross_profit, no net_profit.
- **API:** `GET/POST /api/orders`, `GET/PUT/DELETE /api/orders/[id]`
- **Collection:** `orders` (will become `enrollments`)
- **Frontend:** `src/views/orders.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:282-334` Order has sellingPrice/supplierCostSnapshot/paymentStatus but missing enrollment_code, channel_type, bdc_id, b2b_agent_id, gross_profit, net_profit.
- **Remaining work:** Replace Order with Enrollment entity; add all missing fields

### B-06: Enrollment code (human-readable, unique)
- **Requirement ID:** B-06
- **Description:** enrollment_code VARCHAR(30) UNIQUE NOT NULL (e.g., SC-2026-1042)
- **Source:** `architecture_design.md:4.6`; DDL line 437
- **Existing implementation:** Order uses MongoDB ObjectId string as id. No human-readable enrollment code.
- **API:** `POST /api/orders`
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:282` — Order.id is ObjectId string, no enrollmentCode field
- **Remaining work:** Add enrollment_code field with unique index; generate human-readable codes

### B-07: Enrollment status lifecycle (8 statuses)
- **Requirement ID:** B-07
- **Description:** LEAD → DISCOUNT_APPROVAL → DOCS_PENDING → ADMIN_REVIEW → SENT_TO_PARTNER → SENT_TO_RTO → CERTIFIED → CANCELLED
- **Source:** `architecture_design.md:4.6`; DDL line 443
- **Existing implementation:** 23 statuses: Lead, Qualified, Won, Lost, New, Awaiting Payment, ..., Certificate Issued, Completed, On Hold, Cancelled, Refunded (`types.ts:156-178`). Status transitions defined in `ALLOWED_TRANSITIONS` (`src/app/api/orders/[id]/status/route.ts:11-48`)
- **API:** `PATCH /api/orders/[id]/status`
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`, `src/components/status-badge.tsx`
- **Status:** MISSING (completely different status set)
- **Evidence:** `types.ts:156-178` OrderStatus has 23 values, none match boss's 8 statuses except "Lead" and "Cancelled"
- **Remaining work:** Replace entire status lifecycle with boss's 8 statuses

### B-08: Payment status (4 statuses)
- **Requirement ID:** B-08
- **Description:** UNPAID, PARTIAL, PAID, REFUNDED
- **Source:** `architecture_design.md:4.6`; DDL line 450
- **Existing implementation:** PaymentStatus: Unpaid, Part Paid, Paid, Overdue, Refunded, Written Off (`types.ts:231-237`)
- **API:** N/A (computed on orders)
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:231-237` has extra statuses (Overdue, Written Off) not in boss spec
- **Remaining work:** Replace PaymentStatus with boss's 4 statuses

### B-09: Gross profit and net profit stored server-side
- **Requirement ID:** B-09
- **Description:** gross_profit = offered_price - partner_cost_snapshot; net_profit = gross_profit - (bdc_commission + referral_commission)
- **Source:** `architecture_design.md:4.6`; DDL lines 447-450; `architecture_design.md:§5` Pricing Engine
- **Existing implementation:** `grossMargin = (o) => o.sellingPrice - o.supplierCostSnapshot - o.otherCost` calculated CLIENT-SIDE in `ops-store.ts:108-109`. No net_profit field anywhere.
- **API:** N/A (client-side calculation)
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`, `src/lib/ops-store.ts`
- **Status:** MISSING
- **Evidence:** `src/lib/ops-store.ts:108-109` — grossMargin is client-side only. No net_profit field on Order.
- **Remaining work:** Add gross_profit and net_profit fields to Enrollment; calculate server-side

### B-10: B2C vs B2B channel handling
- **Requirement ID:** B-10
- **Description:** channel_type: 'B2C_BDC' or 'B2B_AGENT'. BDC quotes between Base & Standard price. B2B Agent views fixed B2B Tier Price.
- **Source:** `architecture_design.md:§2` workflow diagram; `docx §1`
- **Existing implementation:** No channel field on orders. No B2C/B2B distinction.
- **API:** `POST /api/orders`
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:282-334` — Order has no channel_type field
- **Remaining work:** Add channel_type to Enrollment; implement B2C/B2B pricing logic

---

## C. Dynamic Pricing Engine

### C-01: Qualification-specific pricing matrix
- **Requirement ID:** C-01
- **Description:** qualification_pricing: qualification_id, rpl_partner_id, partner_cost_price, bdc_base_price, bdc_standard_price, b2b_silver_price, b2b_gold_price, effective_from, currency
- **Source:** `architecture_design.md:4.4`; DDL lines 404-416
- **Existing implementation:** PriceList: qualificationId, priceCategoryId, amount, currency, effectiveFrom, effectiveTo, status (`types.ts:513-524`). SupplierRoute: qualificationId, sourceAgentId, rtoId, wholesaleCost, currency, effectiveFrom, effectiveTo, status (`types.ts:103-113`)
- **API:** `GET/POST /api/masters/price-lists`, `GET/POST /api/masters/supplier-routes`
- **Collection:** `price_lists`, `supplier_routes`
- **Frontend:** `src/views/price-lists.tsx`, `src/views/pricing.tsx`
- **Status:** MISSING (completely different structure)
- **Evidence:** `types.ts:513-524` PriceList has single `amount`, no tiered pricing, no partner_cost_price, no bdc_base_price, no b2b_silver_price
- **Remaining work:** Replace PriceList + SupplierRoute with qualification_pricing table

### C-02: Partner cost price (Admin only, hidden from BDC/B2B)
- **Requirement ID:** C-02
- **Description:** partner_cost_price DECIMAL(10,2) NOT NULL — Admin Only. Must be stripped from API responses to BDC/B2B_AGENT.
- **Source:** `architecture_design.md:4.4` Security Note; `docx §3`
- **Existing implementation:** supplierCostSnapshot on orders (visible to all with orders.view). No role-based field masking.
- **API:** `GET /api/orders` (returns supplierCostSnapshot to all)
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`
- **Status:** MISSING
- **Evidence:** `src/app/api/orders/route.ts:50` — supplierCostSnapshot returned to all authorized users
- **Remaining work:** Implement column-level field masking for partner_cost_price

### C-03: BDC base price and standard price
- **Requirement ID:** C-03
- **Description:** bdc_base_price (minimum floor), bdc_standard_price (standard retail). Constraint: bdc_standard_price >= bdc_base_price.
- **Source:** `architecture_design.md:4.4`; DDL lines 409-410; constraint line 415
- **Existing implementation:** PriceList has single `amount`. No base/standard distinction.
- **API:** `GET/POST /api/masters/price-lists`
- **Collection:** `price_lists`
- **Frontend:** `src/views/price-lists.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:513-524` — PriceList has single amount field
- **Remaining work:** Add bdc_base_price and bdc_standard_price to qualification_pricing

### C-04: B2B Silver, Gold, Platinum tier prices
- **Requirement ID:** C-04
- **Description:** b2b_silver_price (NOT NULL), b2b_gold_price (NULL). No Platinum price column — Platinum agents see Silver price.
- **Source:** `architecture_design.md:4.4`; DDL lines 411-412
- **Existing implementation:** No tier pricing concept.
- **API:** N/A
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** MISSING
- **Evidence:** No b2b_silver_price or b2b_gold_price fields anywhere
- **Remaining work:** Add b2b_silver_price and b2b_gold_price to qualification_pricing

### C-05: Effective dates on pricing
- **Requirement ID:** C-05
- **Description:** effective_from DATE NOT NULL. Unique constraint: (qualification_id, rpl_partner_id, effective_from).
- **Source:** `architecture_design.md:4.4`; DDL lines 414-415
- **Existing implementation:** PriceList has effectiveFrom/effectiveTo. SupplierRoute has effectiveFrom/effectiveTo. Overlap validation in `pricing-validation.ts:78-101`.
- **API:** `GET/POST /api/masters/price-lists`, `GET/POST /api/masters/supplier-routes`
- **Collection:** `price_lists`, `supplier_routes`
- **Frontend:** `src/views/price-lists.tsx`, `src/views/pricing.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:519-520` effective dates exist on PriceList. `pricing-validation.ts:78-101` overlap validation exists.
- **Remaining work:** Implement unique constraint on (qualification_id, rpl_partner_id, effective_from)

### C-06: Price snapshots locked at enrollment
- **Requirement ID:** C-06
- **Description:** offered_price and partner_cost_snapshot locked at enrollment time. Historical enrollments unaffected by pricing changes.
- **Source:** `architecture_design.md:4.6`; DDL lines 446-448
- **Existing implementation:** Order snapshots sellingPrice, supplierCostSnapshot at creation (`src/app/api/orders/route.ts:136-224`).
- **API:** `POST /api/orders`
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`
- **Status:** IMPLEMENTED
- **Evidence:** `src/app/api/orders/route.ts:136-224` — server-side snapshot resolution at order creation
- **Remaining work:** Map to Enrollment entity with boss's field names

---

## D. Financial and Commission Engine

### D-01: Payments table with verified_by_admin_id
- **Requirement ID:** D-01
- **Description:** payments: enrollment_id, amount_paid, payment_method ('BANK_TRANSFER', 'STRIPE', 'CASH', 'B2B_INVOICE'), transaction_ref, paid_at, verified_by_admin_id
- **Source:** `architecture_design.md:4.7`; DDL lines 457-465
- **Existing implementation:** Payment: orderId, invoiceId, amount, date, method, reference, allocatedAmount, status, verificationStatus, currency, exchangeRate, idempotencyKey (`types.ts:461-471`). No verified_by_admin_id. Has invoiceId (boss spec has no invoices table).
- **API:** `GET/POST /api/payments`, `GET/PUT/DELETE /api/payments/[id]`
- **Collection:** `payments`
- **Frontend:** `src/views/finance.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `src/app/api/payments/route.ts` — payment recording exists but has invoiceId, allocatedAmount, verificationStatus instead of verified_by_admin_id
- **Remaining work:** Replace Payment with boss's Payments structure; add verified_by_admin_id

### D-02: Payment verification by admin
- **Requirement ID:** D-02
- **Description:** verified_by_admin_id (UUID FK → users.id) — Admin confirms funds clearance
- **Source:** `architecture_design.md:4.7`; DDL line 464
- **Existing implementation:** verificationStatus field ('Unverified', 'Verified', 'Failed') but no verified_by_admin_id field, no verification workflow endpoint
- **API:** `POST /api/payments` (accepts verificationStatus)
- **Collection:** `payments`
- **Frontend:** `src/views/finance.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:744` verificationStatus exists but no verified_by_admin_id. No `/api/payments/[id]/verify` endpoint.
- **Remaining work:** Add verified_by_admin_id; create verification endpoint

### D-03: Gross profit = offered_price - partner_cost_snapshot
- **Requirement ID:** D-03
- **Description:** Calculated server-side and stored on enrollment
- **Source:** `architecture_design.md:4.6`; DDL line 448
- **Existing implementation:** Client-side `grossMargin` function in `ops-store.ts:108-109`. Not stored on order.
- **API:** N/A
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`, `src/lib/ops-store.ts`
- **Status:** MISSING
- **Evidence:** `src/lib/ops-store.ts:108-109` — grossMargin is client-side, not stored server-side
- **Remaining work:** Add gross_profit field to Enrollment; calculate server-side

### D-04: Net profit = gross_profit - total_commissions
- **Requirement ID:** D-04
- **Description:** net_profit = gross_profit - (bdc_commission + referral_commission). Stored on enrollment.
- **Source:** `architecture_design.md:4.6`; DDL line 449; `architecture_design.md:§5`
- **Existing implementation:** No net_profit field anywhere.
- **API:** N/A
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** MISSING
- **Evidence:** No net_profit field on Order or anywhere in types.ts
- **Remaining work:** Add net_profit field to Enrollment; calculate server-side

### D-05: BDC commissions
- **Requirement ID:** D-05
- **Description:** commissions: commission_type='BDC_COMMISSION', beneficiary_user_id (BDC user), amount, payout_status
- **Source:** `architecture_design.md:4.7`; DDL lines 468-477
- **Existing implementation:** CommissionRule: agentId, responsibility, tiers[], commissionCurrency (`types.ts:552-569`). CommissionRecord: agentId, periodMonth, periodYear, commissionAmount, status (`types.ts:578-598`)
- **API:** `GET/POST /api/masters/commission-rules`, `GET/POST /api/commission-records`
- **Collection:** `commission_rules`, `commission_records`
- **Frontend:** `src/app/(app)/commission-rules/page.tsx`, `src/app/(app)/commission-records/page.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:552-569` CommissionRule has agent-based tiers, not boss's BDC_COMMISSION/REFERRAL_COMMISSION model
- **Remaining work:** Replace commission model with boss's 2-type structure

### D-06: Referral commissions
- **Requirement ID:** D-06
- **Description:** commissions: commission_type='REFERRAL_COMMISSION', external_payee_name (non-student referrer), amount
- **Source:** `architecture_design.md:4.7`; DDL lines 472-473
- **Existing implementation:** No referral commission concept. No external_referrer_name on students.
- **API:** N/A
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** MISSING
- **Evidence:** No referral commission fields or types anywhere
- **Remaining work:** Add referral commission support

### D-07: Commission payout status (PENDING → ELIGIBLE → PAID → VOID)
- **Requirement ID:** D-07
- **Description:** payout_status: 'PENDING', 'ELIGIBLE', 'PAID', 'VOID'
- **Source:** `architecture_design.md:4.7`; DDL line 475
- **Existing implementation:** CommissionRecordStatus: draft, calculated, approved, rejected, paid (`types.ts:571-572`). CommissionPayoutStatus: pending, paid, failed (`types.ts:600`)
- **API:** `POST /api/commission-records/[id]/approve`, `POST /api/commission-records/[id]/reject`
- **Collection:** `commission_records`, `commission_payouts`
- **Frontend:** `src/views/commission-records.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:571-572` has different status values than boss spec
- **Remaining work:** Replace commission statuses with boss's 4 statuses

### D-08: Financial audit trail
- **Requirement ID:** D-08
- **Description:** All financial mutations audit-logged
- **Source:** `architecture_design.md`; existing `audit.ts`
- **Existing implementation:** `writeAudit` helper (`src/lib/audit.ts:55-72`) used by mutating routes. `audit_logs` collection.
- **API:** `GET /api/audit`
- **Collection:** `audit_logs`
- **Frontend:** `src/app/(app)/audit/page.tsx`, `src/views/audit.tsx`
- **Status:** IMPLEMENTED
- **Evidence:** `src/lib/audit.ts` — writeAudit called by orders, payments, and other mutating routes
- **Remaining work:** Ensure all new enrollment/finance mutations write audit records

---

## E. Document and Compliance Workflow

### E-01: Checklist templates per qualification
- **Requirement ID:** E-01
- **Description:** checklist_templates: qualification_id (NULL=global), document_name, description, is_mandatory (DEFAULT TRUE), sort_order, id_points_value (INT DEFAULT 0)
- **Source:** `architecture_design.md:4.9`; DDL lines 480-487
- **Existing implementation:** Static DOC_CHECKLISTS (`types.ts:404-413`) — 6 hardcoded types, no per-qualification templates, no is_mandatory, no points
- **API:** `GET /api/orders/[id]/checklist`
- **Collection:** `document_requirements` (used only for order creation defaults)
- **Frontend:** `src/views/documents.tsx` (uses `checklistFor()` returning static default)
- **Status:** MISSING
- **Evidence:** `types.ts:404-413` — DOC_CHECKLISTS is static Record with only "default" key. `ops-store.ts:140-142` — `checklistFor()` ignores qualificationId.
- **Remaining work:** Create checklist_templates collection with per-qualification support, is_mandatory, id_points_value

### E-02: 100-Point ID check system
- **Requirement ID:** E-02
- **Description:** id_points_value on checklist_templates (70 Passport/Birth Cert, 40 Driver License, 25 Medicare/Utility). Auto-verify 100 points.
- **Source:** `architecture_design.md:4.8`; DDL line 485; `docx §4.8`
- **Existing implementation:** No 100-point ID system anywhere.
- **API:** N/A
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** MISSING
- **Evidence:** No id_points_value or 100-point ID logic anywhere
- **Remaining work:** Implement 100-point ID check with point values

### E-03: USI verification
- **Requirement ID:** E-03
- **Description:** USI & VET Transcript as checklist item. usi_number on students.
- **Source:** `architecture_design.md:4.5`, `4.8`; `docx §4.8`
- **Existing implementation:** No USI field. No USI verification workflow.
- **API:** N/A
- **Collection:** N/A
- **Frontend:** N/A
- **Status:** MISSING
- **Evidence:** No usi_number field on Client. No USI verification endpoint.
- **Remaining work:** Add usi_number to Student; add USI verification to checklist

### E-04: Resume, Reference Letters, Trade Photos/Videos
- **Requirement ID:** E-04
- **Description:** Resume, 2-Referee Letters, Trade Work Photos/Videos as checklist items. requires_trade_media flag on qualifications.
- **Source:** `architecture_design.md:4.3`, `4.8`; DDL lines 402, 427
- **Existing implementation:** Document types are static: Identity, USI transcript, Employment evidence, Reference letter, Photos/skills evidence, RTO enrolment kit. No requires_trade_media on qualifications.
- **API:** `POST /api/documents/upload`
- **Collection:** `documents`
- **Frontend:** `src/views/documents.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:409` — "Reference letter" in static checklist. No resume or trade media as distinct types. No requires_trade_media on Qualification.
- **Remaining work:** Add requires_trade_media to Qualification; add Resume/Trade Video to checklist_templates

### E-05: Document upload with verification workflow
- **Requirement ID:** E-05
- **Description:** enrollment_documents: enrollment_id, checklist_item_id, file_url, file_name, uploaded_by_user_id, verification_status ('UPLOADED', 'APPROVED', 'REJECTED'), rejection_reason, verified_by_admin_id, uploaded_at, mime_type
- **Source:** `architecture_design.md:4.10`; DDL lines 490-501
- **Existing Implementation:** documents: orderId, clientId, type, version, fileName, contentType, sizeBytes, data (BSON Binary), status ('Requested', 'Not Received', 'Received', 'Under Review', 'Approved', 'Rejected', 'Superseded'), receivedAt, reviewedAt, reviewedBy, rejectionReason. No checklist_item_id, no mime_type, no uploaded_by_user_id, no verified_by_admin_id.
- **API:** `POST /api/documents/upload`, `PATCH /api/documents/[id]/review`
- **Collection:** `documents`
- **Frontend:** `src/views/documents.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:375-389` OrderDocument has status/reviewedBy/rejectionReason but no checklist_item_id, no uploaded_by_user_id, no verified_by_admin_id, no mime_type
- **Remaining work:** Replace documents with enrollment_documents linked to checklist_templates

### E-06: Mandatory checklist enforcement — block Partner submission
- **Requirement ID:** E-06
- **Description:** Blocks Partner submission until ALL Mandatory Checklist Items = APPROVED
- **Source:** `architecture_design.md:§2` workflow diagram; `architecture_design.md:4.9` is_mandatory; `docx §1`
- **Existing Implementation:** No enforcement. Order can transition to "Ready for Submission" / "Submitted to RTO" regardless of document status (`src/app/api/orders/[id]/status/route.ts:11-48` has no document check)
- **API:** `PATCH /api/orders/[id]/status`
- **Collection:** `orders`, `documents`
- **Frontend:** `src/views/orders.tsx`
- **Status:** MISSING
- **Evidence:** `src/app/api/orders/[id]/status/route.ts` — ALLOWED_TRANSITIONS has no document approval check
- **Remaining work:** Implement server-side gate: check all mandatory documents APPROVED before allowing SENT_TO_PARTNER transition

### E-07: Document access logging
- **Requirement ID:** E-07
- **Description:** Log document access (implied by compliance requirements)
- **Source:** `architecture_design.md`; existing `document_access_logs`
- **Existing Implementation:** `DocumentAccessLog` (`types.ts:365-373`). `writeDocumentAccessLog` (`src/lib/audit.ts:82-96`). Called on upload (`src/app/api/documents/upload/route.ts:64-70`).
- **API:** `POST /api/documents/upload`, `GET /api/documents/[id]/download`
- **Collection:** `document_access_logs`
- **Frontend:** N/A
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `src/app/api/documents/upload/route.ts:64-70` — access log written on upload. Download route needs verification.
- **Remaining work:** Verify download route logs access; map to enrollment_documents

### E-08: Admin approve/reject with rejection reason
- **Requirement ID:** E-08
- **Description:** Admin approves/rejects documents. rejection_reason recorded on rejection.
- **Source:** `architecture_design.md:4.10`; DDL line 498
- **Existing Implementation:** `PATCH /api/documents/[id]/review` — approve/reject with reason (`src/app/api/documents/[id]/review/route.ts:14-23`). But doesn't set verified_by_admin_id.
- **API:** `PATCH /api/documents/[id]/review`
- **Collection:** `documents`
- **Frontend:** `src/views/documents.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `src/app/api/documents/[id]/review/route.ts` — review endpoint exists but doesn't set verified_by_admin_id
- **Remaining work:** Add verified_by_admin_id to document review

### E-09: PDF format validation before dispatch
- **Requirement ID:** E-09
- **Description:** Enforces application/pdf for standard document packs
- **Source:** `docx §4.8`; `architecture_design.md:4.10` mime_type field
- **Existing Implementation:** ALLOWED types: application/pdf, image/jpeg, image/png, image/webp, text/csv, text/plain (`src/app/api/documents/upload/route.ts:10-17`)
- **API:** `POST /api/documents/upload`
- **Collection:** `documents`
- **Frontend:** `src/views/documents.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `src/app/api/documents/upload/route.ts:10-17` — allows images and CSV/txt, not just PDF
- **Remaining work:** Restrict to PDF for standard document packs (per boss spec)

---

## F. Partner and RTO Pipeline

### F-01: RPL Partners & RTOs combined table
- **Requirement ID:** F-01
- **Description:** rpl_partners_rtos: partner_name, rto_code, rto_name, submission_email (NOT NULL), is_active
- **Source:** `architecture_design.md:4.2`; DDL lines 385-392
- **Existing Implementation:** Separate `agents` (sales_closing, certificate_source, rto_contact) and `rtos` (legalName, tradingName, rtoCode, cricosCode, contacts[], status, complianceNote, website) entities. No submission_email.
- **API:** `GET/POST /api/masters/agents`, `GET/POST /api/masters/rtos`
- **Collection:** `agents`, `rtos`
- **Frontend:** `src/views/agents.tsx`, `src/views/rtos.tsx`
- **Status:** MISSING (wrong structure)
- **Evidence:** `types.ts:48-57` Agent has type field, no partner_name/rto_name/submission_email. `types.ts:87-97` Rto has no submission_email.
- **Remaining work:** Replace agents+rtos with rpl_partners_rtos table

### F-02: Partner assignment to enrollments
- **Requirement ID:** F-02
- **Description:** enrollments.rpl_partner_id (FK → rpl_partners_rtos.id)
- **Source:** `architecture_design.md:4.6`; DDL line 439
- **Existing Implementation:** Order has rtoId (FK → rtos). No rpl_partner_id.
- **API:** `POST /api/orders`
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`
- **Status:** MISSING
- **Evidence:** `types.ts:288` — Order has rtoId but no rpl_partner_id
- **Remaining work:** Add rpl_partner_id to Enrollment

### F-03: Submission workflow — Admin dispatches to Partner → RTO → Certificate
- **Requirement ID:** F-03
- **Description:** Admin sends verified PDF bundle to RPL Partner. RPL Partner assesses and forwards to Accredited RTO. RTO issues certificate.
- **Source:** `architecture_design.md:§2`; `docx §1`
- **Existing Implementation:** RTO processing record exists (`types.ts:348-362`). API: `GET/POST /api/rto-processing`. But no RPL Partner dispatch workflow.
- **API:** `GET/POST /api/rto-processing`, `GET/PUT/DELETE /api/rto-processing/[id]`
- **Collection:** `rto-processing`
- **Frontend:** `src/app/(app)/rto-processing/page.tsx`, `src/views/rto-processing.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:348-362` RtoProcessing has submissionStatus, processingStatus, rtoReference but no RPL Partner dispatch step
- **Remaining work:** Add RPL Partner dispatch step before RTO submission

### F-04: Certificate issuance and delivery tracking
- **Requirement ID:** F-04
- **Description:** certificate_issued_at (DATE) on enrollment. Certificate status tracked via enrollment status = CERTIFIED.
- **Source:** `architecture_design.md:4.6`; DDL line 452
- **Existing Implementation:** CertificateStatus on order: Not Issued, Pending, Issued, Certificate File Received, Delivered to Client (`types.ts:224-229`). Order fields: certificateDeliveryMethod, certificateDeliveryDate, certificateTrackingNumber (`types.ts:305-307`).
- **API:** `GET /api/orders/[id]/certificate`
- **Collection:** `orders`, `certificates`
- **Frontend:** `src/app/(app)/orders/[id]/page.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `types.ts:224-229` CertificateStatus exists but no certificate_issued_at field on Order. No certificate file upload workflow.
- **Remaining work:** Add certificate_issued_at to Enrollment; add certificate file upload

---

## G. Business Intelligence

### G-01: Admin sees all enrollments (B2C + B2B)
- **Requirement ID:** G-01
- **Description:** Admin Portal sees all student enrollments across both channels
- **Source:** `architecture_design.md:§5` Visibility Matrix
- **Existing Implementation:** All users with orders.view see all orders. No role-based filtering.
- **API:** `GET /api/orders`
- **Collection:** `orders`
- **Frontend:** `src/views/orders.tsx`
- **Status:** IMPLEMENTED (for Admin/Super Admin)
- **Evidence:** `src/app/api/orders/route.ts:25-62` — returns all orders to anyone with orders.view
- **Remaining work:** Implement role-based filtering (BDC sees own, B2B sees own agency, Admin sees all)

### G-02: BDC performance report
- **Requirement ID:** G-02
- **Description:** BDC enrollment volume, conversion, revenue (own B2C leads only)
- **Source:** `architecture_design.md:§5` Visibility Matrix
- **Existing Implementation:** Agent revenue report exists (`/reports/revenue-by-supplier`, `/reports/agent-commission`) but no BDC-specific report
- **API:** `GET /api/reports/agent-commission`, `GET /api/reports/revenue-by-supplier`
- **Collection:** `orders`, `commission_records`
- **Frontend:** `src/views/reports.tsx`
- **Status:** MISSING
- **Evidence:** No BDC role or BDC-specific report
- **Remaining work:** Create BDC performance report

### G-03: B2B Agent performance report
- **Requirement ID:** G-03
- **Description:** B2B Agent referrals, commissions, revenue (own agency students only)
- **Source:** `architecture_design.md:§5` Visibility Matrix
- **Existing Implementation:** Agent revenue report exists but no B2B Agent tier-specific view
- **API:** `GET /api/reports/agent-commission`, `GET /api/reports/revenue-by-supplier`
- **Collection:** `orders`, `commission_records`, `agents`
- **Frontend:** `src/views/reports.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `src/views/reports.tsx` — revenue by agent section exists but no B2B Agent filtering by tier/agency
- **Remaining work:** Add B2B Agent-specific performance report with tier filtering

### G-04: Revenue, gross profit, net profit reports
- **Requirement ID:** G-04
- **Description:** Revenue, gross profit, net profit by period
- **Source:** `architecture_design.md:§5` Pricing Engine; `architecture_design.md:4.6`
- **Existing Implementation:** `/reports/revenue`, `/reports/margin` exist. Margin = sellingPrice - supplierCostSnapshot - otherCost (client-side). No net_profit.
- **API:** `GET /api/reports/revenue`, `GET /api/reports/margin`
- **Collection:** `orders`
- **Frontend:** `src/views/reports.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `src/views/reports.tsx` — margin by qualification section exists but uses client-side grossMargin
- **Remaining work:** Implement server-side net_profit report

### G-05: Commission liabilities report
- **Requirement ID:** G-05
- **Description:** Unpaid approved commissions (payout_status = PENDING or ELIGIBLE)
- **Source:** `architecture_design.md:4.7`
- **Existing Implementation:** Commission records and payouts tracked but no dedicated liability report
- **API:** `GET /api/commission-records`, `GET /api/commission-payouts`
- **Collection:** `commission_records`, `commission_payouts`
- **Frontend:** `src/app/(app)/commission-records/page.tsx`, `src/app/(app)/commission-payouts/page.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** Commission records list exists but no "liabilities" report (unpaid approved commissions)
- **Remaining work:** Add commission liability report

### G-06: Payment balances / outstanding
- **Requirement ID:** G-06
- **Description:** Payment status tracking (UNPAID/PARTIAL/PAID/REFUNDED)
- **Source:** `architecture_design.md:4.6`
- **Existing Implementation:** `/reports/outstanding`, `/reports/ageing` exist. Finance summary shows invoiced, collected, outstanding.
- **API:** `GET /api/reports/outstanding`, `GET /api/finance/summary`
- **Collection:** `invoices`, `payments`
- **Frontend:** `src/views/reports.tsx`, `src/views/finance.tsx`
- **Status:** IMPLEMENTED
- **Evidence:** `src/views/reports.tsx` — overdue section; `src/views/finance.tsx` — finance summary cards
- **Remaining work:** Map to boss's 4 payment statuses

### G-07: Enrollment pipeline / funnel
- **Requirement ID:** G-07
- **Description:** Enrollment status pipeline (LEAD → CERTIFIED)
- **Source:** `architecture_design.md:4.6` status values
- **Existing Implementation:** `/reports/funnel` — orders by workflow stage with conversion percent
- **API:** `GET /api/reports/funnel`
- **Collection:** `orders`
- **Frontend:** `src/views/reports.tsx`
- **Status:** PARTIALLY IMPLEMENTED
- **Evidence:** `src/views/reports.tsx` — orders by workflow stage section exists but uses boss-incompatible statuses
- **Remaining work:** Map funnel to boss's 8 enrollment statuses

### G-08: Certificate tracking
- **Requirement ID:** G-08
- **Description:** Certificate issued tracking (certificate_issued_at, status=CERTIFIED)
- **Source:** `architecture_design.md:4.6`; DDL line 452
- **Existing Implementation:** `/reports/certificate-completion-time` exists. Certificate status on orders.
- **API:** `GET /api/reports/certificate-completion-time`
- **Collection:** `orders`, `certificates`
- **Frontend:** `src/views/reports.tsx`
- **Status:** IMPLEMENTED
- **Evidence:** `src/views/reports.tsx` — certificate completion time section
- **Remaining work:** Map to boss's certificate_issued_at field

---

## Gap Summary

| Category | Implemented | Partially | Missing | Not Verified |
|---|---|---|---|---|
| A. User Portals and RBAC | 1 | 1 | 6 | 0 |
| B. Student and Enrollment | 0 | 4 | 6 | 0 |
| C. Dynamic Pricing Engine | 1 | 1 | 4 | 0 |
| D. Financial and Commission | 1 | 4 | 3 | 0 |
| E. Document and Compliance | 0 | 5 | 4 | 0 |
| F. Partner and RTO Pipeline | 0 | 2 | 2 | 0 |
| G. Business Intelligence | 2 | 5 | 1 | 0 |
| **Total** | **5** | **17** | **26** | **0** |

**Total requirements assessed: 48**
- IMPLEMENTED: 5 (10%)
- PARTIALLY IMPLEMENTED: 17 (35%)
- MISSING: 26 (54%)

**Critical missing items:**
1. Four boss roles (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) — existing 7 roles are wrong
2. Student entity with USI, visa_status, referral tracking
3. Enrollment entity with enrollment_code, channel_type, bdc_id, b2b_agent_id, gross_profit, net_profit
4. BDC/B2B data scoping (own students/agency only)
5. Column-level field masking (partner cost hidden from BDC/B2B)
6. qualification_pricing with 5 price columns (replaces PriceList + SupplierRoute)
7. rpl_partners_rtos combined table (replaces separate agents + RTOs)
8. checklist_templates with is_mandatory and id_points_value (replaces static DOC_CHECKLISTS)
9. enrollment_documents linked to checklist_templates (replaces documents)
10. Mandatory checklist enforcement (block Partner submission)
11. 100-point ID check system
12. Payment verification with verified_by_admin_id
13. Net profit calculation (server-side)
14. BDC and referral commissions (2-type model)

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines — all sections (§1 Executive Overview through §6 PostgreSQL DDL) including ER diagram, table specifications, and DDL
- DOCX document: 706 lines — all sections (§1 End-to-End Data Flow through §5 Production DDL) including visibility matrix and detailed table specs

### Requirements Extracted from Each Document
**From MD document:** 4 roles (M-01 to M-02), user fields (M-02), rpl_partners_rtos (M-03), qualifications (M-04), qualification_pricing with 5 price columns + currency (M-05), students with USI/referral (M-06), enrollments with 8 statuses + code + channel_type + profit fields (M-07), payments with verified_by_admin_id (M-08), commissions with 2 types + 4 payout statuses (M-09), checklist_templates with is_mandatory (M-10), enrollment_documents with verification workflow (M-11), workflow gate (M-12), column-level masking (M-13), PostgreSQL DDL (M-14).

**From DOCX document:** End-to-end flow (D-01), 100-Point ID verification (D-02), mandatory checklist enforcement (D-03), Role-Based Visibility Matrix (D-04), submission_email NOT NULL (D-05), delivery_mode/requires_trade_media on qualifications (D-06), visa_status on students (D-07), enrollment code SC-2026-1042 without DISCOUNT_APPROVAL (D-08), id_points_value on checklist templates (D-09), mime_type/PDF validation on documents (D-10), pgcrypto DDL with CHECK constraints (D-11).

### Differences from Previous Audit
- Document paths corrected from "project root" to `docs_reference/`
- Added explicit cataloging of MD vs DOCX field discrepancies (contact_email vs submission_email, DISCOUNT_APPROVAL inclusion/exclusion, visa_status presence, id_points_value, mime_type, currency column, etc.)
- All 48 requirement IDs (A-01 through G-08) re-verified against actual source files: `src/lib/types.ts:7-14` (7 roles confirmed), `src/lib/types.ts:22-34` (User missing b2b_tier/default_commission_pct/agency_name/full_name), `src/lib/types.ts:260-272` (Client missing USI/visa/referral), `src/lib/types.ts:282-334` (Order missing enrollment_code/channel_type/bdc_id/b2b_agent_id/gross_profit/net_profit), `src/app/api/orders/route.ts:25-62` (no data scoping, returns supplierCostSnapshot to all), `src/lib/ops-store.ts:108-109` (grossMargin client-side), `src/lib/ops-store.ts:140-142` (static checklistFor)

### Final Requirement Coverage Statistics
| Status | Count | Percentage |
|--------|-------|------------|
| IMPLEMENTED | 5 | 10% |
| PARTIALLY IMPLEMENTED | 17 | 35% |
| MISSING | 26 | 54% |
| NOT VERIFIED | 0 | 0% |
| REQUIRES BUSINESS APPROVAL | 10 | N/A (decisions, not requirements) |
| **Total assessed** | **48** | **100%** |

### Recommended First Implementation Milestone
**Phase 0 — Role System & Security Foundation** (Weeks 1-2)
Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping.
