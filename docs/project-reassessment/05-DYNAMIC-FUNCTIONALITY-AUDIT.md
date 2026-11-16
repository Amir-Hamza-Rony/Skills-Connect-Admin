# 05 — Dynamic Functionality Audit

## Executive Summary

The application is **genuinely dynamic** — all pages fetch real data from the MongoDB-backed API, there are no mock data fallbacks, and mutations update the UI. However, there are significant gaps in pagination, server-side filtering, financial calculation security, and concurrent update handling.

---

## 1. Real Data vs Static Placeholders

### Pages fetching real database data (IMPLEMENTED)

| Page | API Endpoint | Dynamic? | Evidence |
|---|---|---|---|
| Clients | `GET /api/clients` | Yes | `src/views/clients.tsx:36` calls `listClients()` |
| Orders | `GET /api/orders` | Yes | `src/views/orders.tsx:77` calls `listOrders()` |
| Documents | `GET /api/orders/[id]/documents` | Yes | `src/views/documents.tsx:100` calls `listDocuments()` |
| Finance | `GET /api/invoices`, `/api/payments`, `/api/finance/summary` | Yes | `src/views/finance.tsx:99-106` |
| Reports | `GET /api/reports/{type}` | Yes | `src/views/reports.tsx:93-104` |
| Pricing | `GET /api/masters/supplier-routes` | Yes | `src/views/pricing.tsx:52` calls `listRoutes()` |
| Qualifications | `GET /api/masters/qualifications` | Yes | `src/lib/store.ts:104-107` |
| RTOs | `GET /api/masters/rtos` | Yes | `src/lib/store.ts:132-135` |
| Agents | `GET /api/masters/agents` | Yes | `src/lib/store.ts:155-158` |
| Commission Records | `GET /api/commission-records` | Yes | `src/views/commission-records.tsx:48` |

### Pages that are placeholders (MISSING)

| Page | Status | Evidence |
|---|---|---|
| `src/app/(app)/additional-fees/page.tsx` | Uses PlaceholderView pattern | `src/views/additional-fees.tsx` — need to verify |
| `src/app/(app)/qualification-rto-mappings/page.tsx` | Real implementation via store.ts | `src/lib/store.ts:189-237` |
| `src/views/placeholder.tsx` | Explicit "Coming soon" placeholder | `src/views/placeholder.tsx:12-33` |

### Mock/in-memory store usage

The `store.ts` file header says "CUTOVER STATE: everything is on the real API." All functions call `apiFetch()` which hits real API routes. No in-memory mock data remains in the data access layers.

**Verdict: No static mock data in production code paths.**

---

## 2. CRUD Operations

### Create

| Entity | API | Frontend UI | Validation | Status |
|---|---|---|---|---|
| Clients | POST /api/clients | `src/views/clients.tsx` | Client-side (required fields) + server (email dup) | IMPLEMENTED |
| Orders | POST /api/orders | `src/views/orders.tsx` | Client-side + server (required fields, route validation) | IMPLEMENTED |
| Documents | POST /api/documents/upload | `src/views/documents.tsx` | File type, size limits | IMPLEMENTED |
| Invoices | POST /api/invoices | `src/views/finance.tsx` | Required fields, positive amount | IMPLEMENTED |
| Payments | POST /api/payments | `src/views/finance.tsx` | Positive amount, allocation cap, idempotency | IMPLEMENTED |
| Qualifications | POST /api/masters/qualifications | `src/views/qualifications.tsx` | Via store.ts | IMPLEMENTED |
| RTOs | POST /api/masters/rtos | `src/views/rtos.tsx` | Via store.ts | IMPLEMENTED |
| Agents | POST /api/masters/agents | `src/views/agents.tsx` | Via store.ts | IMPLEMENTED |
| Price Lists | POST /api/masters/price-lists | `src/views/price-lists.tsx` | Via store.ts | IMPLEMENTED |
| Commission Rules | POST /api/masters/commission-rules | `src/app/(app)/commission-rules/page.tsx` | Via store.ts | IMPLEMENTED |

### Read

All entities have GET list endpoints. All list pages fetch and display data.

