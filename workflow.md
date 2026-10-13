# Skills Connect Admin — Business & Development Workflow (`workflow.md`)

> Source of truth: `Skills_Connect_Admin_Software_Developer_Specification.docx` (Sections 1–24).
> Current repository state (2026-10-09): no code exists in this folder; every workflow below is **Planned** unless evidence is later committed. Do not mark anything Implemented/Verified without repository evidence.

## 1. End-to-end chain (Spec §24)

```text
CLIENT → ORDER/QUALIFICATION → SOURCE AGENT → RTO/COLLEGE → DOCUMENTS → WORKFLOW → INVOICE → PAYMENT PLAN → PAYMENTS → CERTIFICATE
```

Everything references this chain. The database is normalized to support multiple certificates per client, multiple payments per order, changing supplier/RTO routes, document versions, and full audit history. Do not recreate Excel column-for-column (Spec §2).

## 2. Authentication and role/permission checks

1. `POST /auth/login` → server verifies credentials, issues short-lived access credential + rotated refresh/session; records `lastLoginAt`.
2. Every API route enforces authentication **and** role permissions server-side. Frontend hiding/route guards are UX only and **do not enforce permissions**.
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
5. Ambiguity flagged: exact permission matrix (e.g. can Sales edit source-agent/RTO fields? can Operations void invoices?) is not enumerated in the spec and must be confirmed with the business before Day-2 build.

## 3. Client creation and duplicate review

1. Create client once (`legalName, preferredName, phone, email, address, notes, sourceAgentId`); never duplicate a client per certificate.
2. `clientId` is unique internal ID; duplicates are resolved by manual review (spellings, phone/email match), supported by a Duplicate Review queue (`Clients → Duplicate Review`).
3. Allow multiple contact methods/addresses if needed; store communication preferences.
4. Client profile = single workspace (Spec §19): header (name, ID, phone, email, status) + financial summary (invoiced/paid/outstanding/overdue) + tabs: Orders | Documents | Payments | Invoices | Workflow timeline | Notes/Communications | Audit (authorised only).

## 4. Orders: multiple qualifications per client, three-way agent/RTO selection

1. Each requested qualification becomes an **Order/Enrolment** (`POST /clients/:id/orders`) linked to exactly one client and one qualification (`clientId, qualificationId`).
2. One client may have multiple simultaneous orders; supplier/RTO route may change mid-life with audit history preserved.
3. Per order, select **three separate entities**: Sales/Closing Agent + Certificate-Source Agent + issuing RTO/College (with RTO code). Example (Spec §20): Client [illustrative example client], Sales [illustrative closing agent], Qualification *AUR32120 Certificate III in Automotive Body Repair Technology*, Source Agent from supplier directory, issuing RTO with valid qualification mapping, Client Price AUD 2,500, Supplier Cost AUD 700 snapshot.
4. Snapshot `sellingPrice` + `supplierCostSnapshot` (+ `otherCost`, `currency: AUD`) on the order; later price-matrix edits must not rewrite history. `grossMargin = sellingPrice − supplierCost − otherCost`.
5. Qualification + supplier pricing selection comes from `supplier_routes` (qualification → source agent → RTO → wholesale cost + effective dates); store client selling price separately.

## 5. Document request, upload, review, versioning

1. Per-order checklist derived from `document_requirements` (qualification → required documents). Types include identity, USI/transcript, employment evidence, reference letters, photos/skills evidence, RTO enrolment kit, certificate (Spec §9).
2. Lifecycle: `POST /documents/upload-url` → signed URL → upload to S3-compatible storage (`/clients/{clientId}/orders/{orderId}/{documentType}/{version}`) → metadata in MongoDB (`type, storageKey, version, status, receivedAt, reviewedAt, reviewedBy`). Drive links retained only as `legacyExternalLink` during migration.
3. Review (`PATCH /documents/:id/review`): approve/reject with reason; versions immutable — a new version **supersedes**, never overwrites an approved version.
4. Raw storage keys never exposed; temporary signed URLs only.

## 6. Statuses — never a single generic field (Spec §5–§6)

Order pipeline groups: Sales (`Lead, Qualified, Won, Lost`) → Onboarding (`New, Awaiting Payment, Awaiting Documents, Documents Under Review`) → Submission (`Ready for Submission, Submitted to Source Agent, Submitted to RTO, RTO Acknowledged`) → Assessment (`Under Assessment, Additional Evidence Required, Rework Required`) → Completion (`Approved, Certificate Issued, Completed`) → Exception (`On Hold, Cancelled, Refunded`) at any point without losing history.

Independent dimensions (use these exact vocabularies; do not simplify):

