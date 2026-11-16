# 02 — Existing Project Architecture

## 1. Technology Stack

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | Next.js | ^16.4.3 | App Router + Route Handlers |
| React | React | ^19.2.8 | Client components |
| Language | TypeScript | ~6.0.2 | Strict mode |
| Styling | Tailwind CSS | ^4.3.3 | Via globals.css, no tailwind.config.js |
| UI Library | shadcn/ui | — | new-york style, 5 primitives |
| Icons | lucide-react | ^1.53.0 | |
| Database | MongoDB | ^6.8.0 | Native driver, no Mongoose |
| Password hashing | argon2id | ^0.45.1 | |
| Auth | JWT HS256 + httpOnly rotating refresh | Custom | 15-min access, 7-day refresh |
| File storage | MongoDB BSON Binary | Native driver | Document bytes in DB |
| Excel processing | exceljs | ^4.4.0 | Import/export |
| PDF generation | pdfkit | ^0.20.2 | |
| Linting | oxlint | ^1.81.0 | |
| Testing | vitest | ^5.1.0 | 9 test files |
| MongoDB test | mongodb-memory-server | ^11.3.0 | |

## 2. Project Directory Structure

```
src/
├── app/
│   ├── (app)/                    # Authenticated route group (~30 pages)
│   │   ├── dashboard/page.tsx
│   │   ├── clients/page.tsx, clients/[id]/page.tsx
│   │   ├── orders/page.tsx, orders/[id]/page.tsx
│   │   ├── qualifications/page.tsx
│   │   ├── rtos/page.tsx
│   │   ├── agents/page.tsx
│   │   ├── pricing/page.tsx
│   │   ├── documents/page.tsx
│   │   ├── workflow/page.tsx
│   │   ├── finance/page.tsx
│   │   ├── reports/page.tsx
│   │   ├── audit/page.tsx
│   │   ├── settings/page.tsx
│   │   ├── users/page.tsx
│   │   ├── roles/page.tsx
│   │   ├── reconciliation/page.tsx
│   │   ├── integrations/quickbooks/page.tsx
│   │   ├── excel/{upload,imports,templates}/page.tsx
│   │   ├── additional-fees/page.tsx
│   │   ├── commission-{payouts,records,rules}/page.tsx
│   │   ├── price-{categories,lists}/page.tsx
│   │   ├── qualification-rto-mappings/page.tsx
│   │   └── rto-processing/page.tsx
│   ├── api/                      # ~85 API route handlers
│   │   ├── auth/{login,logout,logout-all,me,permissions,refresh}/route.ts
│   │   ├── clients/{,[id]}/route.ts
│   │   ├── orders/{,[id],[id]/status,[id]/certificate,[id]/checklist,[id]/documents,[id]/payment-plan,[id]/dimensions,[id]/timeline}/route.ts
│   │   ├── documents/{upload,[id],[id]/review,[id]/access-log,[id]/download}/route.ts
│   │   ├── invoices/{,[id],[id]/void}/route.ts
│   │   ├── payments/{,[id],[id]/refund,[id]/reverse-allocation}/route.ts
│   │   ├── masters/{type},{type}/[id],additional-fees,commission-rules,price-categories,price-lists,qualification-rto-mappings,supplier-routes}/route.ts
│   │   ├── commission-payouts/{,[id]}/route.ts
│   │   ├── commission-records/{,[id],[id]/approve,[id]/reject}/route.ts
│   │   ├── finance/summary/route.ts
│   │   ├── audit/route.ts, audit/filters/route.ts
│   │   ├── health/route.ts, health/ready/route.ts
│   │   ├── integrations/quickbooks/{connect,callback,disconnect,status,sync,sync/[type]/[id],webhook}/route.ts
│   │   ├── payment-plans/{,[id],[id]/instalments}/route.ts
│   │   ├── reconciliation/{,[id],[id]/resolve}/route.ts
│   │   ├── rto-processing/{,[id]}/route.ts
│   │   ├── reports/{type},{type}/export,ageing,agent-commission,certificate-completion-time,clients,collections,document-completion,finance,funnel,margin,monthly-summary,orders,outstanding,revenue,revenue-by-month,revenue-by-supplier,rto-turnaround,supplier-costs}/route.ts
│   │   ├── excel/{upload,import,imports,imports/[id],templates,templates/[id]}/route.ts
│   │   ├── roles/{,[id]}/route.ts
│   │   ├── users/{,[id],[id]/reset-password,[id]/unlock,directory}/route.ts
│   │   └── workflow/tasks/route.ts
│   ├── layout.tsx
│   ├── page.tsx                  # Redirects to /dashboard
│   ├── not-found.tsx
│   ├── providers.tsx
│   └── globals.css
├── components/
│   ├── ui/{badge,button,card,separator,skeleton}.tsx
│   ├── layout/{app-shell,header,sidebar}.tsx, nav.ts
│   ├── dashboard/{dashboard-page,dashboard,kpi-card}.tsx
│   ├── data-table.tsx, dialog.tsx, error-boundary.tsx, global-search.tsx
│   ├── require-auth.tsx, saved-views.tsx, status-badge.tsx, theme-toggle.tsx
├── views/                        # 36 view screens
│   ├── dashboard.tsx, dashboard-agent.tsx, dashboard-finance.tsx
│   ├── dashboard-operations.tsx, dashboard-rto.tsx
│   ├── clients.tsx, clients/[id]/page.tsx (app route)
│   ├── orders.tsx, order-detail.tsx
│   ├── documents.tsx, finance.tsx, reports.tsx
│   ├── agents.tsx, rtos.tsx, qualifications.tsx
│   ├── pricing.tsx, price-categories.tsx, price-lists.tsx
│   ├── commission-records.tsx, commission-payouts.tsx, commission-rules.tsx
│   ├── reconciliation.tsx, rto-processing.tsx
│   ├── quickbooks.tsx, excel-imports.tsx, excel-templates.tsx, excel-upload.tsx
│   ├── audit.tsx, users.tsx, roles.tsx, settings.tsx, tasks.tsx
│   ├── additional-fees.tsx, qualification-rto-mappings.tsx
│   ├── client-profile.tsx, login.tsx, placeholder.tsx
├── lib/
│   ├── types.ts                  # 829 lines — core entity types
│   ├── db.ts                     # MongoDB connection, collection access
│   ├── mongodb.ts                # Dev-safe connection caching
│   ├── api-auth.ts               # JWT signing/verify, argon2, refresh token
│   ├── api.ts                    # HTTP client with auto-refresh
│   ├── auth.tsx                  # Client AuthProvider (React context)
│   ├── permissions.ts            # RBAC matrix (display only, server is source of truth)
│   ├── pricing-validation.ts     # Price/commission validation helpers
│   ├── audit.ts                  # Append-only audit + document access log
│   ├── fin-store.ts              # Finance data-access layer (API-backed)
│   ├── ops-store.ts              # Operations data-access layer (API-backed)
│   ├── store.ts                  # Masters data-access layer (API-backed)
│   ├── quickbooks.ts             # QuickBooks integration
│   ├── queues.ts                 # Job queues / report aggregations
│   ├── rate-limit.ts             # Rate limiting
│   ├── utils.ts, theme.tsx
└── middleware/
    └── auth.ts                   # withAuth, requirePermission, verifyToken
```

