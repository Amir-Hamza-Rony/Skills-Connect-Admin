# Phase 5 — Excel Migration Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Baseline:** Phases 0–4 complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 71 tests PASS (Phases 0–4).  
**Database:** `skills_connect_admin` — contains data from Phases 0–4 (clients, orders, invoices, payments, qualifications, rtos, agents, supplier-routes, price_lists, etc.).  
**New dependency:** `exceljs` added for .xlsx/.xlsx parsing and generation (no Excel library existed previously; .xlsx is a proprietary binary format that cannot be parsed without a library).

---

## Existing implementation status

### Excel import — NOT IMPLEMENTED
No Excel import/export infrastructure exists anywhere in the codebase:
- No `excel_imports`, `excel_import_rows`, or `excel_import_templates` collections.
- No API routes for import templates, upload, preview, or execution.
- No frontend pages for import management.
- No Excel parsing or generation library was installed (now added: `exceljs`).
- No document upload route exists specifically for Excel bulk import (the existing `/api/documents/upload` is for per-order document evidence, not bulk data import).

### Reports — PARTIALLY IMPLEMENTED
Existing report API routes (server-side aggregation, `reports.view` permission):
| Route | Report | Status |
|-------|--------|--------|
| `GET /api/reports/finance` | Headline finance (invoiced/collected/outstanding) | Implemented |
| `GET /api/reports/revenue` | Revenue by qualification + agent | Implemented |
| `GET /api/reports/margin` | Margin by qualification | Implemented |
| `GET /api/reports/ageing` | Overdue invoice ageing buckets | Implemented |
| `GET /api/reports/collections` | Monthly collections | Implemented |
| `GET /api/reports/funnel` | Orders by workflow stage | Implemented |
| `GET /api/reports/document-completion` | Document approval/rejection by type | Implemented |
| `GET /api/reports/certificate-completion-time` | Certificate turnaround stats | Implemented |
| `GET /api/reports/revenue-by-month` | Monthly invoiced vs collected | Implemented |
| `GET /api/reports/revenue-by-supplier` | Revenue by source agent + RTO | Implemented |
| `GET /api/reports/rto-turnaround` | RTO submission turnaround | Implemented |

**Missing reports (Phase 5 requirements):**
- Client Report — no per-client aggregation endpoint.
- Order Report — no per-order detail/status aggregation endpoint.
- Outstanding Receivables Report — no per-customer outstanding balance with ageing.
- Supplier Cost / Payables Report — no supplier cost aggregation.
- Agent Commission Report — no commission per agent aggregation.
- Monthly Financial Summary — partially covered by finance + collections + revenue-by-month but no combined monthly summary endpoint.

**Export — NOT IMPLEMENTED:** No Excel or PDF export for any report.

### Frontend — PARTIALLY IMPLEMENTED
- `src/views/reports.tsx` — existing reports dashboard page (consumes the 11 report API routes above).
- No import templates page, no Excel upload/preview page, no import history page.
- No export buttons on any report.

---

## Confirmed issues & required schema changes

### E-1 — No import template management (Critical gap)

**Business impact:** Users cannot define reusable column mappings for bulk client/order/RTO/agent imports. Every import would require ad-hoc mapping.

**Recommended solution:** Create `excel_import_templates` collection:
`{ _id, name, scope (client|order|rto|agent|qualification), columnMappings: [{ sourceColumn, targetField, required, dataType, validation }], createdBy, createdAt, updatedAt, status }`
Unique index on `name`. API: `GET/POST /api/excel/templates`, `GET/PATCH/DELETE /api/excel/templates/[id]`.

**Priority:** Critical

### E-2 — No Excel upload/parse endpoint (Critical gap)

**Business impact:** Cannot upload .xlsx/.xls files for bulk data import.

**Recommended solution:** Create `POST /api/excel/upload` that:
- Accepts multipart/form-data with a file.
- Validates file type (.xlsx/.xls only) and size (e.g., max 10 MB).
- Parses with `exceljs` (read-only, no formula evaluation, no macro execution).
- Returns preview: headers, row count, first N rows, unmapped columns.
- Does NOT persist data — preview only.

**Priority:** Critical

### E-3 — No import validation (High gap)

**Business impact:** Invalid rows (missing required fields, bad references, duplicates) would corrupt master data if imported without validation.

**Recommended solution:** Validation service that checks each row:
- Required fields present.
- Reference IDs exist in target collections (clients, qualifications, rtos, agents, supplier-routes).
- No duplicate keys (e.g., duplicate client email, duplicate qualification code).
- Returns row-level errors/warnings.

**Priority:** High

### E-4 — No import execution/history (High gap)

**Business impact:** Cannot actually import validated data; no audit trail of who imported what and when.

**Recommended solution:** Create `excel_imports` and `excel_import_rows` collections:
- `excel_imports`: `{ _id, templateId, filename, status (pending|processing|completed|failed|rolledback), rowCounts: { total, success, failed, skipped }, startedBy, startedAt, completedAt, errorSummary }`
- `excel_import_rows`: `{ _id, importId, rowNumber, sourceData, status (success|failed|skipped), errorMessage, targetRecordId }`
- API: `POST /api/excel/import`, `GET /api/excel/imports`, `GET /api/excel/imports/[id]`.

**Priority:** High

---

## Data model for new collections

### `excel_import_templates`
| Field | Type | Description |
|-------|------|-------------|
| _id | ObjectId | Primary key |
| name | string | Template name (unique) |
| scope | string | "clients" \| "orders" \| "rtos" \| "agents" \| "qualifications" |
| columnMappings | array | [{ sourceColumn, targetField, required, dataType, validation }] |
| createdBy | string | Actor userId |
| createdAt | Date | |
| updatedAt | Date | |
| status | string | "active" \| "inactive" |

Indexes: unique `name`.

### `excel_imports`
| Field | Type | Description |
|-------|------|-------------|
| _id | ObjectId | Primary key |
| templateId | ObjectId | Reference to template |
| filename | string | Original uploaded filename |
| status | string | "pending" \| "processing" \| "completed" \| "failed" \| "rolledback" |
| rowCounts | object | { total, success, failed, skipped } |
| startedBy | string | Actor userId |
| startedAt | Date | |
| completedAt | Date | |
| errorSummary | string | Aggregated error notes |

Indexes: `startedBy`, `status`, `createdAt`.

### `excel_import_rows`
| Field | Type | Description |
|-------|------|-------------|
| _id | ObjectId | Primary key |
| importId | ObjectId | Reference to import |
| rowNumber | number | Excel row number |
| sourceData | object | Raw row cell values |
| status | string | "success" \| "failed" \| "skipped" |
| errorMessage | string | Validation/import error |
| targetRecordId | string | Created record id (if success) |

Indexes: `importId`, `rowNumber`, `status`.

---

## Migration considerations

- All three collections are new — no existing data to migrate.
- No destructive migration required.
- Migration scripts should be idempotent (create indexes if not exist).
- Import execution must be transaction-safe where MongoDB supports it (multi-document transactions available).
- Failed imports must not leave partial data — rollback on failure.

---

## Implementation sequence

1. Audit documents (this file + reports + production readiness).
2. Add `exceljs` dependency (done).
3. Import templates API + UI.
4. Excel upload/parse API + UI (preview).
5. Import validation service.
6. Import execution API + UI (with history).
7. Reports: client, order, outstanding receivables, supplier cost/payables, agent commission, monthly financial summary.
8. Report export (Excel + PDF).
9. Production readiness review + fixes.
10. Tests + verification.
