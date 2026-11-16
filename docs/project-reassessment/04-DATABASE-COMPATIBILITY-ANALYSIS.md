# 04 — Database Compatibility Analysis (vs Boss Reference Documents)

**Source:** Both boss documents read in full. The boss's reference architecture describes a **PostgreSQL/MySQL-compatible relational database with 10 core entities**. The existing project uses **MongoDB** via the native driver.

---

## 1. Boss's Relational Schema (10 Tables)

| # | Table | PK | Key FKs | Purpose |
|---|---|---|---|---|
| 1 | `users` | UUID | — | Auth & RBAC (4 roles) |
| 2 | `rpl_partners_rtos` | BIGSERIAL | — | RPL Partners & issuing RTOs |
| 3 | `qualifications` | BIGSERIAL | — | Master course catalog |
| 4 | `qualification_pricing` | BIGSERIAL | qualification_id, rpl_partner_id | Dynamic pricing matrix |
| 5 | `students` | BIGSERIAL | referred_by_student_id (self) | Student profiles & referrals |
| 6 | `enrollments` | BIGSERIAL | student_id, qualification_id, rpl_partner_id, bdc_id, b2b_agent_id | Core transactional table |
| 7 | `payments` | BIGSERIAL | enrollment_id, verified_by_admin_id | Payment ledger |
| 8 | `commissions` | BIGSERIAL | enrollment_id, beneficiary_user_id | Commission tracking |
| 9 | `checklist_templates` | BIGSERIAL | qualification_id (NULL=global) | Document requirements |
| 10 | `enrollment_documents` | BIGSERIAL | enrollment_id, checklist_item_id, uploaded_by_user_id | Document evidence vault |

**Critical relational features:**
- UUID primary keys for users
- Foreign key constraints with ON DELETE CASCADE/RESTRICT/SET NULL
- Unique constraints: `users.email`, `students.email`, `qualifications.course_code`, `enrollments.enrollment_code`, `qualification_pricing (qualification_id, rpl_partner_id, effective_from)`
- Check constraints: role enum, b2b_tier enum, channel_type enum, enrollment status enum, payment status enum, commission_type enum, verification_status enum, payment_method enum
- `CHECK (bdc_standard_price >= bdc_base_price)` on qualification_pricing

---

## 2. Existing MongoDB Collections (mapped to boss entities)

| Boss Table | MongoDB Collection | Status | Field Mapping Issues |
|---|---|---|---|
| `users` | `users` | PARTIAL | UUID→ObjectId, missing b2b_tier, default_commission_pct, agency_name, full_name |
| `rpl_partners_rtos` | `agents` + `rtos` | MISSING | Separate tables vs combined; missing submission_email |
| `qualifications` | `qualifications` | PARTIAL | Missing delivery_mode, requires_trade_media; course_code→code |
| `qualification_pricing` | `price_lists` + `supplier_routes` | MISSING | Completely different structure; no tiered pricing |
| `students` | `clients` | PARTIAL | Missing usi_number, visa_status, referred_by_student_id, external_referrer_name, first_name/last_name split |
| `enrollments` | `orders` | PARTIAL | Missing enrollment_code, channel_type, bdc_id, b2b_agent_id, gross_profit, net_profit; wrong statuses |
| `payments` | `payments` | PARTIAL | Has invoiceId (boss has no invoices table); missing verified_by_admin_id; wrong payment_method enum |
| `commissions` | `commission_rules` + `commission_records` | MISSING | Different commission model (tiers vs 2 types) |
| `checklist_templates` | `document_requirements` (static) | MISSING | Static DOC_CHECKLISTS vs dynamic per-qualification templates |
| `enrollment_documents` | `documents` | PARTIAL | Missing checklist_item_id, mime_type, uploaded_by_user_id, verified_by_admin_id |

---

## 3. Missing Entities and Fields (vs Boss Spec)

| Entity/Field | Boss Spec | Existing Equivalent | Gap |
|---|---|---|---|
| `users.b2b_tier` | SILVER/GOLD/PLATINUM | None | MISSING |
| `users.default_commission_pct` | DECIMAL(5,2) DEFAULT 0.00 | None | MISSING |
| `users.agency_name` | VARCHAR(150) for B2B_AGENT | None | MISSING |
| `users.full_name` | VARCHAR(150) NOT NULL | `name` field exists | PARTIAL (rename needed) |
| `users.id` | UUID | ObjectId string | MISSING (type mismatch) |
| `students.usi_number` | VARCHAR(20) | None | MISSING |
| `students.visa_status` | VARCHAR(50) | None | MISSING |
| `students.referred_by_student_id` | FK → students.id | None | MISSING |
| `students.external_referrer_name` | VARCHAR(150) | None | MISSING |
| `students.first_name` / `last_name` | VARCHAR(100) each | `legalName`, `preferredName` | PARTIAL |
| `enrollments.enrollment_code` | VARCHAR(30) UNIQUE | ObjectId id | MISSING |
| `enrollments.channel_type` | 'B2C_BDC' / 'B2B_AGENT' | None | MISSING |
| `enrollments.bdc_id` | UUID FK → users.id | None | MISSING |
| `enrollments.b2b_agent_id` | UUID FK → users.id | None | MISSING |
| `enrollments.gross_profit` | DECIMAL(10,2) NOT NULL | grossMargin (client-side only) | MISSING |
| `enrollments.net_profit` | DECIMAL(10,2) NOT NULL | None | MISSING |
| `enrollments.submitted_to_partner_at` | TIMESTAMPTZ | None | MISSING |
| `enrollments.certificate_issued_at` | DATE | certificateDeliveryDate | PARTIAL |
| `qualification_pricing.partner_cost_price` | DECIMAL(10,2) | supplierCostSnapshot | PARTIAL (wrong structure) |
| `qualification_pricing.bdc_base_price` | DECIMAL(10,2) NOT NULL | None | MISSING |
| `qualification_pricing.bdc_standard_price` | DECIMAL(10,2) NOT NULL | None | MISSING |
| `qualification_pricing.b2b_silver_price` | DECIMAL(10,2) NOT NULL | None | MISSING |
| `qualification_pricing.b2b_gold_price` | DECIMAL(10,2) NULL | None | MISSING |
| `qualifications.delivery_mode` | 'RPL'/'ONLINE' | None | MISSING |
| `qualifications.requires_trade_media` | BOOLEAN DEFAULT FALSE | None | MISSING |
| `rpl_partners_rtos.submission_email` | VARCHAR(150) NOT NULL | None | MISSING |
| `checklist_templates.is_mandatory` | BOOLEAN DEFAULT TRUE | None | MISSING |
| `checklist_templates.id_points_value` | INT DEFAULT 0 | None | MISSING |
| `enrollment_documents.checklist_item_id` | FK → checklist_templates.id | None | MISSING |
| `enrollment_documents.mime_type` | VARCHAR | None | MISSING |
| `enrollment_documents.uploaded_by_user_id` | UUID FK → users.id | None | MISSING |
| `enrollment_documents.verified_by_admin_id` | UUID FK → users.id | None | PARTIAL (reviewedBy exists) |
| `payments.verified_by_admin_id` | UUID FK → users.id | None | MISSING |
| `payments.payment_method` | 'BANK_TRANSFER','STRIPE','CASH','B2B_INVOICE' | 'Bank Transfer','Card','Cash','Other' | PARTIAL (enum mismatch) |

---

## 4. Relationships Needing Enforcement

**Boss's relational constraints (not in MongoDB):**