## 3. Authentication & Authorization

**Auth flow:**
1. `POST /api/auth/login` — validates credentials (argon2id), rate-limited (5/15min), lockout after 10 failures (15 min), returns access token + sets httpOnly refresh cookie
2. `GET /api/auth/me` — returns user from JWT access token
3. `POST /api/auth/refresh` — rotates refresh token, returns new access token
4. `POST /api/auth/logout` / `logout-all` — clears session
5. Auto-refresh on 401 with single-flight promise (prevents refresh token replay)

**Server-side authorization:**
- `withAuth(permission, handler)` wraps every mutating/protected route handler
- `verifyToken` populates `req.auth` from JWT
- `requirePermission(permission)` checks `req.auth.permissions.includes(permission)` or `roleNames.includes("Super Admin")`
- Super Admin bypasses all permission checks
- Frontend uses local `permissions.ts` copy only for UI hiding — never grants access

**RBAC matrix (`permissions.ts`):**
- Super Admin: all permissions (except commissions.manage/view which are defined but unassigned)
- Finance: finance, qb, reports, clients.view, orders.view, documents.view
- Operations: clients/orders manage, documents review, reports
- Sales/Closing Agent: clients.view, orders.view, finance.view, reports.view
- RTO/Sourcing Manager: rto, agents, qualifications, pricing manage, orders.view, reports.view
- Document Reviewer: clients.view, orders.view, documents.view/review
- Read Only/Manager: clients.view, orders.view, finance.view, reports.view, documents.view

## 4. Database Architecture

