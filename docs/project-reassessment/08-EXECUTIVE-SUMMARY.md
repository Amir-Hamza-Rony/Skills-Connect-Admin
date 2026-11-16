# 08 — Executive Summary (vs Boss Reference Documents)

**Boss documents read in full:**
- `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx`
- `docs/reference/rpl_management_system_database_architecture_design.md`

**Note:** Both documents are located at `docs/reference/` (not project root). Both documents have been read completely.

---

## 1. What the Boss Expects

The boss expects an RPL (Recognition of Prior Learning) Management System with **4 roles** (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT), a **10-table relational schema** (PostgreSQL/MySQL compatible), and the following core capabilities:

**B2C Channel (BDC):** BDC logs in, quotes between Base & Standard price, enrolls students, records referrals.

**B2B Channel (Agent):** B2B Agent logs in, views fixed tier price (Silver/Gold/Platinum), submits students with checklist documents.

**Admin Verification Gate:** Admin verifies mandatory documents (100-Point ID, USI, Resume, Reference Letters, Trade Photos/Videos), confirms payment, locks partner cost snapshot, and **blocks Partner submission until ALL mandatory documents are APPROVED**.

**Partner & RTO Pipeline:** Admin dispatches verified PDF bundle to RPL Partner → RPL Partner submits to Accredited RTO → Certificate Issued.

**Financial Tracking:** Gross profit (offered_price − partner_cost_snapshot), Net profit (gross_profit − commissions), BDC commissions, Referral commissions, payment verification.

**Column-Level Security:** Partner cost and net profit hidden from BDC/B2B_AGENT. BDC Base & Standard price hidden from B2B_AGENT. B2B tier price hidden from BDC. BDC sees own leads only. B2B Agent sees own agency students only.

---

## 2. What the Existing Project Provides

The existing project is a **substantial Next.js 16 + MongoDB application** with ~85 real API routes. However, it was built against a **different specification** (the developer spec, `Skills_Connect_Admin_Software_Developer_Specification.docx`) and does **not** match the boss's reference documents.

**Implemented (matching boss spec):**
- Authentication: JWT + httpOnly rotating refresh, argon2id, rate limiting, lockout
- Server-side authorization middleware (`withAuth` + `requirePermission`)
- Document upload with versioning, approve/reject, access logging
- Payment recording with MongoDB transaction allocation
- QuickBooks sync, Excel import/export, reports
- Audit logging for all mutations
- Server-side price snapshots at order creation

**Not matching boss spec (entirely different model):**

| Boss Requirement | Existing Implementation | Gap |
|---|---|---|
| 4 roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT | 7 roles: Super Admin, Finance, Operations, Sales/Closing Agent, RTO/Sourcing Manager, Document Reviewer, Read Only/Manager | Complete mismatch |
| Student entity with USI, visa_status, referral | Client entity with none of these | Missing |
| Enrollment with enrollment_code, channel_type, bdc_id, b2b_agent_id | Order with ObjectId, no channel, no bdc/b2b agent | Missing |
| qualification_pricing with 5 price columns | PriceList + SupplierRoute (single amount, wholesale cost) | Wrong structure |
| rpl_partners_rtos combined table | Separate agents + RTOs | Wrong structure |
| checklist_templates with is_mandatory, id_points_value | Static DOC_CHECKLISTS (6 hardcoded types) | Missing |
| enrollment_documents linked to checklist_templates | documents with static types, no checklist linkage | Missing |
| Mandatory checklist enforcement (block Partner submission) | No enforcement | Missing |
| 100-point ID check system | None | Missing |
| Payment verification with verified_by_admin_id | verificationStatus field, no verified_by_admin_id | Partial |
| Net profit (server-side) | grossMargin client-side only | Missing |
| BDC + REFERRAL commissions | Tier-based commission rules | Wrong model |
| Enrollment status: 8 boss statuses | 23 order statuses | Wrong |
| Payment status: 4 boss statuses | 6 payment statuses | Wrong |