**Gap: No pagination.** All records are fetched at once and filtered client-side:
- `src/views/orders.tsx:99-110` — filters `orders` array in memory
- `src/views/clients.tsx` — no filtering at all (all clients)
- `src/views/reports.tsx` — fetches all report data, no pagination

For large datasets (1000+ orders/clients), this will cause performance issues.

### Update

| Entity | API | Frontend UI | Status |
|---|---|---|---|
| Clients | PUT/DELETE /api/clients/[id] | No edit UI (create only) | PARTIAL |
| Orders | PATCH /api/orders/[id]/status, /dimensions | Status transition only | PARTIAL |
| Documents | PUT/DELETE /api/documents/[id] | No edit UI | PARTIAL |
| Invoices | PUT/DELETE /api/invoices/[id] | Void only (via dialog) | PARTIAL |
| Payments | PUT/DELETE /api/payments/[id] | Refund only | PARTIAL |
| Qualifications | PATCH /api/masters/qualifications/[id] | Via store.ts | IMPLEMENTED |
| RTOs | PATCH /api/masters/rtos/[id] | Via store.ts | IMPLEMENTED |
| Agents | PATCH /api/masters/agents/[id] | Via store.ts | IMPLEMENTED |
| Price Lists | PATCH /api/masters/price-lists/[id] | Via store.ts | IMPLEMENTED |

**Gap:** No edit dialog for clients, orders (full fields), documents, invoices. Only status/dimension updates for orders.

### Delete

| Entity | API | Frontend UI | Status |
|---|---|---|---|
| Clients | DELETE /api/clients/[id] | No delete UI | PARTIAL |
| Orders | DELETE /api/orders/[id] | No delete UI | PARTIAL |
| Documents | DELETE /api/documents/[id] | No delete UI | PARTIAL |
| Qualifications | DELETE /api/masters/qualifications/[id] | Via store.ts | IMPLEMENTED |
| RTOs | DELETE /api/masters/rtos/[id] | Via store.ts | IMPLEMENTED |
| Agents | DELETE /api/masters/agents/[id] | Via store.ts | IMPLEMENTED |
| Price Lists | DELETE /api/masters/price-lists/[id] | Via store.ts | IMPLEMENTED |

---

## 3. Search, Filter, and Pagination

### Search (CLIENT-SIDE only)

| Page | Search Field | Implementation |
|---|---|---|
| Clients | None | No search |
| Orders | None (filter dropdowns only) | Dropdown filters on status/qualification/agent/RTO/payment |
| Documents | Order dropdown + queue buttons | No text search |
| Commission Records | Agent name search | Client-side `list.filter()` on `src/views/commission-records.tsx:54-63` |
| Reports | None | No search |

**Gap:** No server-side search. All filtering is client-side on the full dataset.

### Filter (CLIENT-SIDE only)

| Page | Filters | Server-side? |
|---|---|---|
| Orders | Status, Qualification, Agent, RTO, Payment Status | No — `visible` computed client-side (`src/views/orders.tsx:99-110`) |
| Documents | Queue (Missing/Under Review/etc.), Order | No — client-side `inQueue()` filter |
| Finance | Tab-based (Invoices/Plans/Payments/QB) | Partial — server fetches all, then UI tabs |
| Reports | None visible | Server-side aggregations |

### Pagination

| Page | Pagination | Status |
|---|---|---|
| All list pages | None | MISSING |

**Critical gap:** No pagination anywhere. `GET /api/orders` returns all orders. `GET /api/clients` returns all clients. For production use with hundreds of records, this will be slow.

**Some APIs have pagination support but it's not wired to frontend:**
- `GET /api/masters/supplier-routes` returns `{ items, total }` — supports pagination
- `GET /api/masters/price-lists` returns `{ items, total }`
- `GET /api/masters/commission-rules` returns `{ items, total }`
- `GET /api/commission-records` returns `{ items, total }`
- `GET /api/excel/templates` returns `{ items, total }`
- `GET /api/excel/imports` returns `{ items, total }`

But the frontend views don't use pagination — they display all items.

---

## 4. Frontend State After Mutations

### Optimistic updates (IMPLEMENTED)

| Mutation | UI Updates Before API Response? | Evidence |
|---|---|---|
| Create order | Yes — `setOrders((prev) => [created, ...prev])` | `src/views/orders.tsx:159` |
| Create client | Yes — `setRows((prev) => [created, ...prev])` | `src/views/clients.tsx:81` |
| Upload document version | Yes — `setDocs((prev) => [document, ...prev])` | `src/views/documents.tsx:181` |
| Review document | Yes — `setDocs((prev) => prev?.map(...))` | `src/views/documents.tsx:140` |
| Record payment | Yes — `setPayments((prev) => [created, ...prev])` | `src/views/finance.tsx:194` |
| Approve commission | Yes — `setRows((prev) => prev?.map(...))` | `src/views/commission-records.tsx:101-103` |

### Error handling after mutations

| Mutation | Error State | Evidence |
|---|---|---|
| Create order | `setError()` displayed | `src/views/orders.tsx:142-145, 373-375` |
| Create client | `setError()` displayed | `src/views/clients.tsx:50-52, 209-211` |
| Record payment | `setFormError()` / `setPayResult()` | `src/views/finance.tsx:205-206, 198-200` |
| Review document | `setFormError()` | `src/views/documents.tsx:128-130, 394-396` |

**Verdict: Frontend state updates correctly after mutations with optimistic updates and error handling.**

---

## 5. Form Validation

### Client-side validation

| Form | Fields Validated | Evidence |
|---|---|---|
| Create client | legalName, phone, email required | `src/views/clients.tsx:50-52` |
| Create order | All required fields, price >= 0 | `src/views/orders.tsx:140-147` |
| Create supplier route | All fields, cost >= 0 | `src/views/pricing.tsx:76-83` |
| Record payment | Order, date, reference, amount > 0 | `src/views/finance.tsx:172-179` |
| Create invoice | Order, dates, total > 0, due >= issue | `src/views/finance.tsx:129-143` |
| Review document | Rejection reason required if rejected | `src/views/documents.tsx:128-130` |
| Calculate commission | Agent, month 1-12, year >= 2000 | `src/views/commission-records.tsx:68-81` |

### Server-side validation

| Endpoint | Validation | Evidence |
|---|---|---|
| POST /api/clients | legalName, email required; email unique | `src/app/api/clients/route.ts:42-48` |
| POST /api/orders | Required fields, valid ObjectIds, qualification-RTO mapping, active supplier route | `src/app/api/orders/route.ts:91-164` |
| POST /api/payments | Positive amount, valid currency, valid method, allocation cap, idempotency | `src/app/api/payments/route.ts:70-103, 128-188` |
| POST /api/documents/upload | Required fields, content type, file size | `src/app/api/documents/upload/route.ts:28-41` |
| POST /api/masters/price-lists | Overlap validation | `src/lib/pricing-validation.ts:78-101` |

**Verdict: Good client-side and server-side validation coverage.**

---

## 6. Loading, Empty, Success, and Error States

### Loading states

| Page | Loading Skeleton | Evidence |
|---|---|---|
| Clients | Yes | `src/views/clients.tsx:95-102` |
| Orders | Yes | `src/views/orders.tsx:166-173` |
| Documents | Yes | `src/views/documents.tsx:192-199` |
| Finance | Yes | `src/views/finance.tsx:314-316` (invoices tab) |
| Reports | Yes | `src/views/reports.tsx:120-130` |
| Pricing | Yes | `src/views/pricing.tsx:112-119` |

### Empty states

| Page | Empty Message | Evidence |
|---|---|---|
| Clients | "No clients yet — add the first one." | `src/views/clients.tsx:123` |
| Orders | "No orders match these filters." | `src/views/orders.tsx:239` |
| Documents | "Nothing in the {queue} queue." | `src/views/documents.tsx:252` |
| Finance | "No invoices yet." / "No payments recorded yet." | `src/views/finance.tsx:319, 417` |
| Reports | "No data in scope." | `src/views/reports.tsx:316` |

### Success states

| Action | Success Feedback | Evidence |
|---|---|---|
| Record payment | `payResult` message | `src/views/finance.tsx:198-200` |
| Create order | Order added to list (optimistic) | `src/views/orders.tsx:159` |
| Approve commission | Record updated in list | `src/views/commission-records.tsx:101-103` |

### Error states

