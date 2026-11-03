# Skills Connect Admin — Project Overview & Requirements Audit

**Project:** Skills Connect Admin  
**Repo:** D:\Office Work\Skills-Connect-Admin  
**Audit basis:** READ-ONLY inspection of actual repository source code, API routes, database models (MongoDB native driver), frontend pages, lib/data-access layers, configuration, and documentation files.  
**Date:** 2026-11-03  
**Constraint honored:** No source files were modified, created, deleted, or refactored. No features implemented.

---

## 1. Project Architecture

### 1.1 Current frontend and backend architecture

The project is a **single Next.js 16 application** (App Router) that serves both the React frontend dashboard and all REST API route handlers under `src/app/api/`. There is no separate Express server at runtime. Per `NEXTJS_MIGRATION_STATUS.md` (line 9-13) and `architecture.md` (line 62), all ~85 Express endpoints have been migrated to Next.js Route Handlers. The `server/` Express reference implementation described in `BACKEND-PLAN.md` is preserved as documentation/reference only and is NOT deployed.

| Layer | Technology | Evidence |
|-------|-----------|----------|
| Frontend | Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS v4 | `package.json` (Next 16.4.3, React 19.2.8, TS 6.0.2), `next.config.ts` |
| Backend | Next.js Route Handlers (REST API) | `src/app/api/*` — 18 route groups, ~85 endpoints |
| Database | MongoDB Atlas, native `mongodb` driver v6 | `src/lib/db.ts`, `src/lib/mongodb.ts`, `.env` MONGODB_URI |
| Auth | JWT access (15 min) + httpOnly rotating refresh token (7 days), argon2id password hashing | `src/lib/api-auth.ts`, `src/app/api/auth/*` |
| File storage | BSON Binary directly in MongoDB (no S3/object storage) | `src/app/api/documents/upload/route.ts` stores `data: Buffer.from(bytes)` |
| Jobs | BullMQ + Redis (Express reference), inline fallback in Next.js | `render.yaml` worker service, `BACKEND-PLAN.md` B5 |
| External | QuickBooks OAuth2 + v3 (unverified against real Intuit API) | `src/lib/quickbooks.ts`, `src/app/api/integrations/quickbooks/*` |
| Deploy | Render blueprint (`render.yaml`), Vercel alternative (`vercel.json`) | `render.yaml`, `vercel.json`, `DEPLOYMENT.md` |

### 1.2 Folder and module structure

```
src/
├── app/
│   ├── (app)/          # App shell + route groups (agents, audit, clients, dashboard,
│   │                   # documents, finance, layout, orders, pricing, qualifications,
│   │                   # reports, roles, rtos, settings, users, workflow)
│   ├── api/            # ~85 Next.js Route Handlers (auth, clients, orders, invoices,
│   │                   # payments, payment-plans, masters, workflow, documents,
│   │                   # finance, audit, roles, users, integrations/quickbooks,
│   │                   # reports, saved-views, communications, health)
│   ├── login/          # Login page
│   ├── layout.tsx      # Root layout
│   ├── login/page.tsx  # Login screen
│   ├── page.tsx        # Landing page
│   ├── not-found.tsx
│   └── providers.tsx
├── components/
│   ├── dashboard/      # dashboard-page.tsx, dashboard.tsx, kpi-card.tsx
│   ├── layout/         # app-shell.tsx, header.tsx, nav.ts, sidebar.tsx
│   ├── ui/             # badge.tsx, button.tsx, card.tsx, separator.tsx, skeleton.tsx
│   ├── data-table.tsx, dialog.tsx, error-boundary.tsx, global-search.tsx,
│   ├── require-auth.tsx, saved-views.tsx, status-badge.tsx, theme-toggle.tsx
├── lib/
│   ├── api.ts          # HTTP client, auto-refresh, uploadFile
│   ├── api-auth.ts     # JWT sign/verify, argon2id, refresh token hashing
│   ├── auth.tsx        # Client AuthProvider (useAuth)
│   ├── db.ts           # MongoDB getDb/collection/toObjectId (cached client)
│   ├── fin-store.ts    # Finance data access (invoices, payments, QB sync, audit)
│   ├── mongodb.ts      # MongoDB connectDb (dev global cache)
│   ├── ops-store.ts    # Ops data access (clients, orders, documents, tasks)
│   ├── permissions.ts  # RBAC matrix (display-only copy)
│   ├── quickbooks.ts   # QB facade (status, token store, sync records, retry)
│   ├── rate-limit.ts   # In-memory fixed-window rate limiter
│   ├── store.ts        # Masters data access (roles, users, quals, RTOs, agents, routes)
│   ├── theme.tsx
│   ├── types.ts        # Core entity types (User, Order, Client, Invoice, etc.)
│   ├── utils.ts
│   └── queues.ts       # Saved views, communications, reports
├── middleware.ts       # Next.js page middleware (refresh_token cookie check)
└── middleware/auth.ts  # withAuth / requirePermission for API routes
```

### 1.3 Authentication and authorization system

- **Auth library:** `src/lib/api-auth.ts` — HS256 JWT signed with Node `crypto` (no `jsonwebtoken` dependency). Access token TTL 15 min (`ACCESS_TOKEN_TTL_MIN`), refresh token TTL 7 days (`REFRESH_TOKEN_TTL_DAYS`).
- **Passwords:** argon2id via `argon2` package (`hashPassword`, `verifyPassword`).
- **Refresh tokens:** SHA-256 hashed, stored in `refresh_tokens` collection with `revoked` flag, TTL expiry, rotation with reuse detection (replay revokes the whole family).
- **Login flow:** `POST /api/auth/login` → rate limit (5/15min per IP+email) → verify argon2id → lockout at 10 failures (15 min) → issue access JWT + refresh cookie → store refresh token hash in DB.
- **Refresh flow:** `POST /api/auth/refresh` → look up refresh token hash → if revoked, revoke entire family → rotate token → issue new cookie + access token.
- **Logout:** `POST /api/auth/logout` revokes the token family and clears the cookie. `POST /api/auth/logout-all` (auth required) revokes all non-revoked tokens for the user.
- **Session restore:** `GET /auth/me` verifies access token; client `api.ts` auto-refreshes on 401 (single-flight refresh to prevent replay).
- **Page middleware:** `src/middleware.ts` checks for `refresh_token` httpOnly cookie; redirects to `/login` if absent. API routes self-authenticate and are skipped.
- **RBAC:** `withAuth(permission, handler)` in `src/middleware/auth.ts` verifies token then checks permission. Super Admin bypasses permission checks. Frontend copy in `src/lib/permissions.ts` is display-only (nav/button hiding); server is source of truth. `GET /auth/permissions` serves the matrix.
- **Roles (7):** Super Admin, Finance, Operations, Sales / Closing Agent, RTO / Sourcing Manager, Document Reviewer, Read Only / Manager.
- **Permissions (18):** users.manage, roles.manage, clients.view, clients.manage, orders.view, orders.manage, rto.manage, agents.manage, qualifications.manage, pricing.manage, documents.view, documents.review, finance.view, finance.manage, qb.retry, reports.view, audit.view, settings.manage.

### 1.4 API architecture and request handling

- All API routes are Next.js Route Handlers under `src/app/api/`.
- Auth wrapper: `withAuth` from `src/middleware/auth.ts` (verifyToken + optional requirePermission).
- Database access: `src/lib/db.ts` `getDb()` caches a single `MongoClient`; `collection(name)` returns a native driver collection. No ODM/Mongoose in the Next.js layer.
- Request body parsing: `req.json()` for JSON, `req.formData()` for multipart document uploads.
- Response envelope: `{ error: { code, message, requestId?, details? } }` for errors; success bodies vary by route (e.g. `{ clients: [...] }`, `{ order: {...} }`, `{ invoice: {...} }`).
- Rate limiting: in-memory fixed-window on login only (`src/lib/rate-limit.ts`), keyed by IP+email. Not Redis-backed in the Next.js layer (the Express reference has Redis).
- File upload: `POST /api/documents/upload` multipart/form-data; file bytes stored as BSON Binary in MongoDB `documents` collection (max 20MB PDF, 10MB images, 5MB text).
- CORS/Helmet: not present in the Next.js layer (handled at the Express reference / deployment layer). `poweredByHeader: false` in `next.config.ts`.

### 1.5 Environment configuration

`.env` (root, git-ignored but present in repo):
- `NEXT_PUBLIC_API_BASE_URL=/api` (relative routes; empty = same origin)
- `NEXT_PUBLIC_APP_NAME=Skills Connect Admin`
- `MONGODB_URI="mongodb+srv://amirhamzarony588_db_user:WhYrRjQwHHjhXC49@cluster0.vrojeh8.mongodb.net/"` — **contains a real credential committed to the repo** (security risk)
- `MONGODB_DB=skills_connect_admin`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — real values committed to repo (security risk)
- `ACCESS_TOKEN_TTL_MIN=15`, `REFRESH_TOKEN_TTL_DAYS=7`
- `COOKIE_SECURE=false`, `COOKIE_SAME_SITE=lax`
- `LOGIN_RATE_LIMIT_MAX=5`, `LOGIN_RATE_LIMIT_WINDOW_MIN=15`, `ACCOUNT_LOCK_MAX_FAILURES=10`, `ACCOUNT_LOCK_MINUTES=15`
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`

QuickBooks env vars (not present in `.env`, must be added): `QB_REALM_ID`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET`, `QB_SANDBOX`, `QB_REDIRECT_URI`, `QB_AUTH_URL`, `QB_INCOME_ACCOUNT_ID`.

