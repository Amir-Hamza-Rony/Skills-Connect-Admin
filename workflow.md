# Skills Connect Admin — Business & Development Workflow (`workflow.md`)

> Source of truth: `Skills_Connect_Admin_Software_Developer_Specification.docx` (Sections 1–24).
> Current state: single Next.js application containing frontend + backend, connected to MongoDB Atlas. `server/` is preserved as a reference implementation. All 195 Express regression tests pass.

## 1. End-to-end chain (Spec §24)

```text
CLIENT → ORDER/QUALIFICATION → SOURCE AGENT → RTO/COLLEGE → DOCUMENTS → WORKFLOW → INVOICE → PAYMENT PLAN → PAYMENTS → CERTIFICATE
```

Everything references this chain. The database is normalized to support multiple certificates per client, multiple payments per order, changing supplier/RTO routes, document versions, and full audit history. Do not recreate Excel column-for-column (Spec §2).

## 2. Authentication and role/permission checks

1. `POST /api/auth/login` → server verifies credentials (argon2id), issues short-lived access JWT (15 min) + rotated httpOnly refresh cookie (SHA-256 hash, 7 days); records `lastLoginAt`. Rate-limited (5 attempts per 15 min per IP+email). Account locked after 10 failures for 15 minutes.
2. Every API route enforces authentication **and** role permissions server-side via `withAuth("permission", handler)`. Frontend hiding/route guards are UX only and **do not enforce permissions**.
3. Roles (Spec §11 — terminology preserved):

| Role | Typical permissions |
|---|---|
| Super Admin | Everything incl. users, roles, settings, integrations, audit logs |
| Finance | Invoices, payments, payment plans, QuickBooks sync, finance reports; cannot delete audit history |
| Operations | Clients, orders, documents, workflow, RTO submissions, certificates |
| Sales / Closing Agent | Own clients/orders, notes, permitted communication + payment visibility |
| RTO / Sourcing Manager | Supplier agents, RTOs, qualification pricing, sourcing route, provider status |
| Document Reviewer | View/upload/review documents; cannot change financial records |
| Read Only / Manager | Dashboards + reports, no editing |

4. Only authorised roles may change financial amounts, supplier costs, or RTO mappings. All sensitive document access and all major status/financial changes are audit-logged (actor, before → after, timestamp, IP).
5. Refresh token rotation: presenting a used/revoked refresh token revokes the whole session family (safe default). Replays return 401.

## 3. Client creation and duplicate review

1. Create client once (`legalName, preferredName, phone, email, address, notes, sourceAgentId`); never duplicate a client per certificate.
2. `clientId` is unique internal ID; duplicates are resolved by manual review (spellings, phone/email match), supported by a Duplicate Review queue (`Clients → Duplicate Review`).
3. Allow multiple contact methods/addresses if needed; store communication preferences.
4. Client profile = single workspace (Spec §19): header (name, ID, phone, email, status) + financial summary (invoiced/paid/outstanding/overdue) + tabs: Orders | Documents | Payments | Invoices | Workflow timeline | Notes/Communications | Audit (authorised only).

## 4. Orders: multiple qualifications per client, three-way agent/RTO selection

1. Each requested qualification becomes an **Order/Enrolment** (`POST /api/orders`) linked to exactly one client and one qualification (`clientId, qualificationId`).
2. One client may have multiple simultaneous orders; supplier/RTO route may change mid-life with audit history preserved.
3. Per order, select **three separate entities**: Sales/Closing Agent + Certificate-Source Agent + issuing RTO/College (with RTO code).
4. Snapshot `sellingPrice` + `supplierCostSnapshot` (+ `otherCost`, `currency: AUD`) on the order; later price-matrix edits must not rewrite history. `grossMargin = sellingPrice − supplierCost − otherCost`.
5. Qualification + supplier pricing selection comes from `supplier_routes` (qualification → source agent → RTO → wholesale cost + effective dates); store client selling price separately.

## 5. Document request, upload, review, versioning

1. Per-order checklist derived from `document_requirements` (qualification → required documents). Types include identity, USI/transcript, employment evidence, reference letters, photos/skills evidence, RTO enrolment kit, certificate (Spec §9).
2. Lifecycle: `POST /api/documents/upload` (multipart/form-data) → file bytes stored directly in MongoDB → metadata in MongoDB (`type, fileName, contentType, sizeBytes, version, status, receivedAt, reviewedAt, reviewedBy`).
3. Review (`PATCH /api/documents/:id/review`): approve/reject with reason; versions immutable — a new version **supersedes**, never overwrites an approved version.
4. Raw binary never exposed to the browser; downloads stream through `GET /api/documents/:id/download`. Every sensitive access logged.

## 6. Statuses — never a single generic field (Spec §5–§6)

Order pipeline groups: Sales (`Lead, Qualified, Won, Lost`) → Onboarding (`New, Awaiting Payment, Awaiting Documents, Documents Under Review`) → Submission (`Ready for Submission, Submitted to Source Agent, Submitted to RTO, RTO Acknowledged`) → Assessment (`Under Assessment, Additional Evidence Required, Rework Required`) → Completion (`Approved, Certificate Issued, Completed`) → Exception (`On Hold, Cancelled, Refunded`) at any point without losing history.

Independent dimensions (use these exact vocabularies; do not simplify):

- **Document:** Requested, Not Received, Received, Under Review, Approved, Rejected, Superseded
- **Evidence:** Not Started, In Progress, Complete, Additional Evidence Required
- **RTO submission:** Not Ready, Ready, Submitted, Acknowledged, Under Assessment, Additional Evidence Required, Issued
- **Certificate:** Not Issued, Pending, Issued, Certificate File Received, Delivered to Client
- **Payment:** Unpaid, Part Paid, Paid, Overdue, Refunded, Written Off (calculated where possible)
- **Instalment:** Pending, Due, Paid, Part Paid, Overdue, Waived, Cancelled

Every status change records timestamp, staff member, previous and new value (`PATCH /api/orders/:id/status`, `GET /api/orders/:id/timeline`); auto-create `workflow_tasks` on stage entry. Completion requires configured criteria unless an authorised admin overrides; Certificate → Issued requires a `certificates` record (or authorised override).

## 7. Invoices, payment plans, payments, allocation, refunds

1. Invoice (`POST /api/invoices`): linked to correct order (`orderId, invoiceNumber, total, dueDate, status, quickBooksInvoiceId`).
2. Payment plan (`POST /api/orders/:id/payment-plan`): **unlimited** scheduled instalments (deposit + N instalments); never four fixed columns.
3. Payment (`POST /api/payments`): actual money transaction (`orderId, invoiceId, amount, date, method ∈ {bank transfer, card, cash, other configurable}, reference, allocatedAmount, status`); never confused with a scheduled instalment. One payment may allocate to one invoice or split across invoices if required.
4. Formulas: `amountPaid = Σ allocated`; `balanceDue = invoiceTotal − amountPaid − credits`; `Outstanding = InvoiceTotal − Σ allocated − credits/adjustments`; `Overdue = unpaid scheduled amount with dueDate < today` (subject to status). Recording a payment immediately updates paid/balance/status.
5. No deletion of transactions — reversal/refund/void workflows only, all audit-logged with actor + timestamps.

## 8. QuickBooks sync (async, idempotent, auditable)

Skills Connect admin = operational system of record (clients, workflow, documents, operational payments); QuickBooks = accounting system of record (Spec §10).

1. Create invoice in Skills Connect → enqueue (`POST /api/integrations/quickbooks/sync/invoice`) with **idempotency key + external IDs** → save `quickBooksInvoiceId` on success. Same for payments.
2. Import/webhook path attaches QB-created invoices/payments to the correct order (`POST /api/integrations/quickbooks/webhook`).
3. Display `quickBooksSyncStatus ∈ {Not Synced, Pending, Synced, Failed}` + `quickBooksLastSyncAt` + `quickBooksSyncError`; authorised admin retries failures. Retried jobs must never create duplicates.
4. QB passwords/tokens stored server-side only, never in frontend or logs. No QB export was provided with the spec — the layer is defined here, not reverse-engineered.
5. **Do not claim QuickBooks is fully functional** without QB sandbox credentials and an authorised company connection. Routes degrade gracefully when not configured.

## 9. Dashboards, reporting, search, client tabs

- Dashboards (Spec §12): Management / Finance / Operations / Agent / RTO-Sourcing widget sets; overdue, sync-error, and queue counts are first-class.
- Reports: revenue by month/agent/qualification/source-agent/RTO; outstanding + overdue ageing; costs + margin; orders by stage; document completion/rejection; certificate lead time (creation → issuance).
- Search/filters (Spec §13): global search (client name, phone, email, invoice number, order ID, qualification code, certificate number); order filters (status, qualification, sales/source agent, RTO, payment status, date range); document filters (missing/rejected/under review/received); payment filters (due/overdue/method/agent); saved views (Documents Missing, Payment Overdue, Ready for RTO, Under Assessment, Certificate Issued).
- Client tabs per §3 above; navigation per Spec §18 (Dashboard, Clients, Orders, Qualifications, RTOs & Colleges, Agents, Documents, Finance, Workflow, Reports, Settings, Audit).

## 10. Excel migration and reconciliation (Spec §16–§17)

Order: (1) RTO Directory → `rtos` + `qualifications` (dedupe names/codes); (2) Price Matrix → `supplier_routes` (normalize column-spread providers); (3) Onboarding Tracker → `clients` + `orders`; (4) Financial Tracker → `orders` + `invoices` + `payment_plans` + `payments` (convert 4 fixed instalment columns → plan/payment records); (5) manual duplicate-client review; (6) Licensing & Skills Assessment → qualification/licensing refs; (7) freeze workbook as read-only archive; (8) reconcile financial totals against QuickBooks; (9) duplicate-client report before enabling order creation; (10) cutover only after reconciliation.

