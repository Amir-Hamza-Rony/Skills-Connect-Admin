# Skills Connect Admin — Architecture (`architecture.md`)

> Source of truth: `Skills_Connect_Admin_Software_Developer_Specification.docx` (Sections 3, 7, 8, 10, 11, 14).
> Rule: do not claim an integration works merely because it is documented here. Sections are explicitly split into Target / Current / Planned.

## 1. Target architecture

### 1.1 Stack (per specification, to be verified at scaffolding)

| Layer | Recommendation (Spec §3) | Purpose |
|---|---|---|
| Frontend | React + TypeScript (Vite build; Tailwind CSS + shadcn/ui per project direction) | Admin dashboard, forms, tables, filters, document views, role-based screens |
| Backend | Node.js + Express + TypeScript | REST API, business rules, auth, workflow, integrations |
| Database | MongoDB | Clients, orders, qualifications, RTOs, agents, payments, documents, tasks, invoices |
| ODM | Mongoose (if consistent with implementation chosen at scaffolding) | Schemas, validation, references, middleware for audit/snapshots |
| Auth | Secure session strategy **or** appropriately implemented JWT + refresh-token rotation | Login, RBAC, session security |
| File storage | S3-compatible object-storage abstraction | Evidence, ID, certificates, invoices, supporting docs (metadata in MongoDB, bytes in object storage) |
| Jobs | BullMQ + Redis or equivalent | Email reminders, QuickBooks sync, overdue checks, background processing |
| External | QuickBooks integration layer (async + auditable) | Invoice/payment sync with idempotency |
| Deploy | Docker + managed cloud hosting | Repeatable production deployment and scaling |
| Observability | Central logs + error monitoring | Auditability, API/integration troubleshooting |

REST shape follows Spec §14 (`/auth/login`, `/clients`, `/clients/:id/orders`, `/orders`, `/orders/:id/status`, `/qualifications`, `/rtos`, `/supplier-routes`, `/invoices`, `/payments`, `/orders/:id/payment-plan`, `/documents/upload-url`, `/documents/:id/review`, `/orders/:id/timeline`, `/integrations/quickbooks/sync/*`, `/reports/finance`).

### 1.2 Core entities and relationships (Spec §7–§8)

Critical business distinction (non-negotiable): **Sales/Closing Agent** (who brought/closed the client) ≠ **Certificate-Source Agent** (intermediary used to source the qualification) ≠ **actual issuing RTO/College** (provider that issues the qualification). Three separate fields/entities; never a single generic “Agent” field.

- **users** (`name, email, phone, roleIds, active, lastLoginAt`) → * **roles** (`name, permissions[]`).
- **clients** (`legalName, preferredName, phone, email, address, status, sourceAgentId, notes`) — one record per human; **one client → many orders**. Deduplication is a manual-review workflow, not name matching.
- **orders** (certificate/enrolment transaction: `clientId, qualificationId, salesAgentId, sourceAgentId, rtoId, sellingPrice, supplierCostSnapshot, status, invoiceIds, paymentPlanId, documentChecklistId, timestamps`) — each order belongs to **exactly one client and one qualification**; may have one *current* RTO and one *current* source agent; route changes are audited, snapshots preserved.
- **qualifications** (`code, title, trainingPackage, industry, status, licensingRefs[]`) → * **document_requirements** (`qualificationId, requiredDocuments[]`); ↔ **rtos** via **supplier_routes**.
- **agents** (`name, type, contact, commissionRule, active`) with `type ∈ {sales_closing, certificate_source, rto_contact}`; RTO contacts may additionally link to an **rtos** record (`rtos.contacts[]`).
- **rtos** (`legalName, tradingName, rtoCode, cricosCode, contacts[], status, website`, risk/compliance status + effective dates).
- **supplier_routes** (`qualificationId, sourceAgentId, rtoId, wholesaleCost, effectiveFrom, effectiveTo, status`) — the qualification → agent → RTO pricing matrix; history preserved (never overwrite a price used by an old order).
- **documents** (`clientId, orderId, type, storageKey, version, status, receivedAt, reviewedAt, reviewedBy`) — many per order; versions immutable (new version supersedes, never overwrites an approved version). Storage path convention: `/clients/{clientId}/orders/{orderId}/{documentType}/{version}`; signed URLs only; raw keys never exposed to clients.
- **workflow_tasks** (`orderId, stage, title, assigneeId, dueDate, status, priority`) + order-level status history (timestamp, actor, before → after).
- **invoices** (`orderId, invoiceNumber, total, dueDate, status, quickBooksInvoiceId`) — linked to the correct order; **payment_plans** (`orderId, total, instalments[]` with unlimited schedules) — distinct from **payments** (`orderId, invoiceId, amount, date, method, reference, allocatedAmount, status`).
- **certificates** (`orderId, qualificationId, certificateNumber, issueDate, storageKey, deliveredAt`) — required before an order reports Issued (unless authorised override).
- **communications** (optional Phase-1 log: `clientId, orderId, channel, direction, message, sentAt, status`).
- **audit_logs** (`actorId, entityType, entityId, action, before, after, timestamp, ip`) — immutable; covers status, financial, document, and RTO-route changes plus sensitive document access.
- **QuickBooks records/fields** (`quickBooksCustomerId, quickBooksInvoiceId, quickBooksPaymentId, quickBooksSyncStatus ∈ {Not Synced, Pending, Synced, Failed}, quickBooksLastSyncAt, quickBooksSyncError`) stored on invoice/payment (and customer link) for idempotent sync.

Recommended Order shape (Spec §8) snapshots `sellingPrice`, `supplierCostSnapshot`, `otherCost`, `currency: AUD` at creation so later price-matrix edits do not rewrite history.

### 1.3 Financial integrity rules

- `grossMargin = sellingPrice − supplierCost − otherCost`; `balanceDue = invoiceTotal − amountPaid − credits`; `amountPaid = Σ allocated payments`; `Outstanding = InvoiceTotal − Σ allocated − credits/adjustments`; `Overdue = unpaid scheduled amount with dueDate < today` (subject to order/invoice status). Payment status is **calculated**, not hand-typed.
- Payments are transactions; instalment plans are schedules — never four fixed columns; instalment states: Pending/Due/Paid/Part Paid/Overdue/Waived/Cancelled.
- No deletion of financial transactions; reversals/refunds/voids only, all audit-logged. Only authorised roles may change amounts, supplier costs, or RTO mappings.

### 1.4 Security boundaries and data flow

- Browser → API (auth-required; RBAC enforced **server-side**; frontend hiding is not enforcement) → MongoDB / object storage / job queue → QuickBooks (server-side only).
- Auth: short-lived access credential + rotated refresh/session; server-side token/secret storage; no QB passwords/tokens in frontend; no secrets in `localStorage` (theme preference only).
- Documents: metadata in MongoDB, bytes in S3-compatible storage; upload/download via short-lived signed URLs generated by `POST /documents/upload-url`; every sensitive access logged.
- QuickBooks sync is **asynchronous and idempotent**: create-in-Skills-Connect → enqueue with idempotency key + external IDs → save QB IDs on success; import/webhook path for QB-created invoices/payments; `syncStatus/lastSyncAt/syncError` visible; authorised retry; duplicate-invoice-on-retry is a defect.
- Audit log is append-only; finance/admin mutations record actor, entity, before/after, timestamp, IP.

## 2. Current implementation verified from the repository

**Nothing to verify yet.** On 2026-10-09 the project folder (`D:/Office Work/Admin SC`) contains:

- `Skills_Connect_Admin_Software_Developer_Specification.docx` (source of truth; must stay untracked — see §4).
- No `package.json`, no frontend/backend directories, no config, no components, no tests, no Dockerfile, no `.gitignore`, no `design.md`/`architecture.md`/`workflow.md` (prior to this task), no git repository/branch.

Therefore: **no Phase 1 or Phase 1.1 work exists in this folder**. There is no authenticated route, no Mongoose model, no S3/Redis/QB wiring, no theme/scrolling implementation to audit. Any neighbouring folders (`D:/Office Work/skill-connect`, `D:/Office Work/saffron`) are separate projects and must not be conflated with this one.

## 3. Planned implementation

Day-1 (this task): documentation only + minimal `.gitignore` protection for the confidential DOCX. No code, no stack changes, no packages.

Build order per Spec §23 (see `workflow.md` roadmap): data dictionary/status enums → auth/users/roles → RTO/agent/qualification masters → clients → orders → document checklist + secure upload → payment plans/payments/invoices → dashboards/queues → audit logging → Excel import/migration → QuickBooks idempotent sync + retries → UAT on migrated records → finance reconciliation → production cutover with Excel frozen as archive.

Treat as **proposed/planned until confirmed in code**: Mongoose vs alternative ODM, Vite vs other bundler, session vs JWT rotation, S3 provider choice, BullMQ+Redis vs equivalent queue, Docker target, log/error-monitoring vendor, commission engine, client portal, WhatsApp/email automation, BI/Power BI, AI classification (all Phase 2 per Spec §21).

## 4. External dependencies and configuration

- **Required before production:** MongoDB access/connection string, S3-compatible bucket + credentials (server-side env only), Redis (if BullMQ chosen), QuickBooks app credentials + sandbox, source workbook `RTO & Onboarding Master Hub.xlsx` + legacy Drive files, deployment host access.
- **Never invent:** API credentials, provider IDs, confirmed integrations, production URLs, RTO codes, commission rates. Placeholders must be labelled `PLACEHOLDER — not a real credential`.
- **Config rules:** secrets via environment/secret manager only; never commit `.env`; never log or print secret values; QB sync config server-side; `localStorage` holds only the theme preference.

## 5. Testing, logging, deployment (planned)

- Tests: unit (financial calc, status transitions, idempotency keys), API/integration (RBAC matrix, order lifecycle, document review, invoice→payment→balance), migration reconciliation (Excel + QuickBooks totals), UAT on real migrated records per acceptance criteria.
- Logging: structured API logs + audit_logs collection + job/sync attempt history; error monitoring for API and QB failures.
- Deployment: containerised build, env-separated config, migration-then-cutover sequence with rollback criterion (finance totals must reconcile before Excel is frozen).
