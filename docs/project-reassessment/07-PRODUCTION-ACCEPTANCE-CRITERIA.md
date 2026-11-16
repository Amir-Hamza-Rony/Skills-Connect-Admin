# 07 — Production Acceptance Criteria (vs Boss Reference Documents)

**Source:** Both boss documents read in full. This document replaces the previous acceptance criteria which was based on the developer specification.

**Note:** The boss's reference documents describe a PostgreSQL/MySQL relational schema. The existing project uses MongoDB. All acceptance criteria below assume implementation on the existing MongoDB architecture (Strategy 1 from 04-DATABASE-COMPATIBILITY-ANALYSIS.md).

---

## 1. Authentication & Authorization (Phase 0)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-01 | JWT access token (15 min) + httpOnly rotating refresh token (7 days) | Inspect auth flow, token expiration |
| AC-02 | Argon2id password hashing | Inspect `src/lib/api-auth.ts` |
| AC-03 | Rate limiting on login (5 attempts per 15 min) | Inspect `src/app/api/auth/login/route.ts:24-27` |
| AC-04 | Account lockout after 10 failed attempts (15 min) | Inspect `src/app/api/auth/login/route.ts:88-93` |
| AC-05 | Exactly 4 roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT | Inspect `types.ts` RoleName union; test login as each role |
| AC-06 | User fields: full_name, email (UNIQUE), password_hash, phone, role, b2b_tier, default_commission_pct, agency_name, is_active | Inspect User type and API responses |
| AC-07 | SUPER_ADMIN and ADMIN have full read/write access | Test with each role |
| AC-08 | BDC sees own B2C leads only (data scoping by bdc_id) | Login as BDC, verify filtered enrollment list |
| AC-09 | B2B Agent sees own agency students only (data scoping by b2b_agent_id) | Login as B2B Agent, verify filtered enrollment list |
| AC-10 | Admin sees all B2C + B2B enrollments | Login as Admin, verify unfiltered list |
| AC-11 | Server-side authorization on all API routes; frontend hiding is not enforcement | Verify all API routes use `withAuth` |
| AC-12 | No secrets in localStorage or frontend bundle | Inspect `src/lib/auth.tsx`, `src/lib/api.ts` |

---

## 2. Column-Level Visibility (Phase 0)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-13 | `partner_cost_price` hidden from BDC and B2B_AGENT API responses | Call enrollment API as BDC/B2B_AGENT, verify field absent |
| AC-14 | `partner_cost_price` visible to SUPER_ADMIN and ADMIN | Call enrollment API as Admin, verify field present |
| AC-15 | `bdc_base_price` and `bdc_standard_price` hidden from B2B_AGENT | Call pricing API as B2B_AGENT, verify fields absent |
| AC-16 | `bdc_base_price` and `bdc_standard_price` read-only for BDC | Call pricing API as BDC, verify fields present but not writable |
| AC-17 | `b2b_silver_price` and `b2b_gold_price` hidden from BDC | Call pricing API as BDC, verify fields absent |
| AC-18 | `b2b_silver_price`/`b2b_gold_price` read-only for B2B_AGENT (assigned tier only) | Call pricing API as B2B_AGENT, verify only assigned tier price visible |
| AC-19 | B2B_AGENT with Platinum tier sees Silver price (no b2b_gold_price column) | Create Platinum B2B Agent, verify they see b2b_silver_price |

---

## 3. Student & Enrollment Management (Phase 1)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-20 | Student entity: first_name, last_name, email (UNIQUE), phone, usi_number, visa_status | Create student, verify all fields stored |
| AC-21 | Student referral tracking: referred_by_student_id (self-FK), external_referrer_name | Create referred student, verify relationship |
| AC-22 | Enrollment entity: enrollment_code (UNIQUE, human-readable, e.g., SC-2026-1042) | Create enrollment, verify code generated and unique |
| AC-23 | Enrollment channel_type: 'B2C_BDC' or 'B2B_AGENT' | Create enrollment with each channel, verify stored |
| AC-24 | Enrollment bdc_id (UUID FK → users) for B2C_BDC | Create B2C enrollment, verify bdc_id set |
| AC-25 | Enrollment b2b_agent_id (UUID FK → users) for B2B_AGENT | Create B2B enrollment, verify b2b_agent_id set |
| AC-26 | Enrollment rpl_partner_id (FK → rpl_partners_rtos) | Create enrollment, verify partner reference |
| AC-27 | Enrollment status lifecycle: LEAD → DISCOUNT_APPROVAL → DOCS_PENDING → ADMIN_REVIEW → SENT_TO_PARTNER → SENT_TO_RTO → CERTIFIED → CANCELLED | Transition through all statuses, verify allowed transitions |
| AC-28 | Payment status: UNPAID → PARTIAL → PAID → REFUNDED | Update payment status, verify valid values only |
| AC-29 | gross_profit = offered_price - partner_cost_snapshot (server-side) | Create enrollment, verify gross_profit calculated on server |
| AC-30 | net_profit = gross_profit - total_commissions (server-side) | Create enrollment with commissions, verify net_profit |
| AC-31 | Status history audit trail | Verify history entries recorded on transitions |

---

## 4. Dynamic Pricing Engine (Phase 2)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-32 | qualification_pricing: partner_cost_price, bdc_base_price, bdc_standard_price, b2b_silver_price, b2b_gold_price, effective_from, currency | Create pricing rule, verify all fields |
| AC-33 | Constraint: bdc_standard_price >= bdc_base_price | Attempt violation, verify rejected |
| AC-34 | Unique: (qualification_id, rpl_partner_id, effective_from) | Attempt duplicate, verify rejected |
| AC-35 | BDC quotes between Base & Standard price | Create B2C enrollment, verify price within range |
| AC-36 | B2B Agent sees fixed tier price (Silver/Gold/Platinum) | Create B2B enrollment, verify tier price applied |
| AC-37 | Platinum B2B Agent sees Silver price (b2b_gold_price is NULL) | Create Platinum agent, verify Silver price used |
| AC-38 | Price snapshots locked at enrollment time | Change pricing, verify existing enrollment retains original prices |
| AC-39 | Multi-currency support (DEFAULT 'AUD') | Create enrollment in non-AUD currency, verify stored |

---

## 5. Financial & Commission Engine (Phase 5)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-40 | Payment recording: enrollment_id, amount_paid, payment_method ('BANK_TRANSFER'/'STRIPE'/'CASH'/'B2B_INVOICE'), transaction_ref | Record payment, verify all fields |
| AC-41 | Payment verification: verified_by_admin_id set by Admin | Verify payment as Admin, verify field set |
| AC-42 | Partial and full payments | Record partial payment → PARTIAL; full payment → PAID |
| AC-43 | gross_profit stored server-side on enrollment | Verify gross_profit field populated |
| AC-44 | net_profit stored server-side on enrollment | Verify net_profit field populated |
| AC-45 | BDC commissions (commission_type='BDC_COMMISSION') | Create commission record, verify type |
| AC-46 | Referral commissions (commission_type='REFERRAL_COMMISSION') | Create commission record with external_payee_name, verify type |
| AC-47 | Commission payout status: PENDING → ELIGIBLE → PAID → VOID | Transition through all statuses |
| AC-48 | Financial audit trail for all mutations | Verify audit_logs populated for all financial operations |

---

## 6. Document & Compliance Workflow (Phase 4)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-49 | Checklist templates per qualification: qualification_id (NULL=global), document_name, is_mandatory, id_points_value | Create templates, verify per-qualification and global items |
| AC-50 | 100-Point ID check: id_points_value (70 Passport/Birth Cert, 40 Driver License, 25 Medicare/Utility) | Calculate points, verify total reaches 100 |
| AC-51 | USI & VET Transcript as checklist item | Verify USI document type in templates |
| AC-52 | Resume, 2-Referee Letters as checklist items | Verify document types in templates |
| AC-53 | Trade Work Photos/Videos (requires_trade_media on qualifications) | Verify trade media flag and document type |
| AC-54 | Document upload with verification_status: UPLOADED → APPROVED → REJECTED | Upload and review document, verify status transitions |
| AC-55 | Rejection reason recorded on rejection | Reject document, verify rejection_reason stored |
| AC-56 | verified_by_admin_id set on document approval | Approve document as Admin, verify field set |
| AC-57 | Mandatory checklist enforcement: block SENT_TO_PARTNER until all mandatory docs APPROVED | Attempt transition with unapproved mandatory docs, verify blocked |
| AC-58 | Document access logging | Access document, verify access log entry |
| AC-59 | PDF format validation for standard document packs | Attempt non-PDF upload for standard doc, verify rejected |