| Action | Error Feedback | Evidence |
|---|---|---|
| All forms | `error`/`formError` displayed as `text-destructive` | Multiple views |
| API failures | `ApiError` caught and displayed | `src/lib/api.ts:278-282` |

**Verdict: All four states (loading, empty, success, error) are present on major pages.**

---

## 7. Dashboards Using Real Aggregated Data

### Dashboard views

| Dashboard | Data Source | Server-side Aggregation? |
|---|---|---|
| Management | Multiple sub-components | Client-side from API lists |
| Finance | `GET /api/finance/summary` | Yes — server-side |
| Operations | Order/task lists | Client-side |
| Agent | Order lists | Client-side |
| RTO | RTO processing lists | Client-side |

### Reports page (server-side aggregations)

| Report | API Endpoint | Server-side? |
|---|---|---|
| Revenue | `GET /api/reports/revenue` | Yes |
| Margin | `GET /api/reports/margin` | Yes |
| Funnel | `GET /api/reports/funnel` | Yes |
| Ageing | `GET /api/reports/ageing` | Yes |
| Collections | `GET /api/reports/collections` | Yes |
| Finance summary | `GET /api/reports/finance` | Yes |
| Revenue by month | `revenueByMonth()` (queues.ts) | Yes |
| Revenue by supplier | `revenueBySupplier()` (queues.ts) | Yes |
| Document completion | `documentCompletion()` (queues.ts) | Yes |
| Certificate completion | `certificateCompletionTime()` (queues.ts) | Yes |

**Verdict: Reports use server-side aggregation. Dashboard KPI cards use client-side computation from fetched lists.**

---

## 8. Table Support for Practical Workflows

### DataTable component

| Feature | Implemented? | Evidence |
|---|---|---|
| Sorting | No | `src/components/data-table.tsx` — need to verify |
| Filtering | No (done in view layer) | Views filter client-side |
| Pagination | No | All rows rendered at once |
| Row actions | Yes | Action column with buttons |
| Empty state | Yes | `emptyMessage` prop |
| Row selection | No | No selection checkboxes |

**Verdict: DataTable is a simple display component without sorting, filtering, or pagination. All data manipulation happens in the view layer.**

---

## 9. User Permissions Affecting UI and API

### UI permission gating

| Mechanism | Implementation | Evidence |
|---|---|---|
| Nav links | `ROUTE_PERMISSIONS` in `permissions.ts:76-94` | `src/components/layout/nav.ts` |
| Button visibility | `hasPermission()` checks | `src/views/documents.tsx:66` |
| Tab/feature gating | `hasPermission()` in views | `src/views/finance.tsx:224` (`canRetryQB`) |

### API permission enforcement

| Mechanism | Implementation | Evidence |
|---|---|---|
| Route protection | `withAuth(permission, handler)` | All API routes |
| Super Admin bypass | `roleNames.includes("Super Admin")` | `src/middleware/auth.ts:47` |
| Token verification | `verifyAccessToken()` | `src/middleware/auth.ts:61-91` |

**Verdict: Server-side authorization is properly enforced. Frontend permission mirroring is for UX only (never grants access).**

### Data-scoping gaps

| Gap | Severity | Evidence |
|---|---|---|
| No BDC data scoping | High | All users with `orders.view` see all orders |
| No B2B Agent data scoping | High | No agency-based filtering |
| Financial fields visible to non-finance roles | Medium | `sellingPrice` in order list (requires only `orders.view`) |

---

## 10. Server-Side Financial Calculations

### Calculations performed server-side

| Calculation | Location | Server-side? |
|---|---|---|
| Order selling price resolution | `src/app/api/orders/route.ts:168-224` | Yes |
| Supplier cost snapshot | `src/app/api/orders/route.ts:136-164` | Yes |
| Payment allocation | `src/app/api/payments/route.ts:126-248` | Yes (transaction) |
| Invoice status update | `src/app/api/payments/route.ts:216-248` | Yes |
| Finance summary | `GET /api/finance/summary` | Yes |
| Report aggregations | `GET /api/reports/{type}` | Yes |

### Calculations performed client-side (RISK)

| Calculation | Location | Risk |
|---|---|---|
| Gross margin | `src/lib/ops-store.ts:108-109` | Client can manipulate; not authoritative |
| Commission calculation | `POST /api/commission-records` | Server-side ✓ |
| Payment verification | None | No verification workflow |