**Status: ~10% fully implemented, ~35% partially, ~54% missing** (48 requirements assessed against boss documents).

---

## 3. Critical Architecture Conflicts

| Conflict | Description | Risk |
|---|---|---|
| **Role system mismatch** | Boss has 4 roles; existing has 7 completely different roles | Cannot implement BDC/B2B data scoping without replacing entire RBAC |
| **No student entity** | Boss has students with USI/visa/referral; existing has clients without these | Core student data missing |
| **No enrollment entity** | Boss has enrollments with codes/channels/profit; existing has orders without these | Core transactional entity missing |
| **No column-level field masking** | Boss requires partner_cost_price hidden from BDC/B2B_AGENT; existing returns supplierCostSnapshot to all with orders.view | Security violation: wholesale costs visible to unauthorized roles |
| **No data scoping** | Boss requires BDC sees own leads, B2B sees own agency; existing shows all data to all authorized users | Security/privacy violation |
| **MongoDB vs Relational** | Boss documents describe PostgreSQL/MySQL 10-table relational schema; existing uses MongoDB | Data integrity: no FK constraints, no unique indexes, no ACID across collections |
| **Price model mismatch** | Boss: qualification_pricing with tiered columns; existing: PriceList + SupplierRoute | Pricing engine must be completely rewritten |
| **Commission model mismatch** | Boss: BDC_COMMISSION + REFERRAL_COMMISSION; existing: tier-based agent commissions | Commission engine must be completely rewritten |

---

## 4. Security and Financial Risks (High)

1. **Role system does not match boss spec** — The 7 existing roles cannot be mapped to the boss's 4 roles. BDC and B2B_AGENT roles do not exist. Without them, BDC/B2B data scoping is impossible.

2. **No column-level field masking** — `supplierCostSnapshot` (partner cost equivalent) is returned to all users with `orders.view`. Boss requires this hidden from BDC/B2B_AGENT.

3. **No data scoping** — Any user with `orders.view` sees ALL orders. Boss requires BDC to see only own B2C leads, B2B Agent to see only own agency students.

4. **No mandatory checklist enforcement** — Enrollments can proceed to Partner/RTO submission without all mandatory documents approved. Compliance violation.

5. **Client-side gross profit** — `grossMargin` calculated in browser, not server-side. Can be manipulated. Boss requires server-side gross_profit and net_profit.

6. **No payment verification workflow** — `verificationStatus` exists but no verified_by_admin_id or verification endpoint.

---

## 5. Recommended Implementation Sequence

**7 phases over 12-14 weeks:**

| Phase | Objective | Weeks | Critical? |
|-------|-----------|-------|-----------|
| 0 | Role System & Security — 4 boss roles, field masking, data scoping | 1-2 | YES — foundation |
| 1 | Student & Enrollment Core — USI, visa, referral, enrollment_code, channel_type, gross/net profit | 2-4 | YES — core data model |
| 2 | Dynamic Pricing Engine — qualification_pricing with 5 price columns, tier pricing | 4-6 | YES — revenue logic |
| 3 | RPL Partners & RTOs — combined rpl_partners_rtos table | 6-7 | Medium |
| 4 | Document & Compliance — checklist_templates, 100-point ID, mandatory enforcement | 7-9 | YES — compliance |
| 5 | Financial & Commission — payment verification, BDC/referral commissions, net profit | 9-11 | YES — financial integrity |
| 6 | BI & Reporting — BDC/B2B Agent performance, commission liabilities | 11-12 | Medium |
| 7 | Polish — pagination, server search, optimistic locking | 12-14 | Medium |

**First recommended milestone: Phase 0 — Role System & Security Foundation (Weeks 1-2)**

Without the correct 4 roles and data scoping, no subsequent phase can be securely implemented. The existing 7-role system must be replaced entirely.