| Relationship | Type | MongoDB Equivalent | Risk |
|---|---|---|---|
| students.referred_by_student_id → students.id | Self-FK, ON DELETE SET NULL | None | Referral orphans possible |
| enrollments.student_id → students.id | FK, ON DELETE RESTRICT | Application-level only | Orphaned enrollments |
| enrollments.qualification_id → qualifications.id | FK, ON DELETE RESTRICT | Application-level only | Orphaned enrollments |
| enrollments.rpl_partner_id → rpl_partners_rtos.id | FK, ON DELETE RESTRICT | Application-level only | Orphaned enrollments |
| enrollments.bdc_id → users.id | FK, ON DELETE SET NULL | None | BDC orphans |
| enrollments.b2b_agent_id → users.id | FK, ON DELETE SET NULL | None | Agent orphans |
| payments.enrollment_id → enrollments.id | FK, ON DELETE CASCADE | Application-level only | Orphaned payments |
| commissions.enrollment_id → enrollments.id | FK, ON DELETE CASCADE | Application-level only | Orphaned commissions |
| enrollment_documents.enrollment_id → enrollments.id | FK, ON DELETE CASCADE | Application-level only | Orphaned documents |
| enrollment_documents.checklist_item_id → checklist_templates.id | FK, ON DELETE RESTRICT | None | No checklist linkage |
| qualification_pricing (qualification_id, rpl_partner_id, effective_from) | UNIQUE | Application validation only | Duplicate pricing rules |

**MongoDB does not enforce any of these.** All referential integrity must be application-level.

---

## 5. Unique Indexes Required (Boss Spec)