`.env.example` provides placeholders without secrets.

### 1.6 Current deployment architecture

- **Primary:** Render blueprint (`render.yaml`) — one Next.js web service (frontend + API on port 3000) + separate background worker (BullMQ queue + hourly overdue sweep) + Render Redis starter database. `autoDeploy: false`.
- **Alternative:** Vercel (`vercel.json`, `buildCommand: npm run build`). Vercel serverless cannot run long-lived workers; BullMQ worker + overdue sweep must run on a separate service.
- Health endpoints: `GET /api/health` (liveness), `GET /api/health/ready` (MongoDB ping, returns 503 if disconnected).
- No Dockerfile found in the repo root (referenced in `DEPLOYMENT.md`/`BACKEND-PLAN.md` as `server/Dockerfile` but `server/` does not exist in this repo — the code has fully migrated to Next.js).

---

## 2. MongoDB Database Architecture

### 2.1 Database name and connection configuration

- **Database:** `skills_connect_admin` (`MONGODB_DB` env, default fallback in `db.ts`).
- **Cluster:** `cluster0.vrojeh8.mongodb.net` (MongoDB Atlas), user `amirhamzarony588_db_user`.
- **Connection:** `src/lib/db.ts` `getDb()` — single cached `MongoClient`, `db = client.db(process.env.MONGODB_DB ?? "skills_connect_admin")`. `src/lib/mongodb.ts` `connectDb()` — dev uses `globalThis` cache to prevent multiple connections on hot reload.
- **Driver:** `mongodb` v6.8.0 (native driver, no Mongoose in the Next.js layer).

### 2.2 Existing collections and their purposes

| Collection | Purpose | Evidence (route/file) |
|------------|---------|----------------------|
| `users` | Staff accounts (email, name, phone, passwordHash, roleNames, active, failedLoginCount, lockedUntil, lastLoginAt, tokenVersion) | `api/users/route.ts`, `api/auth/login/route.ts` |
| `roles` | Role definitions (name, permissions[]) | `api/roles/route.ts` |
| `refresh_tokens` | Refresh token hashes (userId, tokenHash, createdAt, expiresAt, revoked) — infra | `api/auth/login/route.ts`, `api/auth/refresh/route.ts` |
| `clients` | Client records (legalName, preferredName, email, phone, contacts, addresses, status, sourceAgentId, notes, createdAt, updatedAt) — **no unique index on email** | `api/clients/route.ts`, `api/clients/[id]/route.ts` |
| `orders` | Certificate/enrolment orders (clientId, qualificationId, salesAgentId, sourceAgentId, rtoId, status, evidenceStatus, rtoSubmissionStatus, certificateStatus, sellingPrice, supplierCostSnapshot, otherCost, currency, paymentStatus, history[], createdAt, updatedAt, completedAt) | `api/orders/route.ts`, `api/orders/[id]/route.ts` |
| `workflow_tasks` | Tasks (orderId, stage, title, assigneeId, dueDate, status, priority, createdAt, updatedAt) | `api/workflow/tasks/route.ts` |
| `documents` | Document metadata + file bytes (orderId, clientId, type, version, fileName, contentType, sizeBytes, data: Buffer, status, receivedAt, reviewedAt, reviewedBy, rejectionReason, createdAt) | `api/documents/upload/route.ts`, `api/documents/[id]/download/route.ts`, `api/documents/[id]/review/route.ts` |
| `document_access_logs` | Access log (documentId, actorId, action, ip, requestId, createdAt) — infra | `api/documents/[id]/access-log/route.ts` |
| `document_requirements` | Per-order document checklist (orderId, type, status, createdAt) — inserted on order create | `api/orders/route.ts` POST |
| `certificates` | Certificate records (orderId, status, createdAt) — inserted on order create | `api/orders/route.ts` POST |
| `invoices` | Invoices (orderId, invoiceNumber: INV-{timestamp}, total, dueDate, status, createdAt) | `api/invoices/route.ts` |
| `payment-plans` | Instalment plans (orderId, total, instalments[], createdAt, updatedAt) | `api/payment-plans/route.ts` |
| `payments` | Payments (orderId, invoiceId, amount, date, method, reference, allocatedAmount, status, createdAt) | `api/payments/route.ts` |
| `audit_logs` | Append-only audit (entityType, entityId, action, before, after, actorId, actorEmail, createdAt) | `api/audit/route.ts` |
| `qb_connections` | QB OAuth token store (realmId, accessToken, refreshToken, expiresAt, createdAt, updatedAt) — infra, single company | `src/lib/quickbooks.ts` |
| `qb_sync_records` | QB sync queue (entityType, entityId, idempotencyKey, status, attempts, lastSyncAt, syncError, qbReference, createdAt) | `src/lib/quickbooks.ts`, `api/integrations/quickbooks/sync/route.ts` |
| `communications` | Client communications log (clientId, orderId, channel, direction, message, status, sentAt, externalReference, createdAt, updatedAt) | `api/communications/route.ts` |
| `saved_views` | Saved operational view filters (userId, name, scope, filters, isDefault, createdAt, updatedAt) | `api/saved-views/route.ts` |

**Total: 20 collections** (17 business + 3 infrastructure: `refresh_tokens`, `qb_connections`, `document_access_logs`; plus `qb_sync_records` which is business-facing sync state).

### 2.3 Existing schemas, fields, relationships and indexes

**Observed schemas (from route handler code and `src/lib/types.ts`):**

- **users:** `_id`, `email` (lowercased, dedupe checked in app, no unique index), `name`, `phone`, `passwordHash`, `roleNames[]`, `active`, `failedLoginCount`, `lockedUntil`, `lastLoginAt`, `tokenVersion`, `createdAt`, `updatedAt`.
- **roles:** `_id`, `name`, `permissions[]`, `createdAt`.
- **refresh_tokens:** `userId` (ObjectId), `tokenHash` (SHA-256 hex), `createdAt`, `expiresAt`, `revoked`.
- **clients:** `_id`, `legalName`, `preferredName`, `email` (lowercased), `phone`, `contacts[]` (label, type, value, primary), `addresses[]` (label, street, city, state, postalCode, country, primary), `status`, `sourceAgentId` (ObjectId\|null), `notes`, `createdAt`, `updatedAt`.
- **orders:** `_id`, `clientId` (ObjectId), `qualificationId` (ObjectId), `salesAgentId` (ObjectId), `sourceAgentId` (ObjectId), `rtoId` (ObjectId), `status` (OrderStatus enum), `evidenceStatus`, `rtoSubmissionStatus`, `certificateStatus`, `sellingPrice` (number), `supplierCostSnapshot` (number, immutable snapshot), `otherCost` (number), `currency` ("AUD"), `paymentStatus` (calculated), `history[]` (timestamp, actorId, field, before, after), `createdAt`, `updatedAt`, `completedAt`.
- **workflow_tasks:** `_id`, `orderId` (ObjectId), `stage`, `title`, `assigneeId` (ObjectId\|null), `dueDate`, `status` (Todo\|In Progress\|Done\|Blocked), `priority` (Low\|Medium\|High), `createdAt`, `updatedAt`.
- **documents:** `_id`, `orderId` (ObjectId), `clientId` (ObjectId), `type`, `version` (int), `fileName`, `contentType`, `sizeBytes`, `data` (Buffer — never returned in JSON), `status` (DocumentStatus), `receivedAt`, `reviewedAt`, `reviewedBy`, `rejectionReason`, `createdAt`. Version-supersede: new version marks prior `Superseded`.
- **document_requirements:** `orderId` (ObjectId), `type`, `status`, `createdAt`.
- **certificates:** `orderId` (ObjectId), `status`, `createdAt`.
- **invoices:** `_id`, `orderId` (ObjectId), `invoiceNumber` (`INV-${Date.now()}`), `total`, `dueDate`, `status` (InvoiceStatus), `createdAt`.
- **payment-plans:** `_id`, `orderId` (ObjectId), `total`, `instalments[]` (dueDate, amount, paidAmount, status), `createdAt`, `updatedAt`.
- **payments:** `_id`, `orderId` (ObjectId), `invoiceId` (ObjectId\|null), `amount`, `date`, `method`, `reference`, `allocatedAmount`, `status`, `createdAt`.
- **audit_logs:** `_id`, `actorId`, `actorEmail`, `entityType`, `entityId`, `action`, `before`, `after`, `createdAt`.
- **qb_connections:** `_id` (single doc via `{}` upsert), `realmId`, `accessToken`, `refreshToken`, `expiresAt`, `createdAt`, `updatedAt`.
- **qb_sync_records:** `_id`, `entityType` ("invoice"\|"payment"), `entityId` (ObjectId), `idempotencyKey`, `status` (Not Synced\|Pending\|Synced\|Failed), `attempts`, `lastSyncAt`, `syncError`, `qbReference`, `createdAt`.
- **communications:** `_id`, `clientId` (ObjectId), `orderId` (ObjectId\|null), `channel`, `direction`, `message`, `status`, `sentAt`, `externalReference`, `createdAt`, `updatedAt`.
- **saved_views:** `_id`, `userId` (ObjectId), `name`, `scope` (orders\|documents\|finance\|clients), `filters` (Record), `isDefault`, `createdAt`, `updatedAt`.

**Relationships:**
- clients 1:N orders (clientId)
- orders 1:1 qualification (qualificationId)
- orders 1:N documents (orderId)
- orders 1:N workflow_tasks (orderId)
- orders 1:N payment-plans (orderId) — effectively one current plan
- orders 1:N invoices (orderId)
- orders 1:N payments (orderId)
- payments N:1 invoices (invoiceId, nullable)
- qualifications N:M RTOs via supplier_routes (qualificationId, sourceAgentId, rtoId)
- agents typed: sales_closing / certificate_source / rto_contact

**Indexes:** No explicit index creation code found in the Next.js route handlers. The `BACKEND-PLAN.md` references Mongoose indexes (unique on document version per (order,type,version), TTL on refresh_tokens) but those belong to the Express reference layer, not the deployed Next.js layer. No unique index on `clients.email` (deliberate, per `BACKEND-PLAN.md` B3 note — would break the duplicate-client report).

### 2.4 Data validation and business rules

- **Login:** email+password required; rate limited 5/15min per IP+email; account lockout at 10 failures for 15 min; inactive accounts 403; locked accounts 423.
- **Client create:** email dedupe checked in application (409 if exists); legalName+email required.
- **Order create:** all reference IDs must exist (client checked); sellingPrice required; supplierCostSnapshot set to 0 server-side (NOT read from active supplier route in the Next.js route — see gap below); document_requirements + certificates inserted on create; status defaults to "New".
- **Invoice create:** orderId+total+dueDate required; invoiceNumber auto-generated `INV-${Date.now()}`; status defaults "Draft".
- **Payment create:** orderId+amount+date+method required; allocatedAmount defaults to amount; status "Allocated".
- **Document upload:** contentType allowlist (pdf, jpeg, png, webp, csv, txt); size limits (20MB pdf, 10MB image, 5MB text); version auto-incremented; prior non-superseded versions marked Superseded.
- **Document review:** status must be "Approved" or "Rejected"; requires `documents.review` permission.
- **Invoice void:** status → "Void"; requires `finance.manage`.
- **Payment refund:** status → "Refunded"; requires `finance.manage`.
- **Financial:** `grossMargin = sellingPrice - supplierCostSnapshot - otherCost` (client-side helper in `ops-store.ts`); payment status on Order is typed but the route does not calculate it (typed `paymentStatus` field exists in `types.ts` Order but is not populated by the GET route).

### 2.5 Existing data migration strategy

No migration scripts exist in the Next.js layer. `BACKEND-PLAN.md` §3 (B6) and `HANDOVER.md` describe planned Excel import + reconciliation (workbook vs DB vs QB) as future work (`server/src/scripts/excel-import`, `reconcile`). The `RTO & Onboarding Master Hub.xlsx` workbook is an external blocker, not present in the repo. No seed script exists in the Next.js layer (`npm run server:seed` referenced in HANDOVER.md belongs to the Express reference).

### 2.6 New collections that can be added without breaking existing functionality

New collections can be added safely since the data-access layer uses `collection(name)` dynamically with no schema enforcement. Safe additions:
- Any new business collection (e.g. `price_lists`, `price_categories`, `agent_commissions`, `excel_imports`, `excel_import_rows`, `excel_uploads`) — no existing code references them, so no breakage.
- New indexes on existing collections (read-only additions) — safe.
- Adding fields to existing documents — safe (schemaless), but must not break existing read projections that expect specific shapes.

Collections that should NOT be renamed/removed: all 20 listed above are actively read/written by route handlers.

---

## 3. Existing Feature Implementation

### 3.1 Authentication and Users

**What is implemented:**
- Full auth: login, refresh, logout, logout-all, me, permissions (`src/app/api/auth/*`).
- JWT access (15 min) + httpOnly rotating refresh (7 days), argon2id, reuse detection, family revocation.
- Rate limiting (5/15min per IP+email), account lockout (10 failures/15min).
- User CRUD: `GET/POST /api/users`, `GET/PATCH /api/users/[id]`, `GET /api/users/directory` (name-only, no permission gate).
- Role CRUD: `GET/POST /api/roles`, RBAC matrix endpoint `GET /auth/permissions`.
- Frontend: `src/views/login.tsx`, `src/views/users.tsx`, `src/views/roles.tsx`, `src/lib/auth.tsx` (AuthProvider), `src/lib/api.ts` (auto-refresh client).

**Partially implemented:**
- `/users/[id]/reset-password` and `/users/[id]/unlock` exist in Express reference but NOT migrated to Next.js (no route files under `api/users/[id]/` for reset-password/unlock). `NEXTJS_MIGRATION_STATUS.md` lists them as ✅ migrated but there are no actual route files for them.
- No `DELETE /users/:id` (deactivation used instead).

**Existing frontend pages:** `/login`, `/users`, `/roles`.

**Existing API endpoints:**
- POST /api/auth/login, POST /api/auth/refresh, POST /api/auth/logout, POST /api/auth/logout-all, GET /api/auth/me, GET /api/auth/permissions
- GET/POST /api/users, GET/PATCH /api/users/[id], GET /api/users/directory
- GET/POST /api/roles

**Database collections:** `users`, `roles`, `refresh_tokens`.

**Missing functionality:** Password reset, account unlock endpoints, email verification, MFA, OAuth social login, invite flow.

### 3.2 Roles and Permissions

**What is implemented:**
- 7 roles × 18 permissions matrix in `src/lib/permissions.ts` (display-only) and served by `GET /auth/permissions`.
- Server-side enforcement via `withAuth(permission, handler)` on all API routes.
- Super Admin bypass.
- Role CRUD via `GET/POST /api/roles`.

**Partially implemented:** Role update (`PATCH /api/roles/:id`) — listed in migration status but only `GET/POST` route files exist under `api/roles/`. No `[id]` subdirectory.

**Existing frontend pages:** `/roles`.

**Existing API endpoints:** GET/POST /api/roles, GET /api/auth/permissions.

**Database collections:** `roles`, `users` (roleNames field).

**Missing functionality:** Role edit/update, permission granularity beyond the 18 listed, dynamic permission assignment UI beyond name+array.

### 3.3 Clients

**What is implemented:**
- Client list with search (`GET /api/clients`), single client (`GET /api/clients/[id]`), create (`POST /api/clients`), update (`PATCH /api/clients/[id]`).
- Email dedupe (application-level, 409).
- Duplicate-client report: `GET /api/clients/duplicates` (certain by email, possible by phone digit matching).
- Client contacts (multiple, typed phone/email/whatsapp, primary flag) and addresses (multiple, typed, primary flag) per `types.ts`, but the route handlers only store a flat `phone` string — the `contacts`/`addresses` arrays are initialized empty on create and never populated by the API. The `Client` type includes them but the route does not accept/return them.
- Frontend: `src/views/clients.tsx`, `src/views/client-profile.tsx`.

**Partially implemented:** `contacts` and `addresses` arrays exist in the type and are initialized empty on create, but no API accepts them. `client-profile.tsx` exists as a view file but its API integration is not visible in the route handlers (no dedicated client profile endpoint beyond `GET /clients/[id]`).

**Existing frontend pages:** `/clients`, `/clients/[id]` (client-profile).

**Existing API endpoints:** GET/POST /api/clients, GET/PATCH /api/clients/[id], GET /api/clients/duplicates.

**Database collections:** `clients`.

**Missing functionality:** Contacts/addresses CRUD, client merge (dedupe is report-only), client status lifecycle management, client QuickBooks customer mapping (`Client.qbCustomerId` mentioned in architecture but not in the route handler).

### 3.4 Orders

**What is implemented:**
- Order list with filters (status, clientId) (`GET /api/orders`), single order detail (`GET /api/orders/[id]`), create (`POST /api/orders`).
- Status transition (`PATCH /api/orders/[id]/status`) — route exists in migration status but NO route file under `api/orders/[id]/` for status or dimensions (only a basic GET exists).
- Dimensions update (`PATCH /api/orders/[id]/dimensions`) — same, referenced in migration status and `fin-store.ts`/`ops-store.ts` call it, but no route file exists.
- Order create snapshots `supplierCostSnapshot: 0` (hardcoded zero — NOT read from active supplier route, contrary to the design intent in `ops-store.ts` comments).
- On create: inserts `document_requirements` (6 default types) and `certificates` (status "Not Issued").
- Gross margin calculated client-side (`ops-store.ts` `grossMargin`).
- `paymentStatus` typed in `types.ts` but not computed/populated by the GET route.

**Partially implemented:** Status transitions, dimensions updates, certificate status setting — referenced in types/store but route files missing under `api/orders/[id]/`.

**Existing frontend pages:** `/orders`, `/orders/[id]` (order-detail).

**Existing API endpoints:** GET/POST /api/orders, GET /api/orders/[id].

**Database collections:** `orders`, `document_requirements`, `certificates`, `clients`, `qualifications`, `agents`, `rtos`, `supplier_routes` (referenced but not used for snapshot).

**Missing functionality:** Status transition endpoint, dimensions endpoint, order edit, order cancellation/refund workflow, order timeline endpoint (`GET /orders/:id/timeline` referenced but no route file), order checklist endpoint (`GET /orders/:id/checklist` referenced but no route file), order certificate endpoint (`GET /orders/:id/certificate` referenced but no route file), supplier cost snapshot from active route (currently hardcoded 0).

### 3.5 Tasks and Workflow

**What is implemented:**
- Task list filterable by orderId, assigneeId, status (`GET /api/workflow/tasks`).
- Create task (`POST /api/workflow/tasks`).
- Update task (`PATCH /api/workflow/tasks/[id]`) — status, assigneeId, dueDate, priority.
- Valid statuses: Todo, In Progress, Done, Blocked. Valid priorities: Low, Medium, High.

**Partially implemented:** Task deletion, task reordering, automatic task creation on order status transition (the Express reference does this transactionally; the Next.js route does not auto-create tasks on order create).

**Existing frontend pages:** `/workflow`.