---

## 6. Decisions Requiring Boss Approval

| # | Decision | Options |
|---|----------|---------|
| D-01 | Database architecture | Stay on MongoDB (recommended, lower risk) vs migrate to PostgreSQL (matches boss doc, 8-12 week migration) |
| D-02 | Enrollment code format | Human-readable (e.g., "SC-2026-1042") vs UUID |
| D-03 | Platinum B2B tier pricing | Falls back to Silver price (boss spec: b2b_gold_price is NULL) |
| D-04 | Mandatory documents per qualification | Business rule defining compliance requirements |
| D-05 | 100-point ID point values | 70/40/25 per boss doc, or custom values |
| D-06 | USI verification method | External API vs manual |
| D-07 | PDF-only vs image uploads | Boss spec: "enforces application/pdf for standard document packs" |
| D-08 | Net profit formula | What counts as commissions to subtract |
| D-09 | Commission eligibility | Which enrollment statuses count toward commission |
| D-10 | Referral commission formula | Percentage or fixed amount |

---

## 7. Bottom Line

The existing application is **not** the RPL Management System described in the boss's reference documents. It was built against a different specification with a fundamentally different data model (7 roles, clients/orders/agents/RTOs vs 4 roles, students/enrollments/RPL Partners/qualification_pricing). Approximately **54% of boss requirements are missing**, and **35% are partially implemented but with incompatible data structures**.

The project needs a **planned, phase-by-phase reimplementation** starting with the role system and security foundation (Phase 0), not minor patches. The existing authentication, audit logging, document upload, and payment transaction infrastructure can be reused, but the core entities (roles, users, students, enrollments, pricing, documents, commissions) must be rebuilt to match the boss's specification.

**No source code, database, or configuration was modified during this audit. All findings are evidence-based with real file paths and API routes cited.**

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines — all sections (§1–§6) including Executive Overview, System Workflow, ER Diagram (10 tables), Table Specifications (§4.1–4.10), Role-Based Access & Pricing Logic (§5), PostgreSQL DDL (§6)
- DOCX document: 706 lines — all sections (§1–§5) including End-to-End Business & Data Flow, ER Diagram, Role-Based Visibility Matrix, Detailed Table Specifications (§4.1–4.8), Production DDL (§5)

### Requirements Extracted from MD Document
| Ref | Requirement |
|-----|-------------|
| M-01 | 4 roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT |
| M-02 | User fields: id (UUID), full_name, email (UNIQUE), password_hash, phone, role, agency_name, b2b_tier, default_commission_pct, is_active, created_at |
| M-03 | rpl_partners_rtos: partner_name, rto_code, rto_name, contact_email, is_active |
| M-04 | qualifications: course_code, course_title, industry_sector, is_active |
| M-05 | qualification_pricing: partner_cost_price, bdc_base_price, bdc_standard_price, b2b_silver_price, b2b_gold_price, currency, effective_from |
| M-06 | students: first_name, last_name, email (UNIQUE), phone, dob, usi_number, address, referred_by_student_id, external_referrer_name |
| M-07 | enrollments: enrollment_code (UNIQUE), channel_type (B2C_BDC/B2B_AGENT), bdc_id, b2b_agent_id, status (8 values), offered_price, partner_cost_snapshot, gross_profit, net_profit, payment_status (4 values), submitted_to_partner_at, certificate_issued_at |
| M-08 | payments: enrollment_id, amount_paid, payment_method, transaction_ref, paid_at, verified_by_admin_id |
| M-09 | commissions: commission_type (BDC_COMMISSION/REFERRAL_COMMISSION), beneficiary_user_id, external_payee_name, amount, payout_status |
| M-10 | checklist_templates: qualification_id (NULL=global), document_name, is_mandatory, sort_order |
| M-11 | enrollment_documents: enrollment_id, checklist_item_id, file_url, verification_status, rejection_reason, verified_by_admin_id |
| M-12 | Workflow: Enrollment → Document & Payment Gate → Admin Verifies → Partner → RTO → Certificate |
| M-13 | Column-level visibility masking (partner_cost hidden from BDC/B2B_AGENT) |
| M-14 | PostgreSQL DDL with UUID extension, FK constraints, unique constraints |

### Requirements Extracted from DOCX Document
| Ref | Requirement |
|-----|-------------|
| D-01 | End-to-end business & data flow: B2C (BDC) and B2B (Agent) channels, Admin verification gate, RPL Partner → RTO pipeline |
| D-02 | Admin verifies 100-Point ID, USI, Resume, Reference Letters, Trade Photos/Videos before partner submission |
| D-03 | Blocks Partner submission until ALL mandatory checklist items = APPROVED |
| D-04 | Role-Based Visibility Matrix: Admin full access, BDC own B2C leads only, B2B Agent own agency students only |
| D-05 | users.role VARCHAR(20), rpl_partners_rtos.submission_email NOT NULL |
| D-06 | qualifications: delivery_mode (RPL/ONLINE), requires_trade_media, industry_sector NOT NULL |
| D-07 | students: visa_status (VARCHAR(50)) |
| D-08 | enrollments: enrollment_code example SC-2026-1042; statuses without DISCOUNT_APPROVAL |
| D-09 | checklist_templates: id_points_value INT DEFAULT 0 (100-point ID weighting) |
| D-10 | enrollment_documents: mime_type, PDF format validation for standard document packs |
| D-11 | PostgreSQL DDL with pgcrypto, gen_random_uuid, CHECK (bdc_standard_price >= bdc_base_price) |

### Differences Between the Two Boss Documents
| # | MD Document | DOCX Document |
|---|-------------|---------------|
| 1 | `rpl_partners_rtos.contact_email` (NULL) | `rpl_partners_rtos.submission_email` (NOT NULL) |
| 2 | `qualifications.industry_sector` NULL | `qualifications.industry_sector` NOT NULL; adds `delivery_mode`, `requires_trade_media` |
| 3 | `students` has no `visa_status` | `students.visa_status` VARCHAR(50) |
| 4 | Enrollment statuses include `DISCOUNT_APPROVAL` | Enrollment statuses exclude `DISCOUNT_APPROVAL` |
| 5 | Enrollment code example `RPL-2026-1001` | Enrollment code example `SC-2026-1042` |
| 6 | `qualification_pricing` has `currency` column | No `currency` column on qualification_pricing |
| 7 | `checklist_templates` has no `id_points_value` | `checklist_templates.id_points_value` INT DEFAULT 0 |
| 8 | `enrollment_documents` has `file_name` | `enrollment_documents.mime_type` + PDF validation |
| 9 | DDL uses `uuid-ossp` + `uuid_generate_v4()` | DDL uses `pgcrypto` + `gen_random_uuid()` |
| 10 | Enrollment has `submitted_to_partner_at`, `certificate_issued_at` | Not listed in DOCX enrollment table spec |

### Differences from Previous Audit
- Document paths corrected from "project root" to `docs/reference/`
- All previous findings re-verified against actual source files: `src/lib/types.ts:7-14` (7 roles confirmed), `src/lib/types.ts:22-34` (User missing b2b_tier/default_commission_pct/agency_name/full_name), `src/lib/types.ts:260-272` (Client missing USI/visa/referral), `src/lib/types.ts:282-334` (Order missing enrollment_code/channel_type/bdc_id/b2b_agent_id/gross_profit/net_profit), `src/app/api/orders/route.ts:25-62` (no data scoping, returns supplierCostSnapshot to all), `src/lib/ops-store.ts:108-109` (grossMargin client-side), `src/lib/ops-store.ts:140-142` (static checklistFor)

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
Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping. Without correct roles and data scoping, no subsequent phase can be securely implemented.