**MongoDB via native driver (no Mongoose):**
- `src/lib/db.ts` — cached `MongoClient`, `getDb()`, `collection(name)`, `ObjectId` helpers
- `src/lib/mongodb.ts` — dev-safe global caching to prevent multiple connections during hot reload
- Database name: `skills_connect_admin` (from `MONGODB_DB` env)
- Collections accessed by string name: `collection("clients")`, `collection("orders")`, etc.
- No schema enforcement at application level (MongoDB is schema-less)
- No unique indexes defined in code
- No transactions except in payments route (MongoDB session with `withTransaction`)

**Collections (27+):**
| Collection | Purpose |
|---|---|
| users | User accounts with roleNames, passwordHash, failedLoginCount, lockedUntil |
| roles | Role definitions with permissions |
| clients | Client/student records |
| orders | Certificate/enrolment orders with snapshots |
| qualifications | Qualification definitions |
| rtos | Accredited training organisations |
| agents | Sales/source/RTO contacts with type and commissionRule |
| supplier_routes | Qualification→agent→RTO wholesale pricing matrix |
| documents | Document metadata + file bytes (BSON Binary) |
| document_access_logs | Who accessed which document |
| workflow_tasks | Per-order task tracking |
| invoices | Invoice records linked to orders |
| payment_plans | Instalment schedules (unlimited) |
| payments | Payment records with allocation |
| certificates | Certificate status per order |
| communications | Client communication log |
| audit_logs | Append-only audit trail |
| price_categories | Price category definitions |
| price_lists | Qualification-specific pricing with effective dates |
| additional_fees | Per-qualification or per-category fees |
| commission_rules | Agent commission tier rules |
| commission_records | Calculated commission per agent per period |
| commission_payouts | Commission payout records |
| qb_connections | QuickBooks OAuth connections (encrypted tokens) |
| qb_reconciliation_records | QB sync reconciliation items |
| currency_rates | FX rates for multi-currency |
| excel_imports | Excel import job tracking |
| excel_import_rows | Per-row import results |
| saved_views | User-saved filter presets |
| refresh_tokens | Refresh token hashes (revocable) |

## 5. Key Data Models (from types.ts)

**Order** — core business entity with server-side snapshots:
- `sellingPrice`, `supplierCostSnapshot`, `otherCost`, `currency` — snapshotted at creation
- `priceCategoryId`, `priceListId`, `supplierRouteId` — snapshotted references
- `exchangeRate`, `convertedAmount` — FX snapshot
- `additionalFees[]`, `feeTotal` — fee snapshot
- `paymentStatus` — calculated server-side from invoices + payments
- `history: StatusChange[]` — status transition audit

**Client** — one record per human, many orders:
- `legalName`, `preferredName`, `email` (dedupe key), `contacts[]`, `addresses[]`
- `sourceAgentId`, `status`, `notes`, `createdAt`
- **Missing:** USI number, visa status, referral tracking, enrollment code, BDC/B2B channel

**SupplierRoute** — wholesale pricing:
- `qualificationId`, `sourceAgentId`, `rtoId`, `wholesaleCost`, `currency`
- `effectiveFrom`, `effectiveTo`, `status` (active/expired)
- History preserved: expiring sets status + effectiveTo, never deletes

**PriceList** — client selling price:
- `qualificationId`, `priceCategoryId`, `amount`, `currency`
- `effectiveFrom`, `effectiveTo`, `status` (active/inactive/draft)
- Overlap validation in `pricing-validation.ts`

**CommissionRule** — agent commission:
- `agentId`, `responsibility`, `tiers[]` (minDeals, maxDeals, commissionPerDeal)
- `eligibleOrderStatuses[]`, `commissionCurrency`, `additionalIncentiveAmount`
- `status` (active/inactive), `approvalStatus` (draft/approved/rejected)

## 6. API Design

**REST conventions:**
- `GET/POST /api/{resource}` — list/create
- `GET/PUT/DELETE /api/{resource}/[id]` — read/update/delete
- `PATCH /api/orders/[id]/status` — status transition
- `POST /api/orders/[id]/payment-plan` — create payment plan
- `POST /api/documents/upload` — multipart file upload
- `POST /api/documents/[id]/review` — approve/reject document
- `POST /api/payments` — record payment with transaction
- `GET /api/reports/{type}` — server-side aggregations
- `GET /api/reports/{type}/export` — Excel/PDF export

**Response format:** `{ error: { code, message, requestId?, details? } }` for errors; `{ data }` or `{ resource: [...] }` for success.