- **Document:** Requested, Not Received, Received, Under Review, Approved, Rejected, Superseded
- **Evidence:** Not Started, In Progress, Complete, Additional Evidence Required
- **RTO submission:** Not Ready, Ready, Submitted, Acknowledged, Under Assessment, Additional Evidence Required, Issued
- **Certificate:** Not Issued, Pending, Issued, Certificate File Received, Delivered to Client
- **Payment:** Unpaid, Part Paid, Paid, Overdue, Refunded, Written Off (calculated where possible)
- **Instalment:** Pending, Due, Paid, Part Paid, Overdue, Waived, Cancelled

Every status change records timestamp, staff member, previous and new value (`PATCH /orders/:id/status`, `GET /orders/:id/timeline`); auto-create `workflow_tasks` on stage entry. Completion requires configured criteria unless an authorised admin overrides; Certificate → Issued requires a `certificates` record (or authorised override).

## 7. Invoices, payment plans, payments, allocation, refunds

1. Invoice (`POST /invoices`): linked to correct order (`orderId, invoiceNumber, total, dueDate, status, quickBooksInvoiceId`).
2. Payment plan (`POST /orders/:id/payment-plan`): **unlimited** scheduled instalments (deposit + N instalments); never four fixed columns.
3. Payment (`POST /payments`): actual money transaction (`orderId, invoiceId, amount, date, method ∈ {bank transfer, card, cash, other configurable}, reference, allocatedAmount, status`); never confused with a scheduled instalment. One payment may allocate to one invoice or split across invoices if required.
4. Formulas: `amountPaid = Σ allocated`; `balanceDue = invoiceTotal − amountPaid − credits`; `Outstanding = InvoiceTotal − Σ allocated − credits/adjustments`; `Overdue = unpaid scheduled amount with dueDate < today` (subject to status). Recording a payment immediately updates paid/balance/status.
5. No deletion of transactions — reversal/refund/void workflows only, all audit-logged with actor + timestamps.

## 8. QuickBooks sync (async, idempotent, auditable)

Skills Connect admin = operational system of record (clients, workflow, documents, operational payments); QuickBooks = accounting system of record (Spec §10).

1. Create invoice in Skills Connect → enqueue (`POST /integrations/quickbooks/sync/invoice`) with **idempotency key + external IDs** → save `quickBooksInvoiceId` on success. Same for payments.
2. Import/webhook path attaches QB-created invoices/payments to the correct order.
3. Display `quickBooksSyncStatus ∈ {Not Synced, Pending, Synced, Failed}` + `quickBooksLastSyncAt` + `quickBooksSyncError`; authorised admin retries failures. Retried jobs must never create duplicates.
4. QB passwords/tokens stored server-side only, never in frontend or logs. No QB export was provided with the spec — the layer is defined here, not reverse-engineered.

## 9. Dashboards, reporting, search, client tabs

- Dashboards (Spec §12): Management / Finance / Operations / Agent / RTO-Sourcing widget sets (see `design.md` §6); overdue, sync-error, and queue counts are first-class.
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
- Deployment: Docker + managed host; env-separated config; freeze spreadsheets only after finance reconciliation; rollback if totals diverge.

---

## 12. Five-day delivery plan (aggressive — not a guarantee)

- **Day 1 — Documentation, foundation, premium shell, theme, scrolling, baseline QA.** Complete spec review; `design.md`/`architecture.md`/`workflow.md`; scaffold project + navigation shell; Light/Dark/System theme + independent scrolling; loading/empty/error states. *Deps: spec (available), hosting/DB decisions. No business modules.*
- **Day 2 — Auth, RBAC, masters.** Users/roles/permissions, JWT/session auth, qualifications, RTO directory + contacts, sales/source agents, supplier pricing matrix. *Deps: status-enum dictionary, permission-matrix confirmation.*
- **Day 3 — Clients, orders, workflow, documents/evidence.** Client CRUD + duplicate review, multi-order per client, three-way agent/RTO selection, snapshots, status engine + tasks + history, checklist + signed-URL upload + review/versioning. *Deps: S3-compatible bucket, Day-2 masters.*
- **Day 4 — Finance, QuickBooks, dashboards, audit/search/migration.** Invoices, unlimited instalment plans, payments + allocation + refunds, async idempotent QB sync + retry UI, role dashboards + reports + saved views, audit log, Excel import + reconciliation scaffolding. *Deps: QuickBooks sandbox/credentials, source workbook `RTO & Onboarding Master Hub.xlsx`, QuickBooks export for reconciliation.*
- **Day 5 — Integration, security, responsive/theme testing, deployment, UAT/handover.** End-to-end chain test, RBAC/security review (no secrets in client/logs), responsive + theme-flash testing, deployment verification, UAT on migrated records, archive-freeze handover. *Deps: production DB/host access, stakeholder UAT availability.*

