# 01 — Boss Requirements Analysis

**Source documents (NOW FOUND):**
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx`
2. `docs/reference/rpl_management_system_database_architecture_design.md`

**Note:** Both documents are located at `docs/reference/` (not project root). Both documents have been read in full.

---

## 1. Executive Overview (from boss documents)

The RPL Management System is a **B2B/B2C Portal System** supporting:
- Multi-role access: **Admin**, **BDC**, **B2B Agents**
- Dynamic course pricing matrices per qualification and RPL Partner
- Financial profit/commission tracking
- Document checklist verification workflows prior to RPL Partner and RTO submission
- PostgreSQL 15+ / MySQL 8.0+ compatible relational schema (10 core tables)

**IMPORTANT:** The existing project uses MongoDB, not PostgreSQL/MySQL. This is an architecture conflict that must be addressed (see 04-DATABASE-COMPATIBILITY-ANALYSIS.md).

---

## 2. Business Objectives

- Manage B2C (BDC-driven) and B2B (Agent-driven) student enrollments
- Enforce Admin verification & compliance gate before RPL Partner submission
- Route verified files to RPL Partners and issuing RTOs
- Track financial margins (gross profit, net profit) and commissions (BDC, referral)
- Maintain historical pricing snapshots so price changes don't affect existing enrollments
- Provide role-based data visibility (column-level access control)

---

## 3. System Workflow (from boss document §1 & §2)

### B2C Channel (BDC)
1. BDC logs in and quotes between **Base & Standard** price
2. BDC enrolls Student and records Referral
3. Student uploads checklist documents
4. Admin verifies mandatory documents (100-Point ID, USI, Resume, Reference Letters, Trade Photos/Videos)
5. Admin confirms payment and locks Partner Cost Snapshot
6. **GATE:** Blocks Partner Submission until ALL Mandatory Checklist Items = APPROVED
7. Admin dispatches verified PDF bundle to RPL Partner
8. RPL Partner assesses and forwards to Accredited RTO
9. RTO issues Qualification Certificate

### B2B Channel (Agent)
1. B2B Agent logs in and views **fixed B2B Tier Price** (Silver/Gold/Platinum)
2. Agent submits Student + Checklist Documents
3. Same Admin verification gate applies
4. Same Partner/RTO pipeline applies

---

## 4. User Roles & Permissions (from boss documents §4.1)

| Role | Description | Key Fields |
|---|---|---|
| **SUPER_ADMIN** | Full system access | All fields visible |
| **ADMIN** | Full read/write, checklist approval, partner dispatch | All fields visible |
| **BDC** | B2C enrollments, own leads only | Base & Standard price (read, enforces floor); Partner Cost & Net Profit hidden |
| **B2B_AGENT** | B2B enrollments, own agency students only | B2B Tier Price (read, assigned tier); Partner Cost & BDC prices hidden |

**Role enum:** `SUPER_ADMIN, ADMIN, BDC, B2B_AGENT` (4 roles — NOT the 7 roles from the developer spec)

**User fields:** `id` (UUID), `full_name`, `email` (UNIQUE), `password_hash`, `phone`, `role`, `agency_name` (B2B_AGENT only), `b2b_tier` (SILVER/GOLD/PLATINUM, DEFAULT SILVER), `default_commission_pct` (DEFAULT 0.00), `is_active`, `created_at`

---

## 5. Column-Level Visibility Matrix (from boss document §3)

| Data Field / Capability | Admin Portal | BDC Login (B2C) | B2B Agent Login |
|---|---|---|---|
| RPL Partner Cost & Net Profit | Full Read/Write | **Hidden (Blocked at API)** | **Hidden (Blocked at API)** |
| BDC Base & Standard Price | Full Read/Write | Read Only (Enforces Floor) | **Hidden (Blocked at API)** |
| B2B Wholesale Tier Price | Full Read/Write | Hidden | Read Only (Assigned Tier) |
| Student Enrollments Visible | All B2C & B2B Files | Own B2C Leads Only | Own Agency Students Only |
| Checklist Verification | Approve / Reject PDFs | Upload & View Status | Upload & View Status |
| Partner / RTO Dispatch | Submit & Track RTO | View Status Milestone Only | View Status Milestone Only |

**Critical security rule:** `partner_cost_price` must be stripped from API responses sent to BDC and B2B_AGENT roles.

---

## 6. Database Entities (10 Core Tables from boss documents)

| # | Table | Key Fields | Purpose |
|---|---|---|---|
| 1 | `users` | id (UUID), full_name, email, role, b2b_tier, default_commission_pct, agency_name | Authentication & RBAC |
| 2 | `rpl_partners_rtos` | id, partner_name, rto_code, rto_name, submission_email | RPL Partners & issuing RTOs |
| 3 | `qualifications` | id, course_code, course_title, industry_sector, delivery_mode, requires_trade_media | Master course catalog |
| 4 | `qualification_pricing` | qualification_id, rpl_partner_id, partner_cost_price, bdc_base_price, bdc_standard_price, b2b_silver_price, b2b_gold_price, effective_from | Dynamic pricing matrix |
| 5 | `students` | id, first_name, last_name, email, phone, usi_number, visa_status, referred_by_student_id, external_referrer_name | Student profiles & referrals |
| 6 | `enrollments` | id, enrollment_code, student_id, qualification_id, rpl_partner_id, channel_type, bdc_id, b2b_agent_id, status, offered_price, partner_cost_snapshot, gross_profit, net_profit, payment_status | Core transactional table |
| 7 | `payments` | id, enrollment_id, amount_paid, payment_method, transaction_ref, verified_by_admin_id | Payment ledger |
| 8 | `commissions` | id, enrollment_id, commission_type (BDC_COMMISSION/REFERRAL_COMMISSION), beneficiary_user_id, external_payee_name, amount, payout_status | Commission tracking |
| 9 | `checklist_templates` | id, qualification_id (NULL=global), document_name, is_mandatory, id_points_value | Document requirements |
| 10 | `enrollment_documents` | id, enrollment_id, checklist_item_id, file_url, verification_status, rejection_reason | Document evidence vault |

---

## 7. Enrollment Status Lifecycle (from boss documents)

`LEAD` → `DISCOUNT_APPROVAL` → `DOCS_PENDING` → `ADMIN_REVIEW` → `SENT_TO_PARTNER` → `SENT_TO_RTO` → `CERTIFIED` → `CANCELLED`

**This is completely different from the existing implementation** which uses 23 statuses (Lead, Qualified, Won, Lost, New, Awaiting Payment, ..., Certificate Issued, Completed, etc.)

---

## 8. Payment Status (from boss documents)

`UNPAID` → `PARTIAL` → `PAID` → `REFUNDED`

**Different from existing** which uses: Unpaid, Part Paid, Paid, Overdue, Refunded, Written Off

---

## 9. Pricing Rules (from boss documents §4.4)

| Field | Description |
|---|---|
| `partner_cost_price` | **Admin Only:** Wholesale cost payable to RPL Partner. Hidden from BDC/B2B_AGENT |
| `bdc_base_price` | Minimum floor price a BDC can offer without Admin override |
| `bdc_standard_price` | Standard retail price quoted to B2C students |
| `b2b_silver_price` | Default wholesale price for B2B Agents |
| `b2b_gold_price` | Volume-discounted B2B price for Gold-tier agents (NULL = not configured) |
| `effective_from` | Start date for active pricing schedule |
| `currency` | DEFAULT 'AUD' |
| Constraint: `bdc_standard_price >= bdc_base_price` |
| Unique: (qualification_id, rpl_partner_id, effective_from) |

**No "Platinum" price column exists** — Platinum tier users see Silver price (b2b_gold_price is NULL for Platinum, meaning no discount beyond Silver).

---

## 10. Commission Rules (from boss documents §4.7)

| Field | Description |
|---|---|
| `commission_type` | `BDC_COMMISSION` or `REFERRAL_COMMISSION` |
| `beneficiary_user_id` | UUID FK to users (NULL if external referrer) |
| `external_payee_name` | Name of external/student referrer |
| `amount` | Commission dollar amount |
| `payout_status` | `PENDING`, `ELIGIBLE`, `PAID`, `VOID` |

**Profit formulas:**
- `gross_profit = offered_price - partner_cost_snapshot`
- `net_profit = gross_profit - (bdc_commission + referral_commission)`

---

## 11. Document Checklist Requirements (from boss documents §4.8)

| Document Type | Notes |
|---|---|
| 100 Points of ID | Point-weighted (70 Passport/Birth Cert, 40 Driver License, 25 Medicare/Utility) |
| USI & VET Transcript | Required for RTO issuance |
| Visa Copy | e.g., Citizen/PR, Student Visa, Temporary Graduate, Offshore |
| Resume | Required |
| 2-Referee Letters | Reference letters |
| Trade Work Photos/Videos | For trade courses (requires_trade_media = TRUE) |

**Checklist template fields:** `id_points_value` (INT DEFAULT 0) for 100-point ID auto-verification

**Verification status:** `UPLOADED` → `APPROVED` → `REJECTED` (with rejection_reason)

**Mandatory enforcement:** Blocks Partner submission until ALL mandatory checklist items = APPROVED

---

## 12. Incorrect Assumptions in Previous Assessment

The previous project reassessment (Step 1–8) was based on the **developer specification** (`Skills_Connect_Admin_Software_Developer_Specification.docx`), NOT the boss's reference documents. The following were **incorrect**:

| # | Previous (Wrong) Assumption | Boss Document Reality |
|---|---|---|
| 1 | 7 roles: Super Admin, Finance, Operations, Sales/Closing Agent, RTO/Sourcing Manager, Document Reviewer, Read Only/Manager | 4 roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT |
| 2 | "Client" entity with contacts/addresses | "Students" entity with USI, visa_status, referral tracking |
| 3 | "Order" entity with 23 statuses | "Enrollment" entity with 8 statuses |
| 4 | PriceList with single amount per qualification | qualification_pricing with 5 price columns (partner_cost, bdc_base, bdc_standard, b2b_silver, b2b_gold) |
| 5 | Separate Agent and RTO entities | Combined `rpl_partners_rtos` table |
| 6 | Static DOC_CHECKLISTS (6 hardcoded types) | Dynamic checklist_templates per qualification with is_mandatory and points |
| 7 | Document status: Requested/Not Received/Received/Under Review/Approved/Rejected/Superseded | Verification status: UPLOADED/APPROVED/REJECTED |
| 8 | Payment status: Unpaid/Part Paid/Paid/Overdue/Refunded/Written Off | Payment status: UNPAID/PARTIAL/PAID/REFUNDED |
| 9 | Gross margin calculated client-side | gross_profit and net_profit stored on enrollment, calculated server-side |
| 10 | Commission rules with tiers per agent | Commissions with BDC_COMMISSION and REFERRAL_COMMISSION types only |
| 11 | No enrollment_code | enrollment_code (VARCHAR(30), UNIQUE, NOT NULL) |
| 12 | No channel_type on orders | channel_type: 'B2C_BDC' or 'B2B_AGENT' |
| 13 | No USI/visa on clients | usi_number and visa_status on students |
| 14 | No 100-point ID system | id_points_value on checklist_templates |
| 15 | "B2B Platinum" tier pricing | No Platinum price column; Platinum agents see Silver price |

---

## 13. Source Document Sections

| Section | Topic | File |
|---|---|---|
| §1 | Executive Overview | architecture_design.md:1-6 |
| §2 | System Workflow & Data Lifecycle | architecture_design.md:8-31 |
| §3 | ER Diagram (10 tables) | architecture_design.md:35-159 |
| §4.1 | Users table spec | architecture_design.md:165-181 |
| §4.2 | RPL Partners & RTOs | architecture_design.md:184-195 |
| §4.3 | Qualifications | architecture_design.md:198-208 |
| §4.4 | Qualification Pricing | architecture_design.md:211-226 |
| §4.5 | Students | architecture_design.md:229-245 |
| §4.6 | Enrollments | architecture_design.md:248-270 |
| §4.7 | Payments & Commissions | architecture_design.md:273-301 |
| §4.8 | Checklist Templates & Enrollment Documents | architecture_design.md:304-333 |
| §5 | Role-Based Access & Pricing Logic | architecture_design.md:336-359 |
| §6 | PostgreSQL DDL | architecture_design.md:363-510 |
| Docx §1 | End-to-End Business & Data Flow | docx:7-11 |
| Docx §2 | ER Diagram | docx:12-17 |
| Docx §3 | Role-Based Visibility Matrix | docx:18-79 |
| Docx §4 | Detailed Table Specifications | docx:81-706 |

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines, including Executive Overview (§1), System Workflow (§2), ER Diagram (§3), 10 Table Specifications (§4.1–4.10), Role-Based Access & Pricing Logic (§5), PostgreSQL DDL (§6)
- DOCX document: 706 lines, including End-to-End Business & Data Flow (§1), ER Diagram (§2), Role-Based Visibility Matrix (§3), Detailed Table Specifications (§4.1–4.8), Production DDL (§5)

### Requirements Extracted from MD Document
| Ref | Requirement | Source |
|-----|-------------|--------|
| M-01 | 4 roles: SUPER_ADMIN, ADMIN, BDC, B2B_AGENT | §4.1 |
| M-02 | User fields: id (UUID), full_name, email (UNIQUE), password_hash, phone, role, agency_name, b2b_tier, default_commission_pct, is_active, created_at | §4.1 |
| M-03 | rpl_partners_rtos: partner_name, rto_code, rto_name, contact_email, is_active | §4.2 |
| M-04 | qualifications: course_code, course_title, industry_sector, is_active | §4.3 |
| M-05 | qualification_pricing: partner_cost_price, bdc_base_price, bdc_standard_price, b2b_silver_price, b2b_gold_price, currency, effective_from | §4.4 |
| M-06 | students: first_name, last_name, email (UNIQUE), phone, dob, usi_number, address, referred_by_student_id, external_referrer_name | §4.5 |
| M-07 | enrollments: enrollment_code (UNIQUE), channel_type (B2C_BDC/B2B_AGENT), bdc_id, b2b_agent_id, status (8 values), offered_price, partner_cost_snapshot, gross_profit, net_profit, payment_status (4 values), submitted_to_partner_at, certificate_issued_at | §4.6 |
| M-08 | payments: enrollment_id, amount_paid, payment_method, transaction_ref, paid_at, verified_by_admin_id | §4.7 |
| M-09 | commissions: commission_type (BDC_COMMISSION/REFERRAL_COMMISSION), beneficiary_user_id, external_payee_name, amount, payout_status | §4.8 |
| M-10 | checklist_templates: qualification_id (NULL=global), document_name, is_mandatory, sort_order | §4.9 |
| M-11 | enrollment_documents: enrollment_id, checklist_item_id, file_url, verification_status, rejection_reason, verified_by_admin_id | §4.10 |
| M-12 | Workflow: Enrollment → Document & Payment Gate → Admin Verifies → Partner → RTO → Certificate | §2 |
| M-13 | Column-level visibility masking (partner_cost hidden from BDC/B2B_AGENT) | §5 |
| M-14 | PostgreSQL DDL with UUID extension, FK constraints, unique constraints | §6 |

### Requirements Extracted from DOCX Document
| Ref | Requirement | Source |
|-----|-------------|--------|
| D-01 | End-to-end business & data flow: B2C (BDC) and B2B (Agent) channels, Admin verification gate, RPL Partner → RTO pipeline | §1 |
| D-02 | Admin verifies 100-Point ID, USI, Resume, Reference Letters, Trade Photos/Videos before partner submission | §1 |
| D-03 | Blocks Partner submission until ALL mandatory checklist items = APPROVED | §1 |
| D-04 | Role-Based Visibility Matrix: Admin full access, BDC own B2C leads only, B2B Agent own agency students only | §3 |
| D-05 | users.role VARCHAR(20), rpl_partners_rtos.submission_email NOT NULL | §4.1–4.2 |
| D-06 | qualifications: delivery_mode (RPL/ONLINE), requires_trade_media, industry_sector NOT NULL | §4.3 |
| D-07 | students: visa_status (VARCHAR(50)) | §4.5 |
| D-08 | enrollments: enrollment_code example SC-2026-1042; statuses without DISCOUNT_APPROVAL | §4.6 |
| D-09 | checklist_templates: id_points_value INT DEFAULT 0 (100-point ID weighting) | §4.8 |
| D-10 | enrollment_documents: mime_type, PDF format validation for standard document packs | §4.8 |
| D-11 | PostgreSQL DDL with pgcrypto, gen_random_uuid, CHECK (bdc_standard_price >= bdc_base_price) | §5 |

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
- Previously identified 15 incorrect assumptions (developer spec vs boss documents) remain valid
- Added documentation of MD vs DOCX field-level discrepancies (above table)

### Final Requirement Coverage Statistics
| Status | Count | Percentage |
|--------|-------|------------|
| IMPLEMENTED | 5 | 10% |
| PARTIALLY IMPLEMENTED | 17 | 35% |
| MISSING | 26 | 54% |
| NOT VERIFIED | 0 | 0% |
| **Total assessed** | **48** | **100%** |

Plus 10 decisions requiring business approval (D-01 to D-10 in 07-PRODUCTION-ACCEPTANCE-CRITERIA.md).

### Recommended First Implementation Milestone
**Phase 0 — Role System & Security Foundation** (Weeks 1-2)
Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping. Without correct roles and data scoping, no subsequent phase can be securely implemented.