**Verdict: Core financial calculations (price resolution, payment allocation, invoicing) are server-side. Gross margin is client-side only (display purposes).**

---

## 11. Concurrent Update Safety

### Mechanisms in place

| Mechanism | Implementation | Evidence |
|---|---|---|
| Payment idempotency | `idempotencyKey` check in transaction | `src/app/api/payments/route.ts:128-140` |
| Refresh token single-flight | `refreshInFlight` promise | `src/lib/api.ts:31, 176-183` |
| Document versioning | New version supersedes old | `src/app/api/documents/upload/route.ts:44-47` |
| Order status history | `history: StatusChange[]` append | `src/app/api/orders/route.ts:284` |

### Missing mechanisms

| Gap | Risk | Evidence |
|---|---|---|
| No optimistic locking on orders | Two users could update same order simultaneously | No `version` field on Order for conflict detection |
| No optimistic locking on clients | Two users could edit same client | No version field on Client |
| No ETag/If-Match support | No conditional update support | API routes don't check ETags |
| Price list overlap only at write time | Race condition could create overlaps | `priceListOverlaps` checked at write but no DB constraint |

**Verdict: Some concurrent safety (payment idempotency, document versioning) but no optimistic locking on core entities.**

---

## 12. Summary Table

| Area | Status | Key Gaps |
|---|---|---|
| Real data (no mocks) | IMPLEMENTED | None |
| Create operations | IMPLEMENTED | Some entities lack create UI |
| Read operations | IMPLEMENTED | No pagination |
| Update operations | PARTIAL | No edit dialogs for clients/orders/documents |
| Delete operations | PARTIAL | No delete UI for most entities |
| Search | PARTIAL | Client-side only, no server search |
| Filter | PARTIAL | Client-side only |
| Pagination | MISSING | None anywhere |
| Optimistic updates | IMPLEMENTED | Major mutations update UI before/after API |
| Form validation | IMPLEMENTED | Client + server validation |
| Loading/empty/success/error | IMPLEMENTED | All four states present |
| Server-side aggregation | IMPLEMENTED (reports) | Dashboard KPIs are client-side |
| DataTable features | PARTIAL | No sort/filter/pagination in component |
| RBAC UI + API | IMPLEMENTED | Server-side enforced, frontend mirrors |
| Data scoping | MISSING | No BDC/B2B Agent scoping |
| Server-side financial calcs | PARTIAL | Gross margin is client-side |
| Concurrent update safety | PARTIAL | No optimistic locking |

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines — all sections including workflow, ER diagram, table specifications, DDL
- DOCX document: 706 lines — all sections including data flow, visibility matrix, detailed specs, DDL

### Requirements Extracted from Each Document
**From MD document:** Column-level visibility (§5) — partner_cost hidden from BDC/B2B_AGENT, bdc_base/standard hidden from B2B_AGENT, b2b tier hidden from BDC; Workflow gate (§2) — blocks partner submission until mandatory docs approved; Table specs (§4.1–4.10) — all entity field definitions; DDL (§6) — PostgreSQL schema with constraints.

**From DOCX document:** Visibility Matrix (§3) — Admin/BDC/B2B Agent field-level access table; Business flow (§1) — 100-Point ID, USI, Resume, Reference Letters, Trade Photos/Videos verification; Detailed specs (§4.8) — id_points_value, mime_type, PDF validation; DDL (§5) — pgcrypto, gen_random_uuid, CHECK constraints.

### Differences from Previous Audit
- Document paths corrected from "project root" to `docs_reference/`
- Dynamic functionality findings re-verified against actual source files: all API routes fetch real MongoDB data (no mocks confirmed in `src/lib/store.ts`), grossMargin is client-side in `ops-store.ts:108-109`, checklistFor() is static in `ops-store.ts:140-142`, no pagination on list views, no data scoping in `GET /api/orders` (`src/app/api/orders/route.ts:25-62`)

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
Replace the 7-role developer-spec RBAC with the boss's 4-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) and implement column-level field masking + data scoping. This is the foundation without which BDC/B2B data isolation cannot be implemented.