External requirements that can block Day 4–5: database access, S3 bucket, Redis (if BullMQ), QuickBooks credentials + API access, source workbook + Drive files, deployment credentials. Do not promise production integrations or full reconciliation without them.

---

## 13. Requirements traceability checklist

Status key: **Planned** (documented, no code) · **In Progress** · **Implemented** (evidence in repo) · **Verified** (tested/accepted). All rows are **Planned** as of 2026-10-09 — no implementation evidence exists in this folder.

### A. Platform & architecture

| # | Requirement (spec) | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| A1 | React+TS frontend; Node+Express+TS backend; MongoDB; JWT/session auth; S3-compat storage; BullMQ+Redis/equiv; Docker deploy | Platform | Hosting, DB, bucket, Redis decisions | Scaffold boots; health check; env-separated config | Planned |
| A2 | Central logs + error monitoring | Observability | Deploy target | API + QB failures traceable | Planned |
| A3 | Normalized model: 1 client→N orders; 1 order→1 client+1 qualification; 1 order→N payments/docs/history/invoices | Data model | Status-enum dictionary | Multi-order, multi-payment, route-change fixtures pass | Planned |

### B. Dashboard (§4A, §12)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| B1 | Active clients/orders; sales/collected/outstanding/collection %; costs/margin | Dashboard | Orders, Finance | KPI cards match ledger fixtures | Planned |
| B2 | Doc queues (waiting-client / waiting-review / rejected); RTO queues (awaiting/under-assessment/completed/on-hold); overdue; certificates issued/pending; agent performance | Dashboard | Documents, Workflow, Finance | Queues + saved views return correct subsets | Planned |

### C. Clients & orders (§4B–§4C, §22)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| C1 | Create client once; legal/preferred name, contacts, addresses, notes; timeline | Clients | Auth/RBAC | Duplicate-name attempt routes to review, not silent dup | Planned |
| C2 | One client → multiple simultaneous qualification orders; route change with history | Orders | Clients, Qualifications, Agents, RTOs | Create 2 orders under 1 client; change RTO; history shows before→after | Planned |
| C3 | Separate Sales agent / Source agent / issuing RTO (+code) per order | Orders | Agents, RTOs, supplier_routes | All three visible on order; single-field merge rejected | Planned |
| C4 | Client price + supplier cost → margin; price snapshots preserved | Orders/Finance | Pricing matrix | Matrix edit does not alter old order snapshot/margin | Planned |

### D. Masters (§4D–§4G)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| D1 | Agent directory with distinct types (sales / source / RTO contact) | Agents | Roles | Type-mismatched assignment blocked | Planned |
| D2 | Qualification catalogue (code/title/package/industry/status) + licensing refs | Qualifications | — | Superseded flag + licensing link render | Planned |
| D3 | RTO directory (legal/trading name, RTO code, CRICOS, regulator/status, contacts, links) + risk/compliance dates | RTOs | — | Invalid-code / inactive-provider warnings | Planned |
| D4 | Supplier matrix (qualification×source×RTO→wholesale cost + effective dates); history immutable | Pricing | Qualifications, Agents, RTOs | Old order keeps old cost after matrix update | Planned |

### E. Documents & workflow (§4H–§4I, §5, §9)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| E1 | Per-order checklist; upload/type/version/received/reviewer/rejection; signed-URL S3 path | Documents | Orders, Storage | Upload→review→new-version chain; raw key never exposed | Planned |
| E2 | Independent doc / evidence / RTO-submission / certificate / payment statuses (exact vocabularies in §6) | Workflow | Orders | Doc Approved while RTO still Pending — both shown | Planned |
| E3 | Status history (actor/timestamp/before→after) + auto tasks per stage | Workflow | Auth | Timeline lists every transition + task creation | Planned |

### F. Finance (§4J, §6)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| F1 | Invoice→plan→payments; unlimited instalments (Pending/Due/Paid/Part Paid/Overdue/Waived/Cancelled) | Finance | Orders | 6-instalment plan + split allocation works | Planned |
| F2 | Payment→balance/status auto-update; overdue detection; refunds/voids audited, no deletes | Finance | Invoices | Pay event updates paid/balance/status; overdue flagged | Planned |
| F3 | Allocation to invoice/order; methods bank/card/cash/other | Finance | Invoices | Split payment across invoices sums correctly | Planned |

### G. QuickBooks (§10)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| G1 | Async invoice/payment sync with idempotency keys + external IDs; no dupes on retry | QB layer | Queue, Finance | Retry storm creates exactly one QB invoice | Planned |
| G2 | Sync status (Not Synced/Pending/Synced/Failed) + lastSyncAt/syncError + authorised retry; import/webhook for QB-created records | QB layer | Auth | Failed sync visible; retry succeeds; QB-side invoice attaches to order | Planned |

### H. Reporting/search/client profile (§4K, §13, §19)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| H1 | Reports: revenue/agent/qualification/RTO, ageing, margin, stage funnel, doc rates, cert lead time | Reports | All ops modules | Report totals tie to fixtures | Planned |
| H2 | Global search + order/doc/payment filters + saved queues | Search/Views | All modules | Each saved view returns expected fixture set | Planned |
| H3 | Client workspace tabs (Orders/Documents/Payments/Invoices/Timeline/Notes/Audit) + financial strip | Clients | All modules | Single profile answers “what is owed, what is missing, what is next” | Planned |

### I. Migration (§16–§17)

| # | Requirement | Module | Dependencies | Acceptance test | Status |
|---|---|---|---|---|---|
| I1 | Ordered import (RTOs→pricing→clients/orders→finance→licensing) + dedupe + archive-freeze + QB reconciliation | Migration | Workbook, QB export, Drive files | Imported totals reconcile to workbook + QB; dup report clean | Planned |

### J. Acceptance & build order (§22–§23)

All 15 acceptance criteria (C1–C3, F1–F3, E1–E3, G1–G2, H1–H2, permissions, auditability, reconciliation) map to rows above; build order A→I then UAT → reconcile → deploy → archive. Status: **Planned**.

---

## 14. Ambiguities and external-dependent blockers

1. No git repository/branch exists in this folder — expected `rony-dev` could not be confirmed; no Phase 1/1.1 code to review.
2. Workbook `RTO & Onboarding Master Hub.xlsx` and QuickBooks export referenced by the spec were not present in this folder — migration and reconciliation cannot be verified without them.
3. Exact RBAC permission matrix, commission rules, completion-criteria per qualification, and document-type catalogue need business confirmation.
4. Stack details (Vite vs other bundler, Mongoose confirmation, session vs JWT rotation, S3 provider, BullMQ vs equivalent, Docker target, log vendor) are recommendations until scaffolding pins them.
5. DOCX images (`image1–4.png`) and custom XML were not extracted as requirements — assumed illustrative; flag if any contains normative workflow.

---

## 15. Backend roadmap (Phase B1–B6) — planned, not started

Full detail: `BACKEND-PLAN.md`. Front-end shell (Day 1–5) is complete with a
preview in-memory store (57 REST-shaped functions); these phases replace it
with Node + Express + TypeScript + MongoDB/Mongoose. Estimate ≈ 22–30 working
days (not 5 days). Proposed defaults pending confirmation: JWT access +
rotating httpOnly refresh (D1), same-repo `server/` (D2), local Docker Mongo
(D3), MinIO dev storage (D4).

| Phase | Work | Days | Key dependencies | Done when |
|---|---|---|---|---|
| **B1** Server foundation | Express+TS app, zod env, Mongo/Redis connect, error/log middleware, docker-compose (mongo/redis/minio), Vitest+Supertest harness | 3–4 | D2/D3 decisions, Docker | `GET /health` green; compose gives mongo+redis+minio |
| **B2** Auth + RBAC | User/Role models, argon2id, access+refresh rotation, revoke/logout, rate-limit, `requirePermission` everywhere, audit middleware, real frontend login | 3–4 | D1–D3 locked | Wrong password rejected; Sales gets 403 on `/users` |
| **B3** Masters + Clients/Orders | 17 collections (incl. new `certificates`), dedupe report, immutable snapshots, transactional transitions + history + tasks, stores → API calls | 4–5 | Mongo access | Multi-order + snapshot + history in one transaction |
| **B4** Documents + storage | S3 adapter, 15-min signed URLs, checklist templates, version-supersede, review, access logging | 3–4 | D4 locked, bucket creds | Raw storage key never reaches client |
| **B5** Finance + QuickBooks | Invoices/plans/payments server-side, allocation + overdue calc, BullMQ idempotent QB sync + webhook + retry | 4–5 | QB sandbox creds, Redis | Retry creates exactly one QB record |
| **B6** Reports + Audit + Migration + Deploy | Aggregation pipelines, audit indexes, Excel import + reconciliation, Docker prod image, staging deploy, UAT | 5–7 | Workbook, QB export, hosting | DB totals reconcile workbook vs QB |

External blockers: MongoDB Atlas URL/db/IP-allowlist (offered, pending) · storage choice+creds ·
Redis · QuickBooks creds · source workbook · hosting target. Frontend cutover needs
no page rewrites (`api.ts` adapter, same store signatures, delete `src/mocks/*`).