---

## 7. Partner & RTO Pipeline (Phase 3)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-60 | RPL Partners & RTOs combined table: partner_name, rto_code, rto_name, submission_email (NOT NULL), is_active | Create partner, verify all fields |
| AC-61 | Partner assignment to enrollment (rpl_partner_id) | Create enrollment, verify partner reference |
| AC-62 | Admin dispatch to RPL Partner → RTO submission → Certificate Issued | Transition enrollment through pipeline, verify status |
| AC-63 | certificate_issued_at (DATE) on enrollment | Mark certificate issued, verify date stored |
| AC-64 | Enrollment status = CERTIFIED when certificate issued | Verify status transition to CERTIFIED |

---

## 8. Business Intelligence (Phase 6)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-65 | Admin sees all enrollment reports | Login as Admin, verify full report data |
| AC-66 | BDC performance report (own B2C leads only) | Login as BDC, verify filtered report |
| AC-67 | B2B Agent performance report (own agency students only) | Login as B2B Agent, verify filtered report |
| AC-68 | Revenue report (gross profit by period) | Verify report matches source data |
| AC-69 | Net profit report by period | Verify net_profit calculations |
| AC-70 | Commission liabilities report (unpaid: PENDING/ELIGIBLE) | Verify unpaid commissions shown |
| AC-71 | Payment balances / outstanding | Verify payment status counts |
| AC-72 | Enrollment pipeline/funnel (8 statuses) | Verify funnel matches enrollment statuses |
| AC-73 | Certificate tracking report | Verify CERTIFIED enrollments counted |

---

## 9. Dynamic Functionality (Phase 7)

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-74 | All pages fetch real MongoDB data (no mock data) | Verify no mock data in production paths |
| AC-75 | Create, edit, delete for students, enrollments, documents | Test full CRUD |
| AC-76 | Server-side search and filter on list pages | Test with query parameters |
| AC-77 | Pagination on all list pages | Test with 100+ records |
| AC-78 | Frontend state updates after mutations | Verify optimistic updates |
| AC-79 | Loading, empty, success, error states | Verify all four states |
| AC-80 | Server-side financial calculations (gross_profit, net_profit) | Verify calculations done on server |

---

## 10. Database & Infrastructure

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-81 | MongoDB connection with pooling | Verify app connects to MongoDB |
| AC-82 | Unique indexes on critical fields | Verify indexes on users.email, enrollments.enrollmentCode, etc. |
| AC-83 | Transactions for multi-document operations | Verify enrollment creation uses MongoDB session |
| AC-84 | Audit logging for all mutations | Verify audit_logs populated |
| AC-85 | Document access logging | Verify document_access_logs populated |
| AC-86 | No secrets committed to repository | Verify .env not in git |

---

## 11. Testing

| # | Criterion | Verification Method |
|---|-----------|---------------------|
| AC-87 | Unit tests for role-based field masking | Run test suite, verify all pass |
| AC-88 | Unit tests for data scoping (BDC/B2B Agent) | Run test suite, verify all pass |
| AC-89 | Unit tests for gross_profit/net_profit calculation | Run test suite, verify all pass |
| AC-90 | Unit tests for 100-point ID calculation | Run test suite, verify all pass |
| AC-91 | Integration tests for enrollment lifecycle | Run test suite, verify end-to-end |
| AC-92 | Integration tests for mandatory checklist enforcement | Verify Partner submission blocked |
| AC-93 | TypeScript typecheck passes | Run `npm run typecheck` |
| AC-94 | Lint passes | Run `npm run lint` |
| AC-95 | Production build succeeds | Run `npm run build` |

---

## 12. Release Blockers

The following MUST be resolved before production release:

1. **Four boss roles (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) replace the 7 developer-spec roles** — existing role system is incompatible
2. **Student entity with USI number, visa status, referral tracking** — core student data missing
3. **Enrollment entity with enrollment_code, channel_type, bdc_id, b2b_agent_id, gross_profit, net_profit** — core transactional entity missing
4. **BDC and B2B Agent data scoping** — security requirement: BDC sees own leads, B2B sees own agency
5. **Column-level field masking** — partner_cost_price hidden from BDC/B2B_AGENT at API level
6. **Mandatory checklist enforcement** — blocks Partner submission until all mandatory docs approved
7. **qualification_pricing with 5 price columns** — replaces PriceList + SupplierRoute
8. **rpl_partners_rtos combined table** — replaces separate agents + RTOs
9. **Payment verification with verified_by_admin_id** — admin confirms funds
10. **Net profit calculation server-side** — gross_profit - total_commissions
11. **No mock data** in any production code path
12. **Pagination** on all list pages

---

## 13. Decisions Requiring Boss Approval

| # | Decision | Why Approval Needed |
|---|----------|-------------------|
| D-01 | Stay on MongoDB vs migrate to PostgreSQL | Boss documents describe relational schema; migration is expensive (8-12 weeks) |
| D-02 | Enrollment code format (e.g., "SC-2026-1042" vs UUID) | Human-readable code format is a business decision |
| D-03 | Platinum B2B tier falls back to Silver price (no b2b_gold_price column) | Boss spec has b2b_gold_price as NULL; Platinum agents see Silver price |
| D-04 | Which documents are mandatory vs optional per qualification | Business rule affecting compliance |
| D-05 | 100-point ID point values per document type | Business rule affecting compliance |
| D-06 | USI verification: external API or manual? | Operational decision |
| D-07 | PDF-only uploads vs allow images (existing allows images) | Boss spec says "enforces application/pdf for standard document packs" |
| D-08 | Net profit formula (what counts as commissions to subtract?) | Financial decision |
| D-09 | Commission eligibility (which enrollment statuses count?) | Financial decision |
| D-10 | Referral commission percentage/formula | Financial decision |

---

**Audit completed:** 2026-11-16
**Boss documents read:**
- `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx`
- `docs/reference/rpl_management_system_database_architecture_design.md`
**Constraint:** Read-only audit — no source code, database, or configuration modifications performed

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines — all sections (§1–§6) including workflow, ER diagram, table specifications, DDL
- DOCX document: 706 lines — all sections (§1–§5) including data flow, visibility matrix, detailed specs, DDL

### Requirements Extracted from Each Document
**From MD document:** 4 roles (M-01), user fields (M-02), rpl_partners_rtos (M-03), qualifications (M-04), qualification_pricing with 5 price columns + currency + effective_from (M-05), students with USI/visa/referral (M-06), enrollments with enrollment_code/channel_type/bdc_id/b2b_agent_id/gross_profit/net_profit/8 statuses/4 payment statuses/submitted_to_partner_at/certificate_issued_at (M-07), payments with verified_by_admin_id (M-08), commissions with 2 types + 4 payout statuses (M-09), checklist_templates with is_mandatory/sort_order (M-10), enrollment_documents with verification workflow (M-11), workflow gate (M-12), column-level masking (M-13), PostgreSQL DDL (M-14).

**From DOCX document:** End-to-end B2C/B2B data flow (D-01), 100-Point ID verification (D-02), mandatory checklist enforcement (D-03), Role-Based Visibility Matrix (D-04), submission_email NOT NULL (D-05), delivery_mode/requires_trade_media on qualifications (D-06), visa_status on students (D-07), enrollment code SC-2026-1042 without DISCOUNT_APPROVAL (D-08), id_points_value on checklist templates (D-09), mime_type/PDF validation on documents (D-10), pgcrypto DDL with CHECK constraints (D-11).

### Differences from Previous Audit
- Document paths corrected from "project root" to `docs_reference/`
- All 95 acceptance criteria (AC-01 through AC-95) re-verified against boss documents
- 10 business approval decisions (D-01 through D-10) catalogued
- MD vs DOCX field discrepancies documented (contact_email vs submission_email, DISCOUNT_APPROVAL inclusion/exclusion, visa_status, id_points_value, mime_type, currency column)

### Final Requirement Coverage Statistics
| Status | Count | Percentage |
|--------|-------|------------|
| IMPLEMENTED | 5 | 10% |
| PARTIALLY IMPLEMENTED | 17 | 35% |
| MISSING | 26 | 54% |
| NOT VERIFIED | 0 | 0% |
| REQUIRES BUSINESS APPROVAL | 10 | N/A (decisions) |
| **Total requirements assessed** | **48** | **100%** |
| **Total acceptance criteria** | **95** | — |
| **Total business approval decisions** | **10** | — |

### Recommended First Implementation Milestone
**Phase 0 — Role System & Security Foundation** (Weeks 1-2)
Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping. This milestone must be complete before any subsequent phase can begin.