## 7. Frontend Architecture

**Data access layers (all API-backed, no local state):**
- `ops-store.ts` — clients, orders, documents, tasks, RTO processing, Excel
- `fin-store.ts` — invoices, payment plans, payments, finance summary, QB sync, audit
- `store.ts` — roles, users, qualifications, RTOs, agents, mappings, pricing, commission

**State management:** React `useState`/`useEffect` with `useMemo` for derived data. No Redux/Zustand.

**Optimistic updates:** Some pages update local state immediately after API call (e.g., orders page adds created order to local list).

**Error handling:** Try/catch with error state displayed as `text-destructive` text. Loading skeletons on initial load.

**Pagination:** NOT implemented — DataTable receives all rows and filters client-side.

**Search/filter:** Client-side filtering on `visible` array (orders, clients, documents, commission records).

## 8. Background Jobs / Queue Infrastructure

**`src/lib/queues.ts`** — referenced by reports page for `revenueByMonth()`, `revenueBySupplier()`, `documentCompletion()`, `certificateCompletionTime()`. These are server-side report aggregations, not a background job queue.

**No BullMQ, no Redis, no cron jobs, no scheduled tasks.** QuickBooks sync is "enqueued" via `enqueueSync()` but the actual queue processor is not in this Next.js codebase (it's in the Express reference implementation).

## 9. Testing

**Tests (9 files in /tests):**
- `phase-0.test.ts` through `phase-5.test.ts`
- `debug-test.mjs`, `helpers.ts`, `setup.ts`
- 195/195 Express regression tests pass (reference implementation, not Next.js)
- No dedicated Next.js API route tests
- No frontend component tests
- vitest configured in `vitest.config.ts`

## 10. Deployment

- `npm run dev` — Next.js dev server
- `npm run build` — production build (59 routes compiled)
- `npm run start` — production server
- Deploy target: Render (single Next.js service)
- Requires: MongoDB Atlas, Redis (optional, for BullMQ), QuickBooks sandbox credentials

## 11. Known Issues / Gaps in Architecture

1. **No data-scoping in RBAC** — All users with `orders.view` see ALL orders, not just their own
2. **No BDC/B2B Agent roles** — Roles don't match boss's requirements
3. **No server-side profit calculation** — Gross margin calculated client-side in `ops-store.ts`
4. **No pagination** — All records fetched, filtered client-side
5. **No background job queue** — QuickBooks sync "enqueued" but no processor in Next.js
6. **No unique indexes** — MongoDB collections lack application-defined unique indexes
7. **No transactions except payments** — Only payment allocation uses MongoDB sessions
8. **No field-level encryption** — QB tokens encrypted at rest, but other sensitive fields not encrypted
9. **No USI/visa/enrollment-code fields on Client** — Missing RPL-specific student fields
10. **No mandatory checklist enforcement** — Documents can be reviewed but no gate blocking RTO submission

---

## VERIFICATION SECTION

### Exact Reference Document Paths
1. `docs/reference/RPL Management System - Database Structure & ER Diagrams.docx` — located at `docs/reference/`
2. `docs/reference/rpl_management_system_database_architecture_design.md` — located at `docs/reference/`

### Confirmation of Complete Reading
Both reference documents were opened and read completely:
- MD document: 510 lines (ER diagram of 10 tables, table specifications, DDL script)
- DOCX document: 706 lines (business flow, ER diagram, visibility matrix, detailed specs, DDL)

### Requirements Extracted from Each Document
**From MD document (§1–§6):** 4 roles, user fields, 10-table schema, pricing matrix (5 price columns), enrollment lifecycle (8 statuses), payment statuses (4), commission types (2), document verification (UPLOADED/APPROVED/REJECTED), workflow gate, column-level masking, PostgreSQL DDL.

**From DOCX document (§1–§5):** End-to-end data flow, 100-Point ID verification, mandatory checklist enforcement, Role-Based Visibility Matrix, visa_status on students, delivery_mode/requires_trade_media on qualifications, submission_email on partners, id_points_value on checklist templates, mime_type/PDF validation on documents, pgcrypto/gen_random_uuid DDL.

### Differences from Previous Audit
- No changes to architecture findings; all gaps verified against actual source files (`src/lib/types.ts`, `src/lib/permissions.ts`, `src/app/api/orders/route.ts`, `src/lib/ops-store.ts`)
- Document paths corrected from "project root" to `docs/reference/`

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