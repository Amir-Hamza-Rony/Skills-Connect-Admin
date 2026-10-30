# Skills Connect Admin — Architecture (`architecture.md`)

> Source of truth: `Skills_Connect_Admin_Software_Developer_Specification.docx` (Sections 3, 7, 8, 10, 11, 14).
> Rule: do not claim an integration works merely because it is documented here. Sections are explicitly split into Target / Current / Planned.

## 1. Target architecture

### 1.1 Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend + Backend | Next.js 16 (App Route + Route Handlers) | Single application: React dashboard + REST API on one service |
| Database | MongoDB Atlas | Clients, orders, qualifications, RTOs, agents, payments, documents, tasks, invoices |
| ODM | Native MongoDB driver (Next.js) / Mongoose (Express reference) | Collection access, ObjectId conversion |
| Auth | JWT access (15 min, HS256) + httpOnly rotating refresh (SHA-256 hash, 7 days) | Login, RBAC, session security, refresh rotation + reuse detection |
| Password hashing | argon2id | Matching Express reference implementation |
| File storage | MongoDB BSON Binary | Document bytes stored directly in database; raw binary never exposed to clients |
| Jobs | Inline / BullMQ + Redis (Express reference worker) | Email reminders, QuickBooks sync, overdue checks, background processing |
| External | QuickBooks integration layer (async + auditable) | Invoice/payment sync with idempotency |
| Deploy | Single Next.js service (Render) | Repeatable production deployment |
| Observability | Structured logs + audit_logs collection | Auditability, API/integration troubleshooting |

REST shape follows Spec §14 (`/api/auth/login`, `/api/clients`, `/api/orders`, `/api/orders/:id/status`, `/api/qualifications`, `/api/rtos`, `/api/suppliers-routes`, `/api/invoices`, `/api/payments`, `/api/orders/:id/payment-plan`, `/api/documents/upload`, `/api/documents/:id/download`, `/api/documents/:id/review`, `/api/orders/:id/timeline`, `/api/integrations/quickbooks/sync/*`, `/api/reports/finance`).

### 1.2 Core entities and relationships (Spec §7–§8)

Critical business distinction (non-negotiable): **Sales/Closing Agent** (who brought/closed the client) ≠ **Certificate-Source Agent** (intermediary used to source the qualification) ≠ **actual issuing RTO/College** (provider that issues the qualification). Three separate fields/entities; never a single generic "Agent" field.

- **users** (`name, email, phone, roleIds, active, lastLoginAt`) → * **roles** (`name, permissions[]`).
- **clients** (`legalName, preferredName, phone, email, address, status, sourceAgentId, notes`) — one record per human; **one client → many orders**. Deduplication is a manual-review workflow, not name matching.
- **orders** (certificate/enrolment transaction: `clientId, qualificationId, salesAgentId, sourceAgentId, rtoId, sellingPrice, supplierCostSnapshot, status, invoiceIds, paymentPlanId, documentChecklistId, timestamps`) — each order belongs to **exactly one client and one qualification**; may have one *current* RTO and one *current* source agent; route changes are audited, snapshots preserved.
- **qualifications** (`code, title, trainingPackage, industry, status, licensingRefs[]`) → * **document_requirements** (`qualificationId, requiredDocuments[]`); ↔ **rtos** via **supplier_routes**.
- **agents** (`name, type, contact, commissionRule, active`) with `type ∈ {sales_closing, certificate_source, rto_contact}`; RTO contacts may additionally link to an **rtos** record (`rtos.contacts[]`).
- **rtos** (`legalName, tradingName, rtoCode, cricosCode, contacts[], status, website`, risk/compliance status + effective dates).
- **supplier_routes** (`qualificationId, sourceAgentId, rtoId, wholesaleCost, effectiveFrom, effectiveTo, status`) — the qualification → agent → RTO pricing matrix; history preserved (never overwrite a price used by an old order).
- **documents** (`clientId, orderId, type, fileName, contentType, sizeBytes, data, version, status, receivedAt, reviewedAt, reviewedBy`) — many per order; versions immutable (new version supersedes, never overwrites an approved version). File bytes stored as BSON Binary in MongoDB; raw binary never exposed to clients.
- **workflow_tasks** (`orderId, stage, title, assigneeId, dueDate, status, priority`) + order-level status history (timestamp, actor, before → after).
- **invoices** (`orderId, invoiceNumber, total, dueDate, status, quickBooksInvoiceId`) — linked to the correct order; **payment_plans** (`orderId, total, instalments[]` with unlimited schedules) — distinct from **payments** (`orderId, invoiceId, amount, date, method, reference, allocatedAmount, status`).
- **certificates** (`orderId, qualificationId, certificateNumber, issueDate, deliveredAt`) — required before an order reports Issued (unless authorised override). Certificate files, like documents, are stored as BSON Binary in MongoDB.
- **communications** (optional Phase-1 log: `clientId, orderId, channel, direction, message, sentAt, status`).
- **audit_logs** (`actorId, entityType, entityId, action, before, after, timestamp, ip`) — immutable; covers status, financial, document, and RTO-route changes plus sensitive document access.
- **QuickBooks records/fields** (`quickBooksCustomerId, quickBooksInvoiceId, quickBooksPaymentId, quickBooksSyncStatus ∈ {Not Synced, Pending, Synced, Failed}, quickBooksLastSyncAt, quickBooksSyncError`) stored on invoice/payment (and customer link) for idempotent sync.

Recommended Order shape (Spec §8) snapshots `sellingPrice`, `supplierCostSnapshot`, `otherCost`, `currency: AUD` at creation so later price-matrix edits do not rewrite history.

### 1.3 Financial integrity rules

- `grossMargin = sellingPrice − supplierCost − otherCost`; `balanceDue = invoiceTotal − amountPaid − credits`; `amountPaid = Σ allocated payments`; `Outstanding = InvoiceTotal − Σ allocated − credits/adjustments`; `Overdue = unpaid scheduled amount with dueDate < today` (subject to order/invoice status). Payment status is **calculated**, not hand-typed.
- Payments are transactions; instalment plans are schedules — never four fixed columns; instalment states: Pending/Due/Paid/Part Paid/Overdue/Waived/Cancelled.
- No deletion of financial transactions; reversals/refunds/voids only, all audit-logged. Only authorised roles may change amounts, supplier costs, or RTO mappings.

### 1.4 Security boundaries and data flow

- Browser → API (auth-required; RBAC enforced **server-side**; frontend hiding is not enforcement) → MongoDB / job queue → QuickBooks (server-side only).
- Auth: short-lived access credential + rotated refresh/session; server-side token/secret storage; no QB passwords/tokens in frontend; no secrets in `localStorage` (theme preference only).
- Documents: metadata and bytes in MongoDB; upload via `POST /api/documents/upload` (multipart/form-data), download via `GET /api/documents/:id/download`; every sensitive access logged.
- QuickBooks sync is **asynchronous and idempotent**: create-in-Skills-Connect → enqueue with idempotency key + external IDs → save QB IDs on success; import/webhook path for QB-created invoices/payments; `syncStatus/lastSyncAt/syncError` visible; authorised retry; duplicate-invoice-on-retry is a defect.
- Audit log is append-only; finance/admin mutations record actor, entity, before/after, timestamp, IP.

## 2. Current implementation status

- **Next.js application**: Single service containing frontend + all ~85 API routes (`src/app/api/`). `npm run dev` starts `next dev`; `npm run build` produces a production build; `npm run start` runs the production server.
- **Express reference**: `server/` is preserved as a reference implementation. All 195 Express regression tests pass. The Express server is NOT required at runtime.
- **Frontend API calls**: `src/lib/api.ts` and `src/lib/ops-store.ts` use relative `/api/*` paths (default when `NEXT_PUBLIC_API_BASE_URL` is unset), targeting Next.js Route Handlers.
- **TypeScript**: Clean typecheck.
- **Lint**: Clean (oxlint).
- **Build**: `next build` succeeds (all 59 routes compiled).
- **Tests**: 195/195 Express regression tests pass. No dedicated Next.js test suite yet.

## 3. External dependencies and configuration

- **Required before production:** MongoDB Atlas connection string, Redis (if BullMQ worker used), QuickBooks app credentials + sandbox, source workbook `RTO & Onboarding Master Hub.xlsx` + legacy Drive files, deployment host access.
- **Never invent:** API credentials, provider IDs, confirmed integrations, production URLs, RTO codes, commission rates. Placeholders must be labelled `PLACEHOLDER — not a real credential`.
- **Config rules:** secrets via environment/secret manager only; never commit `.env`; never log or print secret values; QB sync config server-side; `localStorage` holds only the theme preference.

## 4. Testing, logging, deployment

- Tests: unit (financial calc, status transitions, idempotency keys), API/integration (RBAC matrix, order lifecycle, document review, invoice→payment→balance), migration reconciliation (Excel + QuickBooks totals), UAT on real migrated records per acceptance criteria.
- Logging: structured API logs + audit_logs collection + job/sync attempt history; error monitoring for API and QB failures.
- Deployment: Next.js production build, env-separated config, migration-then-cutover sequence with rollback criterion (finance totals must reconcile before Excel is frozen).