**Existing API endpoints:** GET/POST /api/workflow/tasks, PATCH /api/workflow/tasks/[id] (the route file is `api/workflow/tasks/route.ts` handling both; `[id]` not a separate file but PATCH is in the same route.ts — actually looking at the code, `api/workflow/tasks/route.ts` handles GET, PATCH (with id from... wait, PATCH needs an id). Let me re-check: the PATCH handler in `api/workflow/tasks/route.ts` extracts `id` from `params` but there's no `[id]` subdirectory. This is a bug — Next.js dynamic routes require `[id]/route.ts`. The PATCH handler would never receive params.id. This is a defect.)

Actually, re-reading `api/workflow/tasks/route.ts`: the PATCH handler uses `{ params }` but the file is at `api/workflow/tasks/route.ts` (not `[id]/route.ts`). In Next.js, `params` would be empty for a non-dynamic route. So `PATCH /api/workflow/tasks` without an id would fail to find a task. This is a real defect.

**Database collections:** `workflow_tasks`, `orders`.

**Missing functionality:** Task delete, auto task generation on status change, task comments, task dependencies.

### 3.6 Masters (Agents, Qualifications, RTOs, Supplier Pricing)

**What is implemented:**
- Generic `GET/POST /api/masters/[type]` for qualifications, rtos, agents, supplier-routes.
- `PATCH /api/masters/[type]/[id]` for all four types.
- `POST /api/masters/supplier-routes/[id]/expire` (soft expire).
- Permission map: qualifications→qualifications.manage, rtos→rto.manage, agents→agents.manage, supplier-routes→pricing.manage.
- Agent types: sales_closing, certificate_source, rto_contact.
- Qualification status: current/superseded, licensingRefs embedded.
- RTO status: active/suspended/at-risk/inactive, cricosCode.
- Supplier route: qualificationId, sourceAgentId, rtoId, wholesaleCost, currency AUD, effectiveFrom, effectiveTo, status active/expired.
- History-preserving pricing: expire (never delete), old orders keep snapshots.

**Partially implemented:** Agent update only allows contact/commissionRule/active (per `store.ts` `updateAgent`), but the generic PATCH allows any field. Qualification update lacks licensingRefs management.

**Existing frontend pages:** `/agents`, `/qualifications`, `/rtos`, `/pricing`.

**Existing API endpoints:** GET/POST/PATCH /api/masters/[type], GET/PATCH /api/masters/[type]/[id], POST /api/masters/supplier-routes/[id]/expire.

**Database collections:** `agents`, `qualifications`, `rtos`, `supplier_routes`.

**Missing functionality:** Supplier route edit (only expire, no direct edit), qualification licensing refs CRUD, agent commission rule editing UI, RTO contact management, qualification→document_requirements template linkage.

### 3.7 Documents and Storage

**What is implemented:**
- Document upload (`POST /api/documents/upload`) multipart, file bytes as BSON Binary in MongoDB.
- Content type + size allowlist enforcement.
- Versioning: new version supersedes prior (status "Superseded").
- Download (`GET /api/documents/[id]/download`) streams bytes.
- Review (`PATCH /api/documents/[id]/review`) Approve/Reject with reason.
- Access log (`GET /api/documents/[id]/access-log`) reads `document_access_logs` collection — but the upload route does NOT write access-log entries (the code inserts into `documents` only; no `document_access_logs` write observed).
- Document list per order (`GET /api/orders/[id]/documents`) — referenced in migration status and views but no dedicated route file under `api/orders/[id]/documents/`. The `ops-store.ts` `listDocuments` calls `/orders/${orderId}/documents`.

**Partially implemented:** Access-log writes (collection exists, read route exists, but upload route doesn't write to it). Order-scoped document list endpoint referenced but no route file.

**Existing frontend pages:** `/documents`.

**Existing API endpoints:** POST /api/documents/upload, GET/PATCH /api/documents/[id] (download, review, access-log subroutes).

**Database collections:** `documents`, `document_access_logs`, `document_requirements`.

**Missing functionality:** Document delete, document metadata edit, bulk upload, document templates per qualification, file virus scanning, document access-log writes on upload/download/review.

### 3.8 Finance and Payments

**What is implemented:**
- Invoices: list (`GET /api/invoices`), create (`POST /api/invoices`, auto `INV-{timestamp}` number, status Draft), void (`POST /api/invoices/[id]/void`).
- Payment plans: list (`GET /api/payment-plans`), create (`POST /api/orders/[id]/payment-plan` — referenced but no route file), add instalment (`POST /api/payment-plans/[id]/instalments` — referenced but no route file).
- Payments: list (`GET /api/payments`), record (`POST /api/payments`), refund (`POST /api/payments/[id]/refund` — referenced but route dir exists? `payments/[id]` dir has `refund/` subdir).
- Finance summary (`GET /api/finance/summary`): invoiced, collected, outstanding.
- Allocation: server sets allocatedAmount = amount (not oldest-due-first as claimed in docs).
- Payment status on Order is typed but not computed.
- Frontend: `src/views/finance.tsx` (Invoices/Plans/Payments/QuickBooks tabs).

**Partially implemented:** Payment plan CRUD and instalment endpoints referenced in types/store/migration but route files missing under `api/payment-plans/[id]/instalments/` and `api/orders/[id]/payment-plan/` (the `[id]` directories exist but route.ts files were not found — "File not found" when reading). The `payments/[id]` directory exists with `refund/` subdir but the refund route file was not read.

**Existing frontend pages:** `/finance`.

**Existing API endpoints:** GET/POST /api/invoices, POST /api/invoices/[id]/void, GET /api/payment-plans, GET /api/payments, POST /api/payments, GET /api/finance/summary.

**Database collections:** `invoices`, `payment-plans`, `payments`, `orders`.

**Missing functionality:** Oldest-due-first allocation (server-authoritative allocation claimed but not implemented — allocatedAmount just equals amount), overdue calculation (invoice status is stored, not derived), payment plan/instalment endpoints, invoice PDF generation, payment reconciliation, credit notes.

### 3.9 Reports and Analytics

**What is implemented:**
- `GET /api/reports/finance` (orders, clients, invoiced, collected, outstanding, overdueAmount, overdueCount, pipelineValue, with date filter).
- `GET /api/reports/revenue` (by qualification, by sales agent).
- `GET /api/reports/margin` (by qualification with %).
- `GET /api/reports/funnel` (orders by stage, conversion %).
- `GET /api/reports/ageing` (overdue buckets 1-30/31-60/61-90/90+).
- `GET /api/reports/collections` (invoiced vs collected by month).
- `GET /api/reports/revenue-by-month`, `GET /api/reports/revenue-by-supplier`, `GET /api/reports/document-completion`, `GET /api/reports/certificate-completion-time`, `GET /api/reports/rto-turnaround`.
- All require `reports.view` permission.
- Frontend: `src/views/reports.tsx`.

**Partially implemented:** All report endpoints are GET-only aggregation endpoints; no export (CSV/Excel), no scheduled reports, no chart rendering (charts are data-only).

**Existing frontend pages:** `/reports`.

**Existing API endpoints:** All `GET /api/reports/*` listed above.

**Database collections:** `orders`, `invoices`, `payments`, `qualifications`, `users` (agents), `rtos`, `documents`, `certificates`.

**Missing functionality:** CSV/Excel export, scheduled/emailed reports, drill-down from report to records, custom report builder.

### 3.10 Audit Logs

**What is implemented:**
- `GET /api/audit` — paged, filterable by entityType and action, returns events with actorId, actorEmail, entityType, entityId, action, before, after, timestamp.
- Requires `audit.view` permission (granted to Super Admin, Finance, Operations, Read Only / Manager).
- Frontend: `src/views/audit.tsx`.

**Partially implemented:** Audit writes — the architecture claims audit middleware writes on every mutation, but the Next.js route handlers do NOT call any audit logging on create/update/delete operations. The `audit_logs` collection exists and is readable, but no write path was observed in any route handler. No `POST /api/audit` endpoint. No audit on denied permissions.

**Existing frontend pages:** `/audit`.

**Existing API endpoints:** GET /api/audit.

**Database collections:** `audit_logs`.

**Missing functionality:** Audit writes on mutations (the collection is read-only in practice), audit on permission denials, audit export, audit search by date range/actor.

### 3.11 QuickBooks Integration

**What is implemented:**
- OAuth2 connect URL (`GET /api/integrations/quickbooks/connect`, requires `settings.manage`).
- OAuth callback (`GET /api/integrations/quickbooks/callback`, state bound to userId, requires `settings.manage`).
- Status (`GET /api/integrations/quickbooks/status`, requires `finance.view`).
- Sync records list (`GET /api/integrations/quickbooks/sync`, requires `finance.view`).
- Sync record by entity (`GET/POST /api/integrations/quickbooks/sync/[type]/[id]` — wait, the route is `api/integrations/quickbooks/sync/route.ts` which only handles GET. There's no `[type]/[id]` directory under sync. But `fin-store.ts` `retryQBSync` calls `POST /integrations/quickbooks/sync/${entityType}/${entityId}`. No route file exists for that path.)
- Webhook (`POST /api/integrations/quickbooks/webhook`, HMAC signature verification, always 200).
- `qb_connections` collection stores realmId/accessToken/refreshToken/expiresAt.
- `qb_sync_records` collection tracks entityType, entityId, idempotencyKey, status, attempts, lastSyncAt, syncError, qbReference.
- `src/lib/quickbooks.ts` facade: `isQuickBooksConfigured()`, `authorizationUrl()`, `quickBooksStatus()`, `exchangeCodeForTokens()`, `listSyncRecords()`, `syncRecordFor()`, `retrySync()`.

**Partially implemented / NOT working against real QuickBooks:**
- `exchangeCodeForTokens()` does NOT call Intuit's OAuth token endpoint. It stores fake values: `accessToken: stored:${code}`, `refreshToken: "stored"`, `expiresAt: +1hr`. **No real token exchange occurs.**
- `retrySync()` explicitly returns `result = { ok: false, error: "QuickBooks transport not implemented in Next.js." }` even when configured. **No real QB API calls are made.**
- `quickBooksStatus()` returns `realmId` from `process.env.QB_REALM_ID` (not from the stored connection doc's realmId consistently) and `authorised` based on whether any doc exists in `qb_connections`.
- No invoice creation in QuickBooks, no customer sync, no payment sync, no duplicate-invoice prevention at the QB level (only idempotencyKey in Mongo).
- No `QB_REALM_ID`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET` in `.env` (not configured).
- FULL_RUNTIME_AUDIT.md line 126: "QuickBooks sync — Routes exist but require QB webhook credentials and OAuth authorization to function. Degrades gracefully."
- HANDOVER.md: "QuickBooks has never touched Intuit's real API... Confirming that Intuit behaves as documented needs sandbox credentials."

**Existing frontend pages:** None dedicated (QuickBooks tab is inside `/finance`).

**Existing API endpoints:** GET/POST /api/integrations/quickbooks/connect, GET /api/integrations/quickbooks/callback, GET /api/integrations/quickbooks/status, GET /api/integrations/quickbooks/sync, POST /api/integrations/quickbooks/webhook.

**Database collections:** `qb_connections`, `qb_sync_records`.

**Missing functionality (extensive):** Real OAuth token exchange, real QB invoice creation, real QB customer sync, real QB payment sync, webhook event processing (currently just matches qbReference and updates lastSyncAt, doesn't create/update local records), invoice status sync from QB, duplicate prevention at QB level, QB error handling with retry/backoff, QB disconnect, multi-company support.

**Reusable components:** `qb_sync_records` collection schema, `idempotencyKey` pattern, `qb_connections` token store, webhook HMAC verification, `retryQBSync` API shape, `QBSyncStatus` enum, `qbStatusFor` helper in `fin-store.ts`.

### Summary table of existing feature implementation status

| Module | Implemented | Partially | Missing | Frontend pages | API endpoints | Collections |
|--------|------------|-----------|---------|----------------|---------------|-------------|
| Auth & Users | ✅ Login/refresh/logout/me/permissions, user CRUD, rate limit, lockout | Password reset/unlock endpoints | MFA, email verify, social OAuth, invite | /login, /users, /roles | ~12 auth + user/role endpoints | users, roles, refresh_tokens |
| Roles & Permissions | ✅ Matrix, enforcement, role CRUD | Role update endpoint | Dynamic permission UI | /roles | GET/POST /api/roles, GET /auth/permissions | roles |
| Clients | ✅ CRUD, search, duplicates report | contacts/addresses arrays (typed but unused) | Client merge, contacts/addresses CRUD, qbCustomerId | /clients, /clients/[id] | GET/POST /api/clients, GET/PATCH /api/clients/[id], GET /api/clients/duplicates | clients |
| Orders | ✅ List, detail, create, doc_requirements+certificates on create | Status transition, dimensions (referenced, no route files) | Order edit, timeline, checklist, certificate endpoints, supplier cost snapshot (hardcoded 0) | /orders, /orders/[id] | GET/POST /api/orders, GET /api/orders/[id] | orders, document_requirements, certificates |
| Tasks & Workflow | ✅ List, create, update (PATCH in wrong route file) | Auto task on status change, delete | Task comments, dependencies | /workflow | GET/POST /api/workflow/tasks, PATCH (defective) | workflow_tasks, orders |
| Masters | ✅ CRUD for agents/quals/rtos/supplier-routes, expire | Agent update limited fields | Supplier route edit, qual licensing CRUD, RTO contacts | /agents, /qualifications, /rtos, /pricing | GET/POST/PATCH /api/masters/[type], POST /expire | agents, qualifications, rtos, supplier_routes |
| Documents | ✅ Upload (BSON Binary), download, review, versioning, access-log read | Access-log writes not implemented | Document delete, bulk upload, templates | /documents | POST /api/documents/upload, GET/PATCH /api/documents/[id]/* | documents, document_access_logs, document_requirements |
| Finance & Payments | ✅ Invoices, void, payments, refund, finance summary | Payment plans/instalments endpoints missing | Oldest-due-first allocation, overdue derivation, invoice PDF, reconciliation | /finance | GET/POST /api/invoices, POST /void, GET/POST /api/payments, POST /refund, GET /api/finance/summary | invoices, payment-plans, payments |
| Reports | ✅ 11 report endpoints, all GET | No export, no scheduled reports | CSV export, custom reports | /reports | GET /api/reports/* (11 endpoints) | orders, invoices, payments, qualifications, users, rtos, documents, certificates |
| Audit Logs | ✅ Read, paged, filterable | No write path | Audit writes on mutations, export | /audit | GET /api/audit | audit_logs |
| QuickBooks | ✅ OAuth connect/callback URLs, status, sync records, webhook HMAC | No real QB API calls | Real token exchange, invoice/customer/payment sync, duplicate prevention | (tab in /finance) | GET/POST connect, GET callback, GET status, GET sync, POST webhook | qb_connections, qb_sync_records |

---

## 4. QuickBooks Integration Audit

### 4.1 All existing QuickBooks-related code

- `src/lib/quickbooks.ts` — QB facade (231 lines): `QBStatus`, `QBSyncRecordDTO`, `QBTransportResult` interfaces; `isQuickBooksConfigured()`, `authorizationUrl(state)`, `quickBooksStatus()`, `exchangeCodeForTokens(code, realmId)`, `listSyncRecords()`, `syncRecordFor(entityType, entityId)`, `retrySync(entityType, entityId, actor)`.
- `src/app/api/integrations/quickbooks/connect/route.ts` — GET, returns authorization URL, requires `settings.manage`.
- `src/app/api/integrations/quickbooks/callback/route.ts` — GET, exchanges code via `exchangeCodeForTokens`, state validation, requires `settings.manage`.
- `src/app/api/integrations/quickbooks/status/route.ts` — GET, returns QB status, requires `finance.view`.
- `src/app/api/integrations/quickbooks/sync/route.ts` — GET, lists sync records, requires `finance.view`.
- `src/app/api/integrations/quickbooks/webhook/route.ts` — POST, HMAC-SHA256 signature verification over raw body, matches `qbReference` in `qb_sync_records`, always returns 200.
- `src/lib/fin-store.ts` — `listQBSync()`, `qbStatusFor()`, `retryQBSync()` calling `/integrations/quickbooks/sync/*`.
- `src/views/finance.tsx` — QuickBooks tab showing sync records with retry button (gated on `qb.retry`).

### 4.2 OAuth 2.0 implementation status

- **Authorization URL:** Implemented — builds Intuit OAuth consent URL with `client_id`, `response_type=code`, `scope=com.intuit.quickbooks.accounting`, `redirect_uri` (default `http://localhost:4000/integrations/quickbooks/callback`), `state` (userId).
- **Callback:** Implemented route handler — validates `code`, `realmId`, `state` (matches userId), calls `exchangeCodeForTokens`.
- **Token exchange:** **NOT implemented against real Intuit.** `exchangeCodeForTokens()` in `src/lib/quickbooks.ts` (lines 84-112) does NOT call `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`. It writes placeholder values to `qb_connections`: `accessToken: "stored:${code}"`, `refreshToken: "stored"`, `expiresAt: now+1hr`. **No real tokens are obtained.**
- **Token refresh:** Not implemented. No refresh token rotation endpoint for QB tokens.
- **Token storage:** `qb_connections` collection with `realmId`, `accessToken`, `refreshToken`, `expiresAt`, `createdAt`, `updatedAt`. Single-document upsert (`{}` filter). `select:false` equivalent not applicable (native driver, no field projection).

### 4.3 Access token and refresh token management

- **Access tokens:** Stored as `"stored:${code}"` placeholder — not real Intuit access tokens. No refresh mechanism.
- **Refresh tokens:** Stored as `"stored"` placeholder. No refresh flow.
- **Expiry:** `expiresAt` set to `Date.now() + 3600 * 1000` (1 hour) regardless of actual Intuit response.
- **Security:** Tokens stored in plaintext in MongoDB (no field-level encryption). `qb_connections` is a single document for one company.

### 4.4 Existing invoice and customer integrations

- **Invoice creation in QB:** None. `retrySync()` explicitly returns `{ ok: false, error: "QuickBooks transport not implemented in Next.js." }` (line 200 of `quickbooks.ts`). No function creates a QB invoice.
- **Customer sync:** None. No `qbCustomerId` on clients (mentioned in architecture.md but not in route handlers). No customer create/lookup in QB.
- **Payment sync:** None.
- **Invoice status sync from QB:** None. Webhook only matches `qbReference` and updates `lastSyncAt`; does not update local invoice status.
- **qbReference:** Stored on sync records but never populated by a real QB response (since no real calls are made).

### 4.5 Existing API endpoints and synchronization logic

| Endpoint | Method | Status | Real QB call? |
|----------|--------|--------|---------------|
| /integrations/quickbooks/connect | GET | ✅ Route works | No (builds URL only) |
| /integrations/quickbooks/callback | GET | ✅ Route works | No (stores placeholders) |
| /integrations/quickbooks/status | GET | ✅ Route works | No (reads env + collection) |
| /integrations/quickbooks/sync | GET | ✅ Route works | No (reads qb_sync_records) |
| /integrations/quickbooks/sync/[type]/[id] | GET/POST | ❌ No route file | N/A |
| /integrations/quickbooks/webhook | POST | ✅ Route works | No (read-only matching) |

**Synchronization logic:** The sync pattern is defined (`qb_sync_records` with `idempotencyKey`, `status`, `attempts`, `lastSyncAt`, `syncError`, `qbReference`) but the transport layer that actually calls QuickBooks is missing. `retrySync` is a no-op that always fails with "QuickBooks transport not implemented in Next.js."

### 4.6 What can be reused and what is missing

**Reusable:**
- `qb_sync_records` collection schema (entityType, entityId, idempotencyKey, status, attempts, lastSyncAt, syncError, qbReference) — ideal foundation for idempotent sync.
- `qb_connections` collection for token storage (needs encryption at rest).
- Webhook HMAC verification implementation (constant-time compare, raw body handling).
- `idempotencyKey` pattern (prevents duplicate invoices on retry).
- `QBSyncStatus` enum (Not Synced, Pending, Synced, Failed).
- `qbStatusFor()` helper in `fin-store.ts`.
- Route handler shapes and permission gates (`settings.manage`, `finance.view`, `qb.retry`).

**Missing:**
- Real OAuth2 token exchange client (Intuit `/oauth2/v1/tokens/bearer`).
- Token refresh flow.
- QuickBooks v3 client (invoice create, customer create/query, payment create/query).
- Idempotency key generation and propagation to QB (QB supports `Idempotency-Key` header).
- Invoice → QB sync on invoice create.
- Customer → QB sync on client create.
- Payment → QB sync on payment record.
- QB webhook event processing (invoice.payment, invoice.sent, etc.) to update local status.
- Duplicate-invoice detection at QB level (beyond Mongo idempotency key).
- QB disconnect / token revocation.
- Error classification (retryable vs permanent).
- `QB_REALM_ID`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET` env vars (not configured).
- Sandbox credentials (external blocker, confirmed by HANDOVER.md and BACKEND-PLAN.md).

**Conclusion:** The QuickBooks integration is **skeleton code only**. Routes exist and degrade gracefully, but no request has ever reached Intuit's API. It cannot be assumed working.

---

## 5. Existing Pricing System

### 5.1 Current qualification pricing, supplier pricing, order pricing snapshots

**Supplier pricing (wholesale cost):**
- Collection: `supplier_routes`.
- Schema: `qualificationId`, `sourceAgentId`, `rtoId`, `wholesaleCost` (number), `currency` ("AUD"), `effectiveFrom`, `effectiveTo` (null=present), `status` ("active"\|"expired"), `createdAt`, `updatedAt`.
- API: `GET/POST /api/masters/supplier-routes`, `POST /api/masters/supplier-routes/[id]/expire`.
- UI: `src/views/pricing.tsx` — Supplier Pricing page. Create route form (qualification, source agent, RTO, cost, effective date). Expire route (soft delete, preserves history).
- Design intent (per `ops-store.ts` comments): order snapshots wholesale cost from the active route at creation; repricing never rewrites history.

**Order pricing snapshot:**
- `orders.supplierCostSnapshot` — **hardcoded to 0** on order create in `api/orders/route.ts` (line 64: `supplierCostSnapshot: 0`). The comment in `ops-store.ts` says "The wholesale cost snapshot is taken server-side from the active supplier route" but this is NOT implemented — the route does not look up the active supplier route.
- `orders.sellingPrice` — client-provided, stored as-is.
- `orders.otherCost` — client-provided, defaults 0.
- `orders.currency` — "AUD".
- `grossMargin` — client-side helper in `ops-store.ts`: `sellingPrice - supplierCostSnapshot - otherCost`. Since snapshot is 0, margin = sellingPrice - otherCost.

**Qualification pricing:**
- `qualifications` collection has no price field. Pricing lives entirely in `supplier_routes` (qualification → agent → RTO → wholesale cost).
- No "standard price" or "list price" concept for qualifications.
- No "selling price" default or recommended price.

### 5.2 Existing commission and incentive functionality

- `agents.commissionRule` — a **string field** on agents (e.g. a rule description), not a structured commission calculation. No commission calculation engine, no commission rates, no incentive rules, no commission payouts, no commission reports.
- No agent earnings tracking, no commission invoices, no incentive tiers.

### 5.3 How a centralized pricing management module can fit

A centralized pricing management module (Skills Connect Price List) can fit into the current architecture as follows:

1. **New collection(s):** `price_lists` (or `qualification_prices`) with fields: qualificationId, category, standardPrice, specialPrice, effectiveFrom, effectiveTo, currency, active. Plus `price_categories` and `agent_commission_rules` collections. These can be added without breaking anything (schemaless, no existing references).

2. **New API routes:** `GET/POST /api/pricing/price-lists`, `GET/POST/PATCH /api/pricing/price-lists/[id]`, `GET/POST /api/pricing/categories`, `GET/POST /api/pricing/commission-rules`. Permission: `pricing.manage` (already exists in the permission matrix and is assigned to Super Admin + RTO / Sourcing Manager).

3. **Integration with Orders:** On order create, resolve the applicable price from the price list (qualification + category + effective date) and set `sellingPrice` default (client can override). Continue snapshotting `supplierCostSnapshot` from `supplier_routes` (needs to be fixed — currently hardcoded 0).

4. **Integration with Finance:** Commission calculation uses `agent_commission_rules` + order `sellingPrice` + `supplierCostSnapshot` to compute commission amount per agent. Feeds into finance/payments.

5. **Integration with existing masters:** Reuse `qualifications`, `agents`, `rtos` collections via references. The `supplier_routes` collection already provides wholesale cost; the price list adds retail/selling price and commission rules.

6. **Frontend:** Extend `/pricing` page or add a new `/price-list` page. Reuse `DataTable`, `Dialog`, `status-badge` components. Permission gate: `pricing.manage`.

7. **Backward compatibility:** Existing orders keep their `sellingPrice` and `supplierCostSnapshot` snapshots unchanged. New price list does not retroactively alter historical orders.

---

## 6. New Company Requirements — Implementation-Readiness Analysis

### A. Excel-Based Business Management

**Readiness: PARTIAL.** The infrastructure for Excel-based records exists in fragments but no Excel import/export module exists.

| Requirement | Current state | Gap |
|-------------|--------------|-----|
| Client and enrolment records | `clients` collection + CRUD API exists | No Excel import/export for clients |
| Agent and onboarding info | `agents` collection + CRUD exists | No Excel import/export for agents |
| Installments and payment tracking | `payment-plans`, `payments`, `instalments[]` exist | No Excel import/export; no overdue auto-calculation |
| Financial summaries and outstanding dues | `finance/summary`, reports exist | No Excel export |
| RTO partner directory and processing | `rtos` collection + CRUD exists | No Excel import/export |
| Document tracking and file status | `documents` collection + versioning + review exists | No Excel export of document status |
| Other spreadsheet records | `saved_views` (filters) exists | No general Excel import framework |

**What can be reused:** `clients`, `orders`, `agents`, `rtos`, `payment-plans`, `payments`, `documents` collections; `finance/summary` and report aggregation patterns; `saved_views` for filter persistence.

**What is missing:** Excel file parsing library (e.g., `xlsx`), import job/queue, row-level validation, import audit, reconciliation report (workbook vs DB vs QB), import templates, dry-run mode.

### B. QuickBooks

**Readiness: PARTIAL (skeleton only).**

| Requirement | Current state | Gap |
|-------------|--------------|-----|
| Create invoices directly from Skills Connect | `POST /api/invoices` creates local invoices (Draft) | No QB invoice creation on invoice create |
| Synchronize customers and invoices | `qb_connections`, `qb_sync_records` skeletons exist | No customer sync, no invoice push to QB |
| Manage invoice status and payments | Local invoice status management exists | No QB status pullback, no payment sync |
| Maintain sync records and error handling | `qb_sync_records` schema exists (status, attempts, error) | No real sync attempts, no error classification, no retry backoff |
| Avoid duplicate invoices | `idempotencyKey` in `qb_sync_records` (Mongo-level only) | No QB-level idempotency header, no duplicate detection |

**Reusable:** `qb_sync_records` collection, `idempotencyKey` pattern, webhook HMAC verification, `qb_connections` token store, `qb.retry` permission, retry UI in `/finance`.

**Missing (extensive):** Real OAuth token exchange, QB v3 client, invoice/customer/payment sync, webhook event processing, env vars (`QB_REALM_ID`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET`), sandbox credentials (external blocker).

### C. Skills Connect Price List

**Readiness: PARTIAL.** Supplier pricing (wholesale cost) exists; selling price list does not.

| Requirement | Current state | Gap |
|-------------|--------------|-----|
| Qualification and course pricing | `supplier_routes` (wholesale cost only) | No selling price / list price per qualification |
| Pricing categories and applicable fees | None | `price_categories` collection needed |
| Standard prices and special pricing | None | `price_lists` collection needed |
| Agent commission and incentive rules | `agents.commissionRule` (string, unstructured) | Structured commission rules engine needed |
| Integration with Orders and Finance | Orders have sellingPrice + supplierCostSnapshot (snapshot hardcoded 0) | Price list not connected to order creation; commission not calculated |

**Reusable:** `supplier_routes` collection pattern, `pricing.manage` permission, `/pricing` page pattern, `agents` collection.

**Missing:** `price_lists`, `price_categories`, `agent_commission_rules` collections; pricing API routes; order-create price resolution; commission calculation; commission reports.

---

## 7. Gap Analysis

| # | Existing functionality | New requirement | Current implementation status | Required changes | Dependencies |
|---|----------------------|-----------------|------------------------------|------------------|--------------|
| 1 | Client CRUD API (`/api/clients`) | Excel-based client/enrolment records | Complete for UI/API; no Excel import/export | Add Excel parsing (xlsx), import job, validation, import audit | None (new) |
| 2 | Orders API (`/api/orders`) | Installments and payment tracking | Payment plans/instalments types exist; endpoints missing | Add `POST /api/orders/[id]/payment-plan`, `POST /api/payment-plans/[id]/instalments`; oldest-due-first allocation | None |
| 3 | Finance summary (`/api/finance/summary`) | Financial summaries and outstanding dues | Complete (invoiced/collected/outstanding) | Excel export of summary | None |
| 4 | RTOs CRUD (`/api/masters/rtos`) | RTO partner directory | Complete for UI/API; no Excel import/export | Add Excel import/export | None |
| 5 | Documents API (`/api/documents/upload`) | Document tracking and file status | Complete (versioning, review, status) | Excel export of document status | None |
| 6 | QuickBooks skeleton (`/api/integrations/quickbooks/*`) | Create invoices directly from Skills Connect | Routes exist; no real QB API calls | Implement OAuth token exchange, QB v3 client, invoice create on invoice create, customer sync | QB sandbox credentials, env vars |
| 7 | QuickBooks skeleton | Synchronize customers and invoices | `qb_sync_records` schema exists; no sync logic | Implement customer→QB sync, invoice→QB sync, payment→QB sync, webhook processing | QB credentials |
| 8 | QuickBooks skeleton | Manage invoice status and payments | Local status only | Webhook event processing to update local invoice/payment status from QB | QB credentials |
| 9 | QuickBooks skeleton (`qb_sync_records`) | Sync records and error handling | Schema exists; no real attempts | Implement retry with backoff, error classification, duplicate prevention | QB credentials |
| 10 | QuickBooks skeleton (`idempotencyKey`) | Avoid duplicate invoices | Mongo-level idempotency key only | Add QB Idempotency-Key header, QB-level duplicate detection | QB credentials |
| 11 | Supplier routes (`/api/masters/supplier-routes`) | Qualification and course pricing | Wholesale cost only; no selling price | Add `price_lists` collection (standard/special price), `price_categories` | None |
| 12 | Supplier routes | Pricing categories and fees | None | Add `price_categories` collection | None |
| 13 | `agents.commissionRule` (string) | Agent commission and incentive rules | Unstructured string only | Add `agent_commission_rules` collection, commission calculation engine | None |
| 14 | Orders (sellingPrice, supplierCostSnapshot=0) | Integration with Orders and Finance | Snapshot hardcoded 0 (bug); price list not connected | Fix snapshot lookup from active supplier route; resolve price list default on order create | Price list collection |
| 15 | RBAC matrix (18 permissions) | New module permissions | `pricing.manage` exists | Add `price_lists.manage`/`price_lists.view` if needed; extend matrix | None |

---

## 8. Recommended Database Design

### Recommendation: New collections in the existing database (`skills_connect_admin`)

**Do NOT create separate MongoDB databases.** All new Excel-based and price-list data are business entities related to existing collections (clients, orders, agents, qualifications, invoices). A single database preserves referential queries, transactions, and the existing connection pattern. Separate databases are only justified for isolated systems (e.g., a separate analytics warehouse), which is not required here.

### 8.1 Recommended new collections

| Collection | Purpose | Relationships | Indexes |
|------------|---------|---------------|---------|
| `price_lists` | Qualification/course pricing (standard + special) | qualificationId → qualifications | `{qualificationId: 1, effectiveFrom: -1}`, `{active: 1}` |
| `price_categories` | Pricing categories and applicable fees | standalone | `{name: 1}` (unique) |
| `agent_commission_rules` | Agent commission/incentive rules | agentId → agents | `{agentId: 1}` (unique), `{active: 1}` |
| `excel_imports` | Import job tracking (Excel uploads) | standalone | `{createdAt: -1}`, `{status: 1}` |
| `excel_import_rows` | Individual row results/errors | importId → excel_imports | `{importId: 1}`, `{status: 1}` |
| `excel_import_templates` | Reusable import templates | standalone | `{name: 1}` (unique) |

### 8.2 Recommended new indexes on existing collections

- `clients.email` — unique index is **NOT recommended** (would break the duplicate-client report per `BACKEND-PLAN.md` B3 note). Keep application-level dedupe.
- `orders.supplierCostSnapshot` — no index needed (queried by orderId).
- `qb_sync_records.idempotencyKey` — unique index (prevents duplicate sync jobs). Currently no unique index exists; add `{idempotencyKey: 1}` unique.
- `qb_sync_records.entityType+entityId` — index for `syncRecordFor` lookups. Add `{entityType: 1, entityId: 1}`.
- `refresh_tokens.userId` + `expiresAt` — TTL index for cleanup. Currently no TTL index; add `{expiresAt: 1}` expireAfterSeconds: 0.

### 8.3 Validation and data ownership

- **Validation:** Application-level validation in route handlers (as currently done). No schema enforcement at the DB level (native driver). Add Zod/Joi-style validation in route handlers for new collections.
- **Data ownership:** All new collections owned by the Skills Connect Admin app. No cross-database ownership.
- **Backward compatibility:** New collections do not reference existing documents with required foreign keys (use nullable references) so existing data is unaffected. Existing orders keep `supplierCostSnapshot` snapshots unchanged.

### 8.4 Collections that should NOT be modified

Do not alter `clients.email` uniqueness, `orders.supplierCostSnapshot` immutability, `documents.data` storage pattern, or `audit_logs` append-only nature. These are deliberate design decisions documented in `BACKEND-PLAN.md` and `architecture.md`.

---

## 9. Technical Risks

| Risk | Severity | Description | Evidence |
|------|----------|-------------|----------|
| Committed credentials | High | `.env` contains real `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_ADMIN_PASSWORD` | `.env` lines 9-11, 30 |
| Supplier cost snapshot hardcoded 0 | High | Order create sets `supplierCostSnapshot: 0` instead of reading active supplier route; margin calculations are wrong | `api/orders/route.ts` line 64 |
| Workflow task PATCH route defect | High | `PATCH /api/workflow/tasks/[id]` handler is in `api/workflow/tasks/route.ts` (non-dynamic route) so `params.id` is never populated | `api/workflow/tasks/route.ts` lines 49-88 |
| QuickBooks not functional | High | No real OAuth token exchange or QB API calls; placeholder tokens stored | `src/lib/quickbooks.ts` lines 99-101, 198-201 |
| No Next.js test suite | Medium | Only Express regression tests (195); Next.js routes verified manually | `NEXTJS_MIGRATION_STATUS.md` line 176, `FULL_RUNTIME_AUDIT.md` line 17 |
| No audit writes | Medium | `audit_logs` collection is readable but no route writes audit entries on mutations | No `recordAudit` calls in any route handler |
| Missing payment plan/instalment endpoints | Medium | `fin-store.ts` calls `/api/orders/[id]/payment-plan` and `/api/payment-plans/[id]/instalments` but no route files exist | `api/payment-plans/[id]/` has no `route.ts` |
| No unique index on qb_sync_records.idempotencyKey | Medium | Duplicate idempotency keys possible; duplicate-invoice protection relies only on application logic | `qb_sync_records` collection has no index creation |
| In-memory rate limiter (Next.js layer) | Low | Won't scale across multiple instances; Express reference uses Redis | `src/lib/rate-limit.ts` lines 10-11 |
| No document access-log writes | Low | Upload route doesn't write to `document_access_logs` | `api/documents/upload/route.ts` (no insert into document_access_logs) |
| No TTL index on refresh_tokens | Low | Expired refresh tokens accumulate | `refresh_tokens` collection has `expiresAt` but no TTL index |
| Historical financial data risk | High | Changing `supplierCostSnapshot` logic after orders exist creates divergence between old (0) and new (real) snapshots | Orders already created have snapshot=0 |
| Duplicate data risk | Medium | Excel import could duplicate clients (email not unique at DB level); no import dedupe | `clients.email` no unique index |
| Permission/security risk | Medium | `qb.retry` permission exists but QB sync doesn't work; `settings.manage` gates QB connect | `permissions.ts` |

---

## 10. Implementation Roadmap

### Phase 1: Foundation & Data Integrity (Weeks 1-2)
**Dependencies:** None (can start immediately)

**Backend:**
- Fix `supplierCostSnapshot` to read from active supplier route on order create (one-time backfill decision for existing orders).
- Add unique index on `qb_sync_records.idempotencyKey`.
- Add TTL index on `refresh_tokens.expiresAt`.
- Fix workflow task PATCH route (move to `api/workflow/tasks/[id]/route.ts`).
- Implement audit writes on mutations (recordAudit on create/update/delete).
- Implement oldest-due-first payment allocation.

**Frontend:** None (API-only changes).

**Database:** Index additions only (no new collections).

**Testing:** Unit tests for snapshot lookup, allocation, idempotency.

**Deployment:** No deploy changes.

### Phase 2: Excel-Based Business Management (Weeks 3-5)
**Dependencies:** Phase 1

**Backend:**
- Add `excel_imports`, `excel_import_rows`, `excel_import_templates` collections.
- Add Excel import API routes (`POST /api/excel/import`, `GET /api/excel/imports`, `GET /api/excel/imports/[id]/rows`).
- Add Excel export routes for clients, orders, agents, rtos, documents, finance summary.
- Add row-level validation and import audit.

**Frontend:**
- Add `/excel-import` page (upload, preview, map columns, confirm).
- Add `/excel-export` page (select entity, date range, download).
- Add import history and error review UI.

**Database:** New collections `excel_imports`, `excel_import_rows`, `excel_import_templates`.

**Testing:** Import validation tests, export reconciliation tests (workbook vs DB totals).

**Deployment:** Add `xlsx` dependency.

### Phase 3: Skills Connect Price List (Weeks 6-8)
**Dependencies:** Phase 1

**Backend:**
- Add `price_lists`, `price_categories`, `agent_commission_rules` collections.
- Add pricing API routes (`/api/pricing/*`).
- Fix order create to resolve default selling price from price list.
- Add commission calculation engine.
- Extend RBAC matrix if new permissions needed.

**Frontend:**
- Extend `/pricing` page or add `/price-list` page (price lists, categories, commission rules).
- Add commission report to `/reports`.

**Database:** New collections `price_lists`, `price_categories`, `agent_commission_rules`.

**Testing:** Commission calculation tests, price resolution tests, backward-compatibility tests (existing orders unchanged).

**Deployment:** No deploy changes.

### Phase 4: QuickBooks Integration (Weeks 9-12)
**Dependencies:** Phase 1; QB sandbox credentials (external blocker)

**Backend:**
- Implement real OAuth2 token exchange (Intuit `/oauth2/v1/tokens/bearer`).
- Implement QB token refresh.
- Implement QB v3 client (invoice create/query, customer create/query, payment create/query).
- Sync invoices on invoice create; sync customers on client create; sync payments on payment record.
- Process QB webhook events to update local invoice/payment status.
- Add QB Idempotency-Key header for duplicate prevention.
- Add retry with backoff and error classification.
- Configure `QB_REALM_ID`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET` env vars.

**Frontend:**
- Add QB connection status to `/settings`.
- Enhance QB tab in `/finance` with sync controls, error details, disconnect.

**Database:** No new collections (reuse `qb_connections`, `qb_sync_records`); add index on `idempotencyKey`.

**Testing:** Integration tests against QB sandbox (blocked until credentials available). Stub-based tests can proceed.

**Deployment:** Add QB env vars to Render/Vercel. Webhook endpoint must be publicly accessible.

### Phase 5: Reports, Audit & Migration (Weeks 13-16)
**Dependencies:** Phase 2, Phase 3

**Backend:**
- Add CSV/Excel export for all reports.
- Add reconciliation report (workbook vs DB vs QB totals).
- Add audit export.
- Add overdue auto-calculation (hourly sweep).

**Frontend:**
- Add export buttons to report pages.
- Add reconciliation dashboard.

**Database:** No new collections.

**Testing:** Reconciliation tests, UAT on migrated data.

**Deployment:** Staging deploy, UAT, production cutover.

---

## Summary

### Project architecture
Skills Connect Admin is a single Next.js 16 (App Router) + React 19 + TypeScript 6 application serving both frontend and ~85 REST API route handlers under `src/app/api/`. It uses MongoDB Atlas (`skills_connect_admin` database) via the native driver, with no ODM. Authentication uses JWT access (15 min) + httpOnly rotating refresh tokens (7 days) with argon2id password hashing and reuse detection. RBAC has 7 roles and 18 permissions, enforced server-side via `withAuth/requirePermission`. Document files are stored as BSON Binary directly in MongoDB. Deployment targets Render (web + worker + Redis) or Vercel.

### Existing implementation status
The application is **substantially complete for core business operations**: auth, users, roles, clients, orders, workflow tasks, masters (agents/qualifications/RTOs/supplier pricing), documents (with versioning), finance (invoices, payments, payment plans), reports (11 endpoints), audit logs (read-only), and saved views. All 20 frontend pages are wired to real API calls (verified by `FULL_RUNTIME_AUDIT.md`). Build, typecheck, and lint pass; 195 Express regression tests pass.

**Critical gaps:** QuickBooks integration is skeleton code only (no real Intuit API calls; placeholder tokens); supplier cost snapshot is hardcoded to 0 on order create; workflow task PATCH route is in a non-dynamic route file (defective); no audit write path exists; payment plan/instalment route files are missing; no Next.js test suite exists; `.env` contains committed real credentials; `clients.email` has no unique index (by design, to preserve the duplicate report).

### Recommended next steps
1. **Do not deploy to production** until committed credentials in `.env` are rotated and removed from the repo.
2. **Fix the supplier cost snapshot bug** (`supplierCostSnapshot: 0` on order create) before any financial reporting is relied upon.
3. **Complete Phase 1** (data integrity fixes, audit writes, indexes) before building new modules.
4. **Obtain QuickBooks sandbox credentials** before starting Phase 4 — the QB integration cannot be verified or completed without them.
5. **Add new collections in the existing `skills_connect_admin` database** for price lists, commission rules, and Excel imports — no separate database is needed.
6. **Add a Next.js test suite** (Vitest + Supertest) covering the route handlers before adding new features.