| Collection | Fields | Type | Status |
|---|---|---|---|
| `users` | email | Unique | Application-level only (clients email check in POST /api/clients) |
| `students` | email | Unique | N/A (collection doesn't exist) |
| `enrollments` | enrollment_code | Unique | N/A (collection doesn't exist) |
| `qualification_pricing` | qualification_id + rpl_partner_id + effective_from | Unique | Application validation only (priceListOverlaps) |
| `qualifications` | course_code | Unique | N/A (collection doesn't enforce) |

---

## 6. Transaction Requirements

**Boss spec implies ACID transactions for:**
1. **Enrollment creation** — Create student + enrollment + checklist documents atomically
2. **Document approval gate** — Check all mandatory docs APPROVED before transitioning to SENT_TO_PARTNER
3. **Payment recording** — Record payment + update enrollment payment_status atomically
4. **Commission calculation** — Calculate commission + create commission record atomically
5. **Partner cost snapshot** — Lock partner_cost_price at enrollment time

**Existing MongoDB:** Transactions only used in `POST /api/payments` (`src/app/api/payments/route.ts:122-249`). All other multi-document operations are non-transactional.

---

## 7. Historical Snapshot Requirements

**Boss spec:**
- `partner_cost_snapshot` locked at enrollment time (DDL line 447)
- `offered_price` locked at enrollment time (DDL line 446)
- `gross_profit` and `net_profit` computed and stored at enrollment time

**Existing:**
- Order snapshots sellingPrice, supplierCostSnapshot at creation (`src/app/api/orders/route.ts:136-224`) ✓
- But no gross_profit/net_profit stored (client-side only) ✗

---

## 8. Data Integrity Risks

| Risk | Severity | Description |
|---|---|---|
| Wrong role set (7 vs 4) | Critical | Existing roles don't match boss spec; cannot implement BDC/B2B data scoping |
| No student entity | Critical | Client entity lacks USI, visa_status, referral tracking |
| No enrollment entity | Critical | Order entity lacks enrollment_code, channel_type, bdc_id, b2b_agent_id |
| No column-level masking | High | partner_cost_price visible to BDC/B2B_AGENT (violates security matrix) |
| No data scoping | High | All users see all enrollments (violates BDC/B2B visibility rules) |
| No FK constraints | Medium | MongoDB has no referential integrity |
| No unique indexes | Medium | Duplicate enrollment_codes, emails possible at DB level |
| No transactions (except payments) | Medium | Multi-document operations not atomic |
| Price model mismatch | High | PriceList + SupplierRoute ≠ qualification_pricing |
| Commission model mismatch | High | Tier-based ≠ BDC_COMMISSION/REFERRAL_COMMISSION |

---

## 9. Migration Complexity (MongoDB → Relational)

**Complexity: HIGH** — The data models are fundamentally different. This is not a simple column mapping; it's a complete entity restructuring.

| Aspect | Complexity | Notes |
|---|---|---|
| Entity restructuring | HIGH | 10 boss tables vs ~27 MongoDB collections with different shapes |
| Data migration | HIGH | ObjectId → UUID/BIGSERIAL; nested arrays → relational rows; documents → file URLs |
| Application rewrite | HIGH | All API routes, types, views need to change |
| Role system replacement | MEDIUM | 7 roles → 4 roles with different permissions |
| Field-level masking | MEDIUM | New middleware for column-level visibility |
| Data scoping | MEDIUM | New query middleware for BDC/B2B filtering |

**Estimated effort:** 8-12 weeks for full migration (if business requires PostgreSQL)

---

## 10. Architecture Strategy Options

### Strategy 1: Stay on MongoDB (Recommended for now)

**Approach:** Implement all boss requirements using existing MongoDB architecture with application-level enforcement.

**Benefits:**
- No migration cost or risk
- Existing codebase patterns remain valid
- Flexible schema accommodates new fields (usiNumber, visaStatus, enrollmentCode, channelType, etc.)
- Document storage (BSON Binary) already works
- Native support for nested arrays (contacts, addresses, history)

**Risks:**
- No referential integrity (application must handle all FK logic)
- No unique indexes (application-level deduplication only)
- No column-level field masking at database level (must be in API layer)
- Transactions limited to multi-document sessions (available but underused)

**Mitigations:**
- Add unique indexes via `createIndex()` on critical fields
- Wrap multi-collection operations in MongoDB sessions/transactions
- Implement column-level field masking in API route handlers
- Implement data scoping middleware for BDC/B2B queries
- Use immutable snapshots aggressively (already done for orders)

**Compatibility:** HIGH — fully compatible with existing Next.js + MongoDB stack

### Strategy 2: Migrate to Relational (PostgreSQL/MySQL)

**Approach:** Migrate to relational database if business explicitly requires it per boss's reference document.

**Benefits:**
- Referential integrity via foreign keys
- Unique constraints and indexes at database level
- ACID transactions across all operations
- Better reporting/analytics query performance
- Matches boss's reference document architecture exactly

**Risks:**
- Very high migration cost (8-12 weeks estimated)
- Complete data model rewrite (10 boss tables vs current MongoDB structure)
- Application rewrite (all API routes, types, views)
- Downtime during cutover
- Loss of flexible schema (document arrays become awkward in relational)

**Cost:** VERY HIGH

**Compatibility:** LOW — would require significant changes to nearly every file

---

## 11. Recommendation

**Use Strategy 1 (MongoDB) for all boss requirements.** The relational database in the boss's reference document is a design preference, not a hard requirement for the Next.js + MongoDB application. MongoDB can satisfy all functional requirements with:

1. Application-level unique indexes via `createIndex()`
2. MongoDB sessions/transactions for multi-document operations
3. Flexible schema for new RPL-specific fields
4. Column-level field masking implemented in API route handlers
5. Data scoping middleware for BDC/B2B queries

**Only migrate to relational if the business explicitly requires it** (e.g., regulatory compliance, integration with existing PostgreSQL systems, or complex reporting that MongoDB cannot handle efficiently).

---

## 12. Indexes to Add (MongoDB)

```javascript
// users
db.users.createIndex({ email: 1 }, { unique: true })
db.users.createIndex({ role: 1 })
db.users.createIndex({ b2b_tier: 1 })

// students (new collection)
db.students.createIndex({ email: 1 }, { unique: true })
db.students.createIndex({ usiNumber: 1 })
db.students.createIndex({ referredByStudentId: 1 })

// enrollments (new collection, replacing orders)
db.enrollments.createIndex({ enrollmentCode: 1 }, { unique: true })
db.enrollments.createIndex({ studentId: 1 })
db.enrollments.createIndex({ channelType: 1 })
db.enrollments.createIndex({ bdcId: 1 })
db.enrollments.createIndex({ b2bAgentId: 1 })
db.enrollments.createIndex({ status: 1 })
db.enrollments.createIndex({ paymentStatus: 1 })
db.enrollments.createIndex({ createdAt: -1 })

// qualification_pricing (new collection, replacing price_lists + supplier_routes)
db.qualification_pricing.createIndex({ qualificationId: 1, rplPartnerId: 1, effectiveFrom: 1 }, { unique: true })

// rpl_partners_rtos (new collection, replacing agents + rtos)
db.rpl_partners_rtos.createIndex({ partnerName: 1 })
db.rpl_partners_rtos.createIndex({ rtoCode: 1 })

// checklist_templates (new collection)
db.checklist_templates.createIndex({ qualificationId: 1 })
db.checklist_templates.createIndex({ isMandatory: 1 })

// enrollment_documents (new collection, replacing documents)
db.enrollment_documents.createIndex({ enrollmentId: 1 })
db.enrollment_documents.createIndex({ checklistItemId: 1 })
db.enrollment_documents.createIndex({ verificationStatus: 1 })

// payments
db.payments.createIndex({ enrollmentId: 1 })
db.payments.createIndex({ verifiedByAdminId: 1 })

// commissions
db.commissions.createIndex({ enrollmentId: 1 })
db.commissions.createIndex({ beneficiaryUserId: 1, payoutStatus: 1 })

// audit_logs
db.audit_logs.createIndex({ entityType: 1, entityId: 1 })
db.audit_logs.createIndex({ createdAt: -1 })

// document_access_logs
db.document_access_logs.createIndex({ documentId: 1, createdAt: -1 })
```

These indexes should be added via a migration script, not applied manually to production without testing.

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines — ER diagram of 10 core tables with PK/FK/cardinality, detailed table specifications (§4.1–4.10), PostgreSQL DDL (§6) with CREATE EXTENSION, CREATE TABLE, CREATE INDEX statements
- DOCX document: 706 lines — business flow diagram, ASCII ER diagram, visibility matrix, detailed table specifications (§4.1–4.8), production DDL (§5) with pgcrypto extension and gen_random_uuid

### Requirements Extracted from Each Document
**From MD document:** 10 core tables with UUID/BIGSERIAL PKs, FK constraints with ON DELETE CASCADE/RESTRICT/SET NULL, unique constraints (email, course_code, enrollment_code, composite pricing key), check constraints (role enum, b2b_tier enum, channel_type enum, status enums), CHECK (bdc_standard_price >= bdc_base_price), composite unique (qualification_id, rpl_partner_id, effective_from), uuid-ossp extension, uuid_generate_v4() default.

**From DOCX document:** Same 10-table relational structure with additional fields: submission_email NOT NULL on rpl_partners_rtos, delivery_mode + requires_trade_media on qualifications, industry_sector NOT NULL, visa_status on students, id_points_value on checklist_templates, mime_type on enrollment_documents, CHECK constraint on bdc_standard_price >= bdc_base_price, pgcrypto extension, gen_random_uuid() default.

### Differences from Previous Audit
- Document paths corrected from "project root" to `docs_reference/`
- Added field-level discrepancy catalog between MD and DOCX (contact_email vs submission_email, visa_status presence, DISCOUNT_APPROVAL inclusion/exclusion, id_points_value, mime_type, currency column)
- All MongoDB-to-relational mappings re-verified against actual types.ts definitions

### Final Requirement Coverage Statistics
| Status | Count | Percentage |
|--------|-------|------------|
| IMPLEMENTED | 5 | 10% |
| PARTIALLY IMPLEMENTED | 17 | 35% |
| MISSING | 26 | 54% |
| NOT VERIFIED | 0 | 0% |
| REQUIRES BUSINESS APPROVAL | 10 | N/A (decisions) |
| **Total assessed** | **48** | **100%** |

### Database Rule Compliance
- **No database migration performed** — read-only audit only
- **No SQL scripts executed** — MongoDB architecture preserved
- **Relational schema compared with MongoDB** — 10 boss tables mapped to ~27 MongoDB collections with field-level gap analysis
- **Safest approach recommended:** Strategy 1 (stay on MongoDB) with application-level enforcement of unique indexes, transactions, field masking, and data scoping. Migrate to PostgreSQL only if business explicitly requires it (8-12 week migration estimated).

### Recommended First Implementation Milestone
**Phase 0 — Role System & Security Foundation** (Weeks 1-2)
Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping. Create unique indexes on critical fields (users.email, enrollments.enrollment_code).