Known quality risks: RTO name/abbreviation variants; blank Target RTO rows; free-text source/RTO instead of IDs; inconsistent dates; `Pending` vs `Pending␣` whitespace variants; Drive links → `legacyExternalLink`.

## 11. Testing, deployment, acceptance verification

- Unit/integration: financial formulas, status-transition guards, RBAC matrix, document versioning, idempotent QB retry, overdue calculation.
- Migration checks: row-count + total reconciliation (Excel vs DB vs QuickBooks), duplicate-client report, whitespace/status normalization audit.
- UAT on real migrated records against Spec §22 acceptance criteria (client-once/multiple-orders; visible sales/source/RTO; margin calc; unlimited instalments; payment→balance update; overdue detection; per-document review; doc≠RTO status independence; timeline; invoice→order link; QB retry; filtered reports; permission denials; audit coverage; reconciliation).
- Deployment: Next.js production build, env-separated config, migration-then-cutover sequence with rollback criterion (finance totals must reconcile before Excel is frozen).

## 12. Five-day delivery plan (aggressive — not a guarantee)

- **Day 1 — Documentation, foundation, premium shell, theme, scrolling, baseline QA.** Complete spec review; `design.md`/`architecture.md`/`workflow.md`; scaffold project + navigation shell; Light/Dark/System theme + independent scrolling; loading/empty/error states.
- **Day 2 — Auth, RBAC, masters.** Users/roles/permissions, JWT/session auth, qualifications, RTO directory + contacts, sales/source agents, supplier pricing matrix.
- **Day 3 — Clients, orders, workflow, documents/evidence.** Client CRUD + duplicate review, multi-order per client, three-way agent/RTO selection, snapshots, status engine + tasks + history, checklist + signed-URL upload + review/versioning.
- **Day 4 — Finance, QuickBooks, dashboards, audit/search/migration.** Invoices, unlimited instalment plans, payments + allocation + refunds, async idempotent QB sync + retry UI, role dashboards + reports + saved views, audit log, Excel import + reconciliation scaffolding.
- **Day 5 — Integration, security, responsive/theme testing, deployment, UAT/handover.** End-to-end chain test, RBAC/security review (no secrets in client/logs), responsive + theme-flash testing, deployment verification, UAT on migrated records, archive-freeze handover.

External requirements that can block Day 4–5: database access, Redis (if BullMQ), QuickBooks credentials + API access, source workbook + Drive files, deployment credentials. Do not promise production integrations or full reconciliation without them.

## 13. Requirements traceability checklist

Status key: **Planned** (documented, no code) · **In Progress** · **Implemented** (evidence in repo) · **Verified** (tested/accepted).

| Area | Status | Notes |
|---|---|---|
| Platform & architecture | Verified | Single Next.js service, all ~85 API routes migrated, build succeeds, 195/195 Express tests pass |
| Auth & RBAC | Verified | argon2id, JWT + rotating refresh, rate limiting, lockout, reuse detection, all 6 auth endpoints verified |
| Clients / Orders | Implemented | All endpoints migrated; Next.js tests pending |
| Documents | Implemented | Upload/download/review/access-log migrated; Next.js tests pending |
| Finance | Implemented | Invoices/payments/plans/refunds migrated; Next.js tests pending |
| Reports | Implemented | 5 reports verified end-to-end; others migrated |
| QuickBooks | Implemented (degrades gracefully) | Routes created; not functionally verified without QB credentials |
| Masters | Implemented | All CRUD migrated; Next.js tests pending |
| Users / Roles | Implemented | Role PATCH verified; others migrated |
| Saved Views | Verified | All 4 endpoints verified end-to-end |
| Workflow | Verified | All 3 endpoints verified |
| Health | Implemented | `/api/health` and `/api/health/ready` migrated |

## 14. Ambiguities and external-dependent blockers

1. QuickBooks sync is **not functionally verified** without QB sandbox credentials and an authorised company connection. Routes exist and degrade gracefully, but end-to-end sync cannot be confirmed.
2. Excel import/reconciliation scripts exist in `server/src/scripts/` but are not yet part of the Next.js application.
3. Workbook `RTO & Onboarding Master Hub.xlsx` and QuickBooks export were not present — migration and reconciliation cannot be verified without them.
4. No dedicated Next.js test suite exists; all 195 tests are Express regression tests. Next.js route handlers are verified manually against the live dev server.
5. Exact RBAC permission matrix, commission rules, completion-criteria per qualification, and document-type catalogue need business confirmation.

## 15. Backend roadmap (Phase B1–B6)

Full detail: `BACKEND-PLAN.md`. Phases B1–B2 verified against Express reference. B3–B6 migrated to Next.js Route Handlers. `server/` reference implementation preserved until migration fully verified in production.
