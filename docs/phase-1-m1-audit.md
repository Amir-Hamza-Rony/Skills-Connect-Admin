# Phase 1 — M1 Student & Enrollment Architecture Audit

**Project:** Skills Connect Admin
**Branch:** `rony-dev`
**HEAD at audit time:** `295db43 docs: organize phase documentation and remove obsolete files`
**Audit date:** 2026-11-17
**Milestone:** Pre-implementation audit for Phase 1 / M1 (Student & Enrollment Management)
**Method:** Static, read-only source and documentation inspection. **No database connection was opened; no MongoDB record was read or written; no source file, dependency, index, seed, migration, or git state was changed.**

---

## 0. Audit summary

| # | Finding | Severity |
|---|---|---|
| S1 | The system has **one** people collection (`clients`) and **one** transaction collection (`orders`). There is no `students` collection, no `enrollments` collection, no `Student`/`Enrollment` type, and no code-generation logic. All M1 work is an **evolution** of these two entities, not a replacement. | Info |
| S2 | M0 security fixes are present and intact (`checkOrderAccess`, `getAccessibleClientIds`, `checkClientAccess`, `maskFinancialFields`, ownership checks in all order/client/document routes). | Info |
| S3 | **Resolved by approved decision D7 (2026-11-17):** the code defines **21** `OrderStatus` values and **21** `ALLOWED_TRANSITIONS` keys. All 21 and their transitions are preserved exactly; the two extra statuses from the earlier "23-status" requirement are deferred until management confirms their names and transition rules. No status changes in M1. | Resolved |
| S4 | **Resolved 2026-11-17 by documentation-only reconciliation:** `docs/project-reassessment/06-IMPLEMENTATION-ROADMAP.md` now carries a SUPERSEDED banner, an approved D1–D7 source-of-truth section, an explicit list of the six Phase 1 constraints, a pending B3–B15 table, and a historical-reference marker on its Phase 1 section. The original roadmap text is preserved verbatim. The stale 8-status/collection-replacement/profit-calculation instructions can no longer be mistaken for current guidance. | Resolved |
| S5 | Enrollment code format is approved as `SC-YYYY-NNNN` (D2), but the only written examples are `SC-2026-1042` (stale roadmap) and `RPL-2026-1001` (reference architecture). Neither is authoritative over D2. | Info |
| S6 | `channel_type`, `bdc_id`, `b2b_agent_id` are **already written** to new orders by `POST /api/orders` (lines 310–317) but are absent from the `Order` type and inconsistently returned by the API. This is the only partially-implemented M1 field group. | Medium |
| S7 | No unique index exists for `clients.email`; dedupe is exact-lowercase application logic only. No unique index exists for any enrollment-code equivalent (none exists yet). | Medium |
| S8 | Several **pre-existing frontend/backend contract mismatches** will block any UI work unless fixed: `getClient`/`getOrder` envelope mismatch, `uploadDocument` missing `clientId`, `reviewDocument` sending `verdict` instead of `status`, and mutation helpers expecting an `{order}` envelope the routes do not return. | High |
| S9 | Financial masking is incomplete and inconsistent: `GET /api/orders/[id]` always returns a derived `grossMargin` to BDC/B2B_AGENT; order list/detail expose `sellingPrice` to all roles despite Phase 0 docs claiming it is hidden from B2B_AGENT; and `maskFinancialFields` does **not** descend into array results, so per-row `supplierCost`/`margin` leak in four report endpoints (`orders`, `margin`, `supplier-costs`, `monthly-summary`). | High |
| S10 | `GET /api/clients/duplicates` is the only client route with **no ownership scoping** and returns cross-client duplicate metadata to any `clients.view` holder. | High |
| S11 | Client create/update perform no audit writes; the profile "Audit" tab renders `order.history`, not `audit_logs`. | Low |
| S12 | Test baseline is healthy: 23 M0 security tests, 119 total tests. Test DB is `mongodb-memory-server` (`skills_connect_admin_test`); production DB is never touched by tests. | Info |
| S13 | `GET /api/orders/[id]/timeline` projects only `history` before calling `checkOrderAccess`, so BDC/B2B_AGENT are **denied access to their own order timelines**. `GET /api/orders/[id]/payment-plan` skips the ownership check entirely when no plan exists. | High |
| S14 | No `paymentStatus` is ever written at order creation despite `Order.paymentStatus` being declared; no `notes` field exists on `Order` although `PATCH /api/orders/[id]` accepts it; the order status `<select>` offers all 21 statuses instead of legal transitions. | Medium |

**Recommendation:** S3 is closed by the approved Order Status Decision (D7) — no status work is required in M1. S4 is closed by the documentation-only roadmap reconciliation (SUPERSEDED banner + D1–D7 source-of-truth + pending B3–B15); **no documentation blocker remains before M1 implementation**. The open business decisions B3–B15 are still pending and must not be guessed. S8/S9/S10/S13 should be folded into the M1 API/UI work because new fields and relabeling touch the same code paths; S9's report-level leaks and S13's timeline denial are exploitable today and should be treated as high-priority fixes.

---

## 1. Scope and constraints of this audit

### 1.1 In scope
- Client model, CRUD routes, duplicate detection, and all UI surfaces that read/write clients.
- Order model, CRUD routes, status workflow, all subroutes, and order UI surfaces.
- Indexes, scripts, relationships, and stored-data assumptions visible in source.
- RBAC (`permissions.ts`, `types.ts`), M0 ownership/masking helpers (`middleware/auth.ts`).
- Status workflow and any enrollment-code / SKU-like generation logic.
- Tests, fixtures, and helpers relevant to M1 regressions.
- Integration gaps between the frontend data layer (`ops-store.ts`) and API routes.

### 1.2 Out of scope (not performed)
- Running tests, builds, or linters (already verified for M0 in the prior milestone; re-run after M1 implementation).
- Connecting to or querying any MongoDB instance, including the test DB.
- Creating indexes, running migrations/seeds/backfills, or modifying any record.
- Implementing any M1.2+ code. This document is the plan only.

### 1.3 Approved decisions applied throughout
| ID | Decision | How it constrains this audit |
|---|---|---|
| D1 | Evolve `clients` and `orders`; do **not** create `students` / `enrollments` collections. | All "missing Student fields" are additions to `Client`/`clients`; all "missing Enrollment fields" are additions to `Order`/`orders`. |
| D2 | Enrollment code format `SC-YYYY-NNNN`; generation is M1 work. | Code-generation design belongs in M1, not M0. |
| D3 | Preserve existing order statuses and `ALLOWED_TRANSITIONS`; do **not** replace with 8 statuses. | Any doc/config saying otherwise is stale. |
| D4 | Defer per-enrollment `gross_profit` / `net_profit`; do not invent commission allocation. | Do not add these fields to `Order` now; do not copy the reference-architecture profit logic. |
| D5 | Never auto-assign owners; ownerless legacy records remain admin-only. | M0 fail-closed behavior is retained verbatim. |
| D6 | Keep `/api/clients` and `/api/orders`; frontend relabeling is separate/later. | Endpoints and route file paths do not change in M1. |
| D7 (**approved 2026-11-17 — Order Status Decision**) | Preserve all **21** currently implemented `OrderStatus` values and their existing `ALLOWED_TRANSITIONS` **exactly as they are**. Do not invent, add, rename, remove, or replace any status. The two extra statuses from the earlier "23-status" requirement are **deferred** until management confirms their names and business transition rules. Future additions require **explicit business approval**. | The 21/23 discrepancy is **closed for M1**: no status or transition changes in M1; the status workflow is treated as frozen. Supersedes the earlier reading of D3 that implied a 23-status target. |

---

## 2. Implementation status

### 2.1 Milestone state
- **M0 (security hardening):** complete, verified, and committed as `982c682 feat: complete phase 1 M0 security hardening`. 23 M0 tests pass; full suite 119 pass; typecheck/lint/build green.
- **Docs reorg:** committed as `295db43`; HEAD at audit time.
- **M1 (Student & Enrollment Management):** **not started.** No M1-specific types, fields, routes, tests, indexes, or UI exist.
- **Working tree:** only ` M tsconfig.tsbuildinfo` and `?? tsc-errors.txt` (pre-existing, untouched).

### 2.2 Area-by-area status

| Area | Current state | M1 relevance |
|---|---|---|
| Client type | `Client` at `src/lib/types.ts:255-267`; 10 required fields, no `updatedAt`, no status enum. | Extend, do not replace. |
| Client CRUD | `GET/POST /api/clients`, `GET/PATCH /api/clients/[id]`, `GET /api/clients/duplicates`. No DELETE. | Extend whitelists, validation, audit, scoping. |
| Client UI | `src/views/clients.tsx` (list/create), `src/views/client-profile.tsx` (tabs), `src/components/global-search.tsx`. | Add student fields; fix contract mismatches. |
| Order type | `Order` at `src/lib/types.ts:277-329`; 31 fields, strong enums for sub-statuses. | Extend with enrollment fields. |
| Order CRUD | `GET/POST /api/orders`, `GET/PATCH /api/orders/[id]`, plus 8 subroutes. | Extend creation/patch/read; add code generation. |
| Status workflow | 21-value union + 21-key `ALLOWED_TRANSITIONS` + 6 groups. | Frozen per approved D7 — preserve exactly; no changes in M1. |
| Enrollment code | **Absent.** No field, generator, sequence, index, or example in `src`. | New in M1 (D2). |
| Channel/owner fields | Partially present at DB write time only (`orders` insert lines 310–317). | Promote to type + API + UI. |
| Indexes | Two idempotent, index-only scripts; no `clients` or enrollment-code index. | New migration script in M1. |
| M0 helpers | `src/middleware/auth.ts:138-250` — all five helpers present and used. | Preserve; extend masking for new PII. |
| Tests | 119 `*.test.ts`; 23 M0 security tests with reusable ownership fixtures. | Extend for new fields/code/scoping. |

---

## 3. Client field inventory (current)

### 3.1 Type definition — `src/lib/types.ts:255-267`

| Field | Type | Optional? | Notes |
|---|---|---|---|
| `id` | `string` | no | API-facing string id; DB uses `_id: ObjectId`. |
| `legalName` | `string` | no | Dedupe/search anchor. |
| `preferredName` | `string` | no | |
| `email` | `string` | no | Primary email and dedupe key. |
| `contacts` | `ClientContact[]` | no | `{label, type: phone\|email\|whatsapp, value, primary}` (`:237-242`). |
| `addresses` | `ClientAddress[]` | no | `{label, street, city, state, postalCode, country, primary}` (`:245-253`). |
| `status` | `string` | no | Plain string; no enum/union. Values in code: `"Prospect"` (API default), `"Active"` (UI), `"active"` (test seeds). |
| `sourceAgentId` | `string \| null` | no | Sales/closing agent in `agents` collection (agent-id space, **not** a user id). |
| `notes` | `string` | no | |
| `createdAt` | `string` | no | API serializes DB `Date`. |

**Not in the type:** `phone` (used everywhere in API/UI), `updatedAt` (written to DB by both POST and PATCH), `status` enum, any student-specific field.

### 3.2 Fields actually stored in `clients` documents

Based on `POST /api/clients` (`:60-72`) and `PATCH /api/clients/[id]` (`:41-45`):

`_id`, `legalName`, `preferredName`, `email` (lowercased on POST only), `phone`, `contacts: []` (hardcoded), `addresses: []` (hardcoded), `status` (default `"Prospect"`), `sourceAgentId`, `notes`, `createdAt: Date`, `updatedAt: Date`.

M0 test fixtures (`tests/helpers.ts:88-103`, `tests/m0-security.test.ts:30-48`) additionally write `phone`, `contacts`, `addresses`, `status: "active"`, with no `updatedAt`.

### 3.3 Fields returned by each client endpoint

| Endpoint | Response fields | Notes |
|---|---|---|
| `GET /api/clients` (`:32-44`) | `id`, `legalName`, `preferredName`, `email`, `phone`, `status`, `sourceAgentId`, `notes`, `createdAt` | `contacts`/`addresses` omitted; `phone` included though untyped. Only `search` param; no pagination/filters. |
| `POST /api/clients` (`:74-76`) | `{ client: { id, legalName, preferredName, email } }` | Partial object; no `phone`/`status`/timestamps. |
| `GET /api/clients/[id]` (`:23`) | **Flat** object: `id`, `legalName`, `email`, `phone`, `status` | No `{client}` envelope; no `preferredName`/`contacts`/`addresses`/`notes`/`sourceAgentId`/`createdAt`. |
| `PATCH /api/clients/[id]` (`:46`) | `{ ok: true }` | No record returned. |
| `GET /api/clients/duplicates` (`:82`) | `{ certain: [...], possible: [...] }`, each group `{key, reason, clients: [{id, legalName, email, phone: "", createdAt}]}` | `phone` hardcoded `""`; no ownership scoping. |

### 3.4 UI fields

- **Create form** (`src/views/clients.tsx:163-221`): Legal name, Preferred name, Phone, Email, Address (single string), Sales/closing agent, Notes. Sends `contacts` and `addresses` arrays (discarded by API) and `status: "Active"`. Add button is not gated by `clients.manage`.
- **List columns** (`:121-161`): Client (name + primary phone or email), Email, Sales agent, Status.
- **Profile tabs** (`src/views/client-profile.tsx:52-62,198-216`): Orders, Contacts, Communications, Documents, Payments, Invoices, Timeline, Notes, Audit. No edit form; no PATCH caller.
- **Global search** (`src/components/global-search.tsx:57-65,98-105`): client-side over `legalName`, `preferredName`, `primaryPhone`, `email`; min 2 chars, max 12 hits.

---

## 4. Order field inventory (current)

### 4.1 Type definition — `src/lib/types.ts:277-329`

`id`, `clientId`, `qualificationId`, `salesAgentId`, `sourceAgentId`, `rtoId`, `status: OrderStatus`, `evidenceStatus`, `rtoSubmissionStatus`, `certificateStatus`, `sellingPrice`, `supplierCostSnapshot`, `otherCost`, `currency`, `rtoContactId`, `rtoContactName`, `licensingAuthority`, `licenceReference`, `licenceExpiry`, `certificateDeliveryMethod`, `certificateDeliveryDate`, `certificateTrackingNumber`, `priceCategoryId`, `priceListId`, `supplierRouteId`, `exchangeRate`, `convertedAmount`, `additionalFees[]`, `feeTotal`, `paymentStatus: PaymentStatus`, `createdAt`, `updatedAt`, `completedAt`, `history: StatusChange[]`.

All required in the type; many are `null` at runtime.

### 4.2 Fields written at order creation — `POST /api/orders:282-309`

All of the above core fields are populated server-side, plus:
- `status: "New"`, `evidenceStatus: "Not Started"`, `rtoSubmissionStatus: "Not Ready"`, `certificateStatus: "Not Issued"`.
- `supplierCostSnapshot` resolved from the active supplier route (never client-supplied).
- `sellingPrice` resolved from an active price list when one applies; client value is fallback.
- `exchangeRate` placeholder `1` for non-AUD (`:240-246`).
- `additionalFees`/`feeTotal` snapshotted from `additional_fees`.
- `history` seeded with one `"New"` entry.
- **M1-adjacent user-space fields (`:310-317`):** `bdc_id` or `b2b_agent_id` (set from `actor.userId`), and `channel_type` (`"B2C_BDC"` or `"B2B_AGENT"`). For admin/super-admin creators neither is set. **These are written but untyped and not returned by the detail endpoint.**

Side effects: `document_requirements` seeded with 6 items (`:342-345`); `certificates` row with `status: "Not Issued"` (`:347-348`); `writeAudit` (`:322-340`).

### 4.3 Fields returned by order endpoints

| Endpoint | Response | Notes |
|---|---|---|
| `GET /api/orders` (`:52-82`) | `id`, `clientId`, `qualificationId`, `salesAgentId`, `sourceAgentId`, `rtoId`, `status`, `sellingPrice`, `otherCost`, `currency`, `priceCategoryId`, `priceListId`, `supplierRouteId`, `feeTotal`, `certificateStatus`, `createdAt`, `bdc_id`, `b2b_agent_id`; `supplierCostSnapshot` **admin only** | Filters: `status`, `clientId`; role filter on `bdc_id`/`b2b_agent_id`. No pagination. |
| `GET /api/orders/[id]` (`:41-66`) | Core ids/statuses, `sellingPrice`, `otherCost`, **`grossMargin` (all roles)**, `currency`, `history`, `createdAt`, `bdc_id`, `b2b_agent_id`; `supplierCostSnapshot` **admin only** | Flat object, no `{order}` envelope. `grossMargin` derived from masked cost — see S9. |
| `PATCH /api/orders/[id]` (`:144-164`) | `{ order: {...} }` with a limited projection, passed through `maskFinancialFields` | Whitelisted updatable fields: `rtoContactId`, `rtoContactName`, `notes` only (`:10-14`). |
| `PATCH /api/orders/[id]/status` (`:118`) | `{ ok, before, after }` | No order returned. |
| `PATCH /api/orders/[id]/dimensions` (`:76`) | `{ ok: true }` | Updates evidence/RTO/certificate/licensing/delivery fields (`:14-24,39-49`). |
| `GET /api/orders/[id]/documents`, `/checklist`, `/certificate`, `/timeline`, `/payment-plan` | Subresource payloads | Most call `checkOrderAccess`; `/timeline` is broken for non-admin owners (S13) and `/payment-plan` skips the check when no plan exists (S13). |

**Order-creation gaps relevant to M1:** `paymentStatus` is declared on `Order` (`types.ts:324`) but never written by `POST /api/orders`; `notes` is accepted by `PATCH /api/orders/[id]` (`:13`) although no `notes` field exists on the `Order` type; and `sellingPrice`/`otherCost` are only checked for presence, not for finite/non-negative numeric values, so `NaN` can be persisted. The initial history entry (`:306`) also omits `actorId` despite `StatusChange` declaring it required.

Report endpoints that read raw order cost data: `src/app/api/reports/orders/route.ts:99-131`, `src/app/api/reports/margin/route.ts:31-40`, `src/app/api/reports/supplier-costs/route.ts:89-108`, `src/app/api/reports/monthly-summary/route.ts:56,113`. In each case `maskFinancialFields` is applied to the result envelope but does not descend into the result arrays, leaving per-row `supplierCost`/`margin` visible to BDC/B2B_AGENT (see §11.3).

### 4.4 Status workflow

- `OrderStatus` union: `src/lib/types.ts:151-172` — **21 values**.
- `ORDER_STATUS_GROUPS`: `types.ts:174-193` — 6 groups (Sales, Onboarding, Submission, Assessment, Completion, Exception).
- `ALLOWED_TRANSITIONS`: `src/app/api/orders/[id]/status/route.ts:12-49` — **21 keys**, with `On Hold` as a hub back to 14 states (all except `Completed`/`Refunded`).
- Terminal states: `Lost`, `Completed`, `Cancelled`, `Refunded`.
- Transition audit: `writeAudit({action: "status_transition"})` (`:108-116`); history entry pushed with actor id (`:101-106`).

**Approved decision D7 (2026-11-17) — Order Status Decision (supersedes the earlier 23-status reading of D3):** All **21** currently implemented `OrderStatus` values and their existing `ALLOWED_TRANSITIONS` are preserved **exactly as they are**. Do not invent, add, rename, remove, or replace any status. The two additional statuses mentioned in the earlier 23-status requirement are **deferred** until management confirms their names and business transition rules; future additions require explicit business approval. The status workflow is therefore frozen for M1 — no status or transition code changes.

---

## 5. Missing Student fields (add to `Client` / `clients`)

Reference: `docs/reference/rpl_management_system_database_architecture_design.md:229-245` (§4.5 `students`); stale `06-IMPLEMENTATION-ROADMAP.md:70`.

| Reference field | Current equivalent / state | Required M1 change | Notes |
|---|---|---|---|
| `first_name`, `last_name` | `legalName` (full legal name) + `preferredName` exist; no split first/last | Decide mapping. Recommended: keep `legalName` canonical and add optional `firstName`/`lastName` if the business requires split capture; do not rename existing fields (D1). | Needs a decision; do not silently split existing data. |
| `email` | `email` exists | Keep. Add email-format validation and DB uniqueness (see §10). | Lowercase on both POST and PATCH; dedupe currently POST-only. |
| `phone` | Written/read by API+UI but **absent from `Client` type** | Add `phone: string` to `Client`; keep `contacts` array as the richer model. | Fixes split-brain; restores phone search/list rendering. |
| `dob` | Absent | Add optional `dob: string \| null` (ISO date). | PII; validate format. |
| `usi_number` | Absent | Add optional `usiNumber: string \| null`. | **Sensitive PII** — restrict visibility and add sparse unique index. |
| `address` | `addresses: ClientAddress[]` exists (richer) | No new field needed; fix POST to persist the addresses the UI already sends. | Avoid duplicating address representations. |
| `referred_by_student_id` | Absent | Add optional `referredByStudentId: string \| null` (self-reference within `clients`, stored as ObjectId string). | Validate the referenced client exists. |
| `external_referrer_name` | Absent | Add optional `externalReferrerName: string \| null`. | Mutual exclusivity with `referredByStudentId` is a business rule to confirm. |
| `visa_status` | Absent (roadmap lists it; reference §4.5 does not) | Add optional `visaStatus: string \| null` with a documented enum. | Only in stale roadmap — confirm desired values. |
| `created_at` | `createdAt` exists | Keep. | |

Also required for a usable Student entity (derived from audit findings, not the reference doc):
- Add `updatedAt: string` to the `Client` type (DB already writes it).
- Add a `ClientStatus` union or documented value list (current values are inconsistent).
- Wire `writeAudit` into `POST`/`PATCH /api/clients`.
- Persist `contacts`/`addresses` from the create request.
- Add a duplicate check to `PATCH` (currently only POST dedupes).
- Scope `GET /api/clients/duplicates` like every other client route.

---

## 6. Missing Enrollment fields / functionality (add to `Order` / `orders`)

| Reference field | Current equivalent / state | Required M1 change | Notes |
|---|---|---|---|
| `enrollment_code` | Absent | Add `enrollmentCode: string \| null` to `Order`; generate on creation using `SC-YYYY-NNNN` (D2); unique sparse index. | See §8. |
| `channel_type` | Written at `orders/route.ts:313,316`; absent from type; not returned by detail | Add `channelType: "B2C_BDC" \| "B2B_AGENT" \| null` to `Order`; include in list/detail responses. | Decide DB key name: existing code writes snake_case `channel_type`. Keep the DB key for backward compatibility and expose a typed field; do not silently rename stored data. |
| `bdc_id` | Written at `:312`; absent from type; returned by list/detail as `bdc_id` | Add typed `bdc_id: string \| null` to `Order` (user-id space). | Preserve key name; ownership logic depends on it. |
| `b2b_agent_id` | Written at `:315`; absent from type; returned by list/detail | Add typed `b2b_agent_id: string \| null`. | Same as above. |
| `student_id` | `clientId` already references `clients._id` | No change; document that `clients` *is* the Student store (D1). | Do not introduce a second reference. |
| `qualification_id`, `rpl_partner_id` | `qualificationId`, `rtoId` exist | No change; RTO is the RPL partner in this system. | |
| `status` | 21-value workflow exists | **Preserve exactly** (D7). Do not import the 8 boss statuses or the deferred 2. | No status changes in M1. |
| `offered_price`, `partner_cost_snapshot` | `sellingPrice`, `supplierCostSnapshot` exist | No rename; document mapping. | Server-side snapshot logic already correct. |
| `gross_profit`, `net_profit` | Absent | **Defer** (D4). Do not add. | `maskFinancialFields` already lists them defensively. |
| `payment_status` | 6-value `PaymentStatus` union exists (`types.ts:226-232`); computed from invoices/payments | **Open decision:** stale roadmap wants 4 values (`UNPAID/PARTIAL/PAID/REFUNDED`), but no approved decision covers this. Recommend preserving the 6-value union. | Listed as blocker/open question. |
| `submitted_to_partner_at` | Absent; approximated by status history (`"Submitted to Source Agent"` / `"Submitted to RTO"`) | Add optional timestamp if required; can be derived from history instead. | Prefer derivation to avoid duplicated truth. |
| `certificate_issued_at` | `certificateStatus` + `certificates.issuedAt` exist | No new field; surface existing certificate record. | |
| follow-up fields (owner assignment timestamps, etc.) | Not specified in approved decisions | Do not invent; capture requirements first. | |

### 6.1 Missing M1 functionality (independent of field additions)
1. **Enrollment code generation** with uniqueness and concurrency safety (§8).
2. **Typed owner/channel fields** on `Order` and consistent API serialization.
3. **Structured client list filters/pagination** for the Student list (currently `search` only).
4. **Client create/update audit trail** (none today).
5. **Contract repairs** listed in §9.2 — required before any UI can reliably use new fields.
6. **Duplicate detection** that works: currently `POST` discards `contacts`, and the duplicates route reads only `contacts` for phones and hardcodes `phone: ""`, so phone-based duplicate detection can never see phone values created through the UI.

---

## 7. Backward-compatible schema changes (M1 proposal)

All changes are **additive and optional/nullable**. No collection is renamed or dropped; no existing field is repurposed; no status vocabulary is replaced.

### 7.1 `clients`
```ts
// additive fields on Client (all optional / null-defaulted at the DB layer)
phone?: string                    // already written today; promote to the type
dob?: string | null
usiNumber?: string | null
visaStatus?: string | null
referredByStudentId?: string | null   // ObjectId string → clients._id
externalReferrerName?: string | null
updatedAt?: string                // DB already writes it
```
- Legacy documents lacking these fields remain valid; readers must treat missing as `null`/`""`.
- `status` gains a documented value list but remains a `string` (no breaking enum).
- Existing `legalName`/`preferredName`/`email`/`contacts`/`addresses` semantics unchanged.

### 7.2 `orders`
```ts
// additive fields on Order
enrollmentCode?: string | null     // SC-YYYY-NNNN; unique sparse index
channelType?: "B2C_BDC" | "B2B_AGENT" | null   // DB key stays channel_type
bdc_id?: string | null             // user-id space; already written
b2b_agent_id?: string | null       // user-id space; already written
```
- Existing 21 statuses and `ALLOWED_TRANSITIONS` unchanged (D3).
- No `gross_profit`/`net_profit` (D4).
- No owner auto-assignment (D5): creation by admin/super-admin still produces an ownerless order; M0 helpers continue to fail closed for non-admins.
- No new collection (D1); no new API namespace (D6).

### 7.3 Migration approach
- A **new** idempotent, index-only migration script (e.g. `scripts/migrate-phase-1-m1.mjs`) following the existing pattern in `scripts/migrate-master-data.mjs` / `scripts/migrate-phase-5.mjs`: named `createIndex` calls only, no data writes, `.env` load, explicit `MONGODB_URI` guard, connection closed in `finally`.
- No backfill in the audit. Any enrollment-code backfill for legacy orders is a **separate, explicitly authorized migration** (see §8.4).

---

## 8. Enrollment code strategy (`SC-YYYY-NNNN`)

### 8.1 Requirements
- Format decision D2: `SC-YYYY-NNNN` (e.g. `SC-2026-0001`). The four-digit sequence is zero-padded; width must accommodate at least 9999 codes/year (or define rollover behavior).
- Unique, human-readable, generated server-side, never client-supplied.
- Must be concurrency-safe under simultaneous order creation.
- Legacy orders may have no code (nullable field, sparse unique index).

### 8.2 Recommended design: atomic per-year counter + unique index
1. **Counter collection** `enrollment_sequences` with one document per year:
   ```js
   { _id: "SC-2026", seq: 0, updatedAt: Date }
   ```
2. **Atomic increment** inside `POST /api/orders`, using `findOneAndUpdate` with `upsert: true`, `returnDocument: "after"`, and `$inc: { seq: 1 }`. MongoDB applies `$inc` atomically on a single document, so concurrent creators cannot receive the same number. Upsert handles the first order of a new year.
3. **Format** the code from the returned `seq`: `` `SC-${year}-${String(seq).padStart(4, "0")}` ``.
4. **Unique sparse index** on `orders.enrollmentCode` (`{ enrollmentCode: 1 }, { unique: true, sparse: true, name: "uniq_orders_enrollment_code" }`) as the final integrity guard. Sparse allows legacy orders with no code to coexist.
5. **Retry on duplicate key (`E11000`):** if the unique index ever rejects a code (e.g. a manually inserted collision), retry the increment a bounded number of times, then fail the request with a clear 500. Never silently reuse a code.
6. **Transaction consideration:** if the counter increment and order insert must be atomic, use the cached client from `getClient()` (`src/lib/db.ts:25-28`) and a MongoDB session. The test replica set (`tests/setup.ts:40-46`) already supports transactions. If a transaction is not used, the unique index plus retry still prevents duplicates; the only cost is a possible gap in the sequence.

### 8.3 Alternatives considered and rejected
| Alternative | Why rejected |
|---|---|
| `count()` of orders in the current year + 1 | Race condition: two concurrent creates can compute the same number. Deletes/gaps also break counting. |
| Random suffix code | Non-deterministic, harder to read/reconcile; still needs a unique index. |
| Client-supplied code | Violates server-side integrity; clients could collide or predict others' codes. |
| Reusing the reference doc's `RPL-2026-1001` pattern | Conflicts with approved D2. |

**Adjacent precedent:** the only generated identifier in executable code is `invoiceNumber`, built as `` `INV-${orderOid.toString().slice(-8)}-${Date.now()}` `` at `src/app/api/invoices/route.ts:141`. It is timestamp-based, not a counter, and must **not** be copied for enrollment codes — it provides no monotonic guarantee and no uniqueness check. A `counters` collection for `INV-YYYY-NNNN` is described only in historical docs (`docs/historical/BACKEND-PLAN.md:538-539`); no such collection exists in code.

### 8.4 Legacy orders / backfill
- Do **not** backfill in this audit or automatically during M1 creation.
- Options to present for decision: (a) leave legacy orders with `enrollmentCode: null` and expose an admin-only "assign code" action; (b) a one-off, explicitly authorized migration that walks ownerless/legacy orders and assigns codes in a deterministic order. Option (a) is safer and aligns with D5 (ownerless records remain admin-only).
- Until decided, the unique sparse index must tolerate `null`/missing codes.

### 8.5 Documentation conflict
`docs/reference/rpl_management_system_database_architecture_design.md:254` uses `RPL-2026-1001`; `06-IMPLEMENTATION-ROADMAP.md:80` uses `SC-2026-1042`. D2 (`SC-YYYY-NNNN`) governs. Note that the roadmap's `1042` example implies a starting sequence of 1042, while D2 does not specify a start value — confirm whether the sequence starts at `0001` or another value.

---

## 9. API and UI changes

### 9.1 Endpoints to change (paths unchanged per D6)

| Endpoint | Changes |
|---|---|
| `POST /api/clients` | Extend body whitelist with new student fields; validate email/date/USI/referral; persist `contacts`/`addresses` instead of hardcoding `[]`; lowercase email; return a complete `Client` (or consistently document the partial response); add `writeAudit`. |
| `PATCH /api/clients/[id]` | Extend whitelist; add email-format check + duplicate check + lowercasing; add `writeAudit`; return the updated record. |
| `GET /api/clients` | Add structured filters (`status`, `sourceAgentId`, referral) and pagination; consider pushing ownership scoping into the DB query rather than loading all clients. |
| `GET /api/clients/[id]` | Return the same shape as `GET /api/clients` (flat is acceptable, but the data layer must match it). |
| `GET /api/clients/duplicates` | Apply `getAccessibleClientIds`/`checkClientAccess`; use the real `phone` field; remove hardcoded `""`; remove unused `requirePermission` import. |
| `POST /api/orders` | Add `enrollmentCode` generation (§8); return the created order id **and** the generated code; write the typed owner/channel fields as today; audit the new fields. |
| `GET /api/orders`, `GET /api/orders/[id]` | Serialize `enrollmentCode`, canonical `channelType`, `bdc_id`, `b2b_agent_id` consistently; keep envelope shape stable and align `ops-store.ts`. |
| `PATCH /api/orders/[id]` | Keep the strict non-financial whitelist; do **not** allow enrollment code or owner fields to be patched through this route. |
| `PATCH /api/orders/[id]/status` | No vocabulary change (D3); keep `ALLOWED_TRANSITIONS` as the single source of truth. |

### 9.2 Required contract repairs (pre-existing blockers)

| Frontend (`src/lib/ops-store.ts`) | Backend | Fix |
|---|---|---|
| `getClient` reads `data.client` (`:36-37`) | `GET /api/clients/[id]` returns a flat object (`:23`) | Read the flat object, or wrap the response server-side. Pick one and align both. |
| `getOrder` reads `data.order` (`:61-62`) | `GET /api/orders/[id]` returns flat `item` (`:66`) | Same. |
| `uploadDocument` appends only `file`, `orderId`, `type` (`:160-164`) | Upload route requires additional `clientId` (`:24,28`) and cross-checks it (`:49-51`) | Pass `clientId` from the order context; return `{ document }` to match the declared type, or fix the caller. |
| `reviewDocument` sends `{ verdict, reason }` (`:192`) | Review route requires `{ status, reason }` (`:15-18`) | Send `status`; align return shape (`{ok:true}` vs `OrderDocument`). |
| `transitionOrder`, `updateOrderDimensions` expect `{order}` (`:95,104`) | Routes return `{ok,...}` / `{ok:true}` | Fix helper return types and view state updates. |
| `createClient` sends `contacts`/`addresses` and expects full `Client` (`:43-49`) | API discards them and returns a partial object | Persist them and return a complete object. |
| `grossMargin(o)` computes with `supplierCostSnapshot` (`:108-109`) | Field is omitted for BDC/B2B_AGENT | Return `NaN`/hide the derived value for those roles, or compute only from fields present. |

### 9.3 UI changes (M1, relabeling kept separate per D6)
- `src/views/clients.tsx`: add DOB, USI, visa status, referral fields to the create form; surface validation errors (current `onCreate` has no `catch`); gate the Add button with `clients.manage`.
- `src/views/client-profile.tsx`: render new student fields in a suitable tab; ensure USI visibility follows the RBAC decision; fix the "Audit" tab to read real audit logs or relabel it.
- `src/views/orders.tsx` / `src/views/order-detail.tsx`: display `enrollmentCode` and channel/owner metadata; stop overwriting order state with `undefined` from mutation helpers.
- `src/components/global-search.tsx`: re-enable phone search once `phone`/`contacts` are actually returned.
- Route labels and nav wording ("Clients" → "Students", "Orders" → "Enrollments") are a **separate, later** change (D6); do not rename route files or API paths in M1.

---

## 10. Indexes and validation

### 10.1 Existing indexes (from idempotent scripts — no live DB was queried)
- `scripts/seed-admin.mjs:81`: `users.email` unique.
- `scripts/migrate-master-data.mjs:40-73`: `qualifications.code` (unique), `rtos.rtoCode` (unique), `agents.name+contact` (unique), `supplier-routes` triple (non-unique), `qualification-rto-mappings` pair (unique) + two supporting non-unique.
- `scripts/migrate-phase-5.mjs:39-65`: Excel import indexes plus `orders.{clientId, qualificationId, rtoId, status, createdAt}`, `invoices.*`, `payments.*`, `commission_records` compound unique, `commission_payouts`, `rto-processing`.
- **No index** exists for `clients`, `documents`, `workflow-tasks`, `payment-plans`, `audit_logs`, `document_access_logs`, `communications`, `certificates`, `document_requirements`, or any enrollment-code equivalent.

### 10.2 Proposed M1 indexes (new migration script only)
| Collection | Index | Unique | Purpose |
|---|---|---|---|
| `orders` | `{ enrollmentCode: 1 }` | yes, **sparse** | Guarantee code uniqueness; allow legacy nulls. |
| `orders` | `{ bdc_id: 1 }` | no | Owner-scoped list/report performance. |
| `orders` | `{ b2b_agent_id: 1 }` | no | Owner-scoped list/report performance. |
| `orders` | `{ channel_type: 1 }` | no | Channel filtering. |
| `clients` | `{ email: 1 }` | see below | Dedupe integrity. |
| `clients` | `{ usiNumber: 1 }` | yes, **sparse** | USI uniqueness where present. |
| `clients` | `{ referredByStudentId: 1 }` | no | Referral lookups. |

**Email uniqueness caution:** application-level dedupe has existed without a DB index, so duplicate/case-variant emails may already exist. Creating a unique index could fail on legacy data. Recommended sequence: (1) audit duplicates read-only, (2) add a non-unique index, (3) after explicit approval and any authorized cleanup, convert to unique. Do not create a unique index blindly.

### 10.3 Validation to add (server-side, never client-only)
- Email format + trim + lowercase on both POST and PATCH.
- Date format validation for `dob` and any new timestamps (reuse `src/lib/master-validation.ts:isValidDate` pattern).
- USI format/length per business rule; treat as PII.
- `visaStatus` against a defined enum (values need confirmation).
- `referredByStudentId` must reference an existing `clients` document; enforce mutual exclusivity with `externalReferrerName` if confirmed.
- Enrollment code is **never** accepted from the request body.
- Use `safeObjectId` (`src/lib/db.ts:50-56`) in client routes instead of throwing `toObjectId` (`:42-44`), so malformed ids return `400 INVALID_ID` rather than a 500.

---

## 11. RBAC and ownership implications

### 11.1 Helpers that must be preserved (M0)
- `checkOrderAccess(auth, order)` — `src/middleware/auth.ts:138-154`. User-space ids only (`bdc_id`, `b2b_agent_id`); agent ids never compared; ownerless legacy orders fail closed.
- `getAccessibleClientIds(auth)` — `:164-176`. Derives client access from owned orders; admins get `null` = all.
- `checkClientAccess(auth, client, ids)` — `:186-199`. Fails closed when no accessible set is supplied.
- `maskFinancialFields(auth, record)` — `:209-239`. Masks cost/margin/profit fields for BDC/B2B_AGENT.
- `filterOrdersByRole(auth, orders)` — `:246-250`. Used by reports.

Every new M1 route or subroute must call the appropriate helper before returning or mutating data. Do not trust body-supplied owner fields (already enforced in `PATCH /api/orders/[id]:97-102` and document routes).

### 11.2 Ownership of new records (D5)
- Creating a client/order as BDC or B2B_AGENT writes the owner id from the authenticated user (order creation already does this).
- Creating as admin/super-admin intentionally leaves the record ownerless; it stays admin-only.
- **Do not add fallback logic** that copies `sourceAgentId` (an agent id) into an owner field — M0 tests explicitly prove this is wrong.

### 11.3 New PII and financial exposure
- **USI / DOB / visa status** are sensitive. Extend masking/field-selection so BDC/B2B_AGENT see only what is explicitly approved. Recommended: project these fields only for admins and the record owner, and write an access log for USI reads if the business requires it.
- **S9 (grossMargin leak):** `GET /api/orders/[id]:40,54` computes `grossMargin = sellingPrice - supplierCostSnapshot - otherCost` and returns it to all roles, even though `supplierCostSnapshot` is masked. Either apply `maskFinancialFields` to the GET response or omit `grossMargin` for non-admins. M0 tests only assert `supplierCostSnapshot` is undefined, so this gap is currently untested.
- **S9 (report row leaks):** `maskFinancialFields` masks only top-level fields plus `byCurrency` and `totals`. It does **not** recurse into arrays. Consequently `src/app/api/reports/orders/route.ts:110,112` (`supplierCost`/`margin` in `result.orders[]`), `src/app/api/reports/margin/route.ts:38` (`byQualification[]`), `src/app/api/reports/supplier-costs/route.ts:89-108` (`supplierCosts[]`), and `src/app/api/reports/monthly-summary/route.ts:56,113` (`monthlySummary[]` with nested `byCurrency`/`totals`) all expose cost/margin to BDC/B2B_AGENT. Fix the helper to recurse into arrays, or explicitly project allowed fields in each report.
- **`sellingPrice` exposure:** Phase 0 docs (`field-masking-audit.md:13`, `permission-matrix.md:31-34`) say base/standard prices are hidden from B2B_AGENT, but both order list (`:62`) and detail (`:52`) return `sellingPrice` to every role. Reconcile the docs and the code with an explicit decision.
- **`GET /api/clients/duplicates` (S10):** add the same ownership scoping as other client routes; otherwise non-admins can enumerate other accounts' clients through dedupe metadata.
- **S13 (timeline denial / payment-plan oracle):** `src/app/api/orders/[id]/timeline/route.ts:19` projects `{ history: 1 }` before calling `checkOrderAccess` at `:23-25`, so the order's `bdc_id`/`b2b_agent_id` are absent and non-admin owners are always denied their own timeline. Remove/expand the projection so ownership fields are present. `src/app/api/orders/[id]/payment-plan/route.ts:19` returns `{ plan: null }` before any ownership check when no plan exists, which leaks plan existence to unauthorized callers; move the check ahead of the lookup. Both are adjacent to M1 order-detail work.

### 11.4 Role matrix facts
- `src/lib/permissions.ts:11-62`: SUPER_ADMIN and ADMIN each have 15 permissions; BDC and B2B_AGENT each have 6. The `Permission` union (`types.ts:124-146`) has 22 values; 7 are unused in the matrix (`rto.manage`, `agents.manage`, `qb.retry`, `commissions.manage`, `commissions.view`, `qb.manage`, `finance.reconcile`).
- `ROUTE_PERMISSIONS` (`permissions.ts:72-90`) uses `qualifications.manage` for `/rtos` and `/agents`, while the matrix docs say `rto.manage`/`agents.manage`. Documentation drift only; server routes use the matrix strings.
- `scripts/seed-admin.mjs:105` stores `roleNames: ["Super Admin"]` (space), while enforcement checks `"SUPER_ADMIN"` (underscore). `scripts/verify-login.mjs:75` expects ≥20 permissions while the matrix grants 15. These are **out-of-scope for M1** but should be recorded as a separate correctness issue; actual stored production values were not inspected.

---

## 12. Legacy risks and technical debt

| # | Risk | Evidence / impact |
|---|---|---|
| L1 | Envelope mismatch `getClient`/`getOrder` | Client profile and order detail currently fall back to "not found"; new fields would be invisible in UI. |
| L2 | Document upload always fails from frontend | `ops-store.uploadDocument` omits `clientId` required by the API; new enrollment document work inherits this. |
| L3 | Document review always fails from frontend | Sends `verdict`, API expects `status`. |
| L4 | Client contacts/addresses never persisted | UI sends them, POST hardcodes `[]`; contacts tab and phone dedupe are permanently empty. |
| L5 | Partial create responses typed as full entities | New table rows have `undefined` status/phone until refetch. |
| L6 | `phone` split-brain | Used in API/UI, absent from `Client` type. |
| L7 | Client PATCH is effectively dead and unvalidated | No frontend caller; no email dedupe/lowercase; accepts any status string. |
| L8 | No DB-level email uniqueness | Exact lowercase app check only; case variants and duplicates possible. |
| L9 | Unscoped duplicates endpoint | Cross-client data exposure to any `clients.view` holder. |
| L10 | No client audit trail | `POST`/`PATCH /api/clients` never call `writeAudit`; profile "Audit" tab shows `order.history`. |
| L11 | Malformed ids cause 500s in client routes | `toObjectId` throws; other modules use `safeObjectId` + 400. |
| L12 | Inconsistent status vocabulary in legacy data | `"Prospect"` vs `"Active"` vs `"active"` with no enum. |
| L13 | `sourceAgentId` name means different things | Client = sales/closing agent; Order = certificate source agent; both are agent ids, never user ids. |
| L14 | Excel client import is a no-op placeholder | `src/app/api/excel/import/route.ts:44-51` fabricates success without inserting; `ImportScope` includes `"clients"`. |
| L15 | Reports double-count and ignore date filters | `src/app/api/reports/clients/route.ts:25-26` unused filters; adds both `o.sellingPrice` and `inv.total` into `byCurrency.invoiced`. |
| L16 | `getAccessibleClientIds` full-collection scan | `auth.ts:168` loads every order on each client list/detail/report request; will degrade as data grows. |
| L17 | Stale security docs | Phase 0 masking/permission docs claim hidden fields and scoping mechanisms that do not match current code. |
| L18 | Duplicate Mongo helpers | `src/lib/db.ts` and `src/lib/mongodb.ts` both exist; acknowledge in the migration design. |
| L19 | `reviewDocument` approval does not clear a prior `rejectionReason` | `documents/[id]/review/route.ts:36-39` only sets it when `reason` is truthy. |
| L20 | `clients` status in test seeds is lowercase while API/UI use capitalized values | Test fixtures may need normalization when status validation is introduced. |
| L21 | Order timeline broken for non-admin owners | `orders/[id]/timeline/route.ts:19` projects only `history`, so `checkOrderAccess` at `:23-25` cannot see owner fields; BDC/B2B_AGENT get 403 on their own timeline. |
| L22 | Payment-plan existence oracle | `orders/[id]/payment-plan/route.ts:19` returns `{plan:null}` without an ownership check when no plan exists. |
| L23 | Report-level financial leaks | `maskFinancialFields` does not recurse into result arrays; per-row cost/margin exposed in four report endpoints (§11.3). |
| L24 | Status dropdown ignores legal transitions | `src/views/order-detail.tsx:336-345` offers all 21 statuses from `ORDER_STATUS_GROUPS`; only the server enforces `ALLOWED_TRANSITIONS`, so users can submit invalid transitions and receive a 400. |
| L25 | `paymentStatus` never set; `notes` untyped | No order creation writes `paymentStatus` despite `Order.paymentStatus`; `PATCH /api/orders/[id]` accepts `notes` with no type field. |
| L26 | Role check inconsistency in order list | `orders/route.ts:44-48` checks both `auth.role` and `roleNames`, while `checkOrderAccess` (`auth.ts:139`) uses only `auth.role ?? roleNames[0]`; roleNames-only tokens can be filtered differently than the detail route allows. |
| L27 | Missing validation and audit in order subroutes | `/dimensions`, `/payment-plan`, `/timeline`, `/documents`, `/checklist`, `/certificate` have no `writeAudit`; `/dimensions` does no enum/date validation; additional-fee snapshot has no `effectiveFrom` check (`orders/route.ts:263-267`). |

---

## 13. Test plan

### 13.1 Baseline to preserve
- M0: 23 tests in `tests/m0-security.test.ts` (order ownership 9, client ownership 5, document ownership 9).
- Full suite: 119 tests across `phase-0` (30), `phase-1` (19), `phase-2` (17), `phase-3` (8), `phase-4` (11), `phase-5` (11), `m0-security` (23).
- All M0 tests must remain green after M1; ownership fixtures in `m0-security.test.ts:30-147` are the model for new tests.

### 13.2 Helper extensions (`tests/helpers.ts`)
- Extend `seedClient` / add `seedStudent` with `phone`, `dob`, `usiNumber`, `visaStatus`, `referredByStudentId`, `externalReferrerName`.
- Extend `seedOrder` / `seedEnrollment` with `enrollmentCode`, `channel_type`, `bdc_id`, `b2b_agent_id`.
- Add a test helper to create counter documents and to reset `enrollment_sequences` between tests (`clearDb` already drops all collections).

### 13.3 New tests
| Area | Test cases |
|---|---|
| Enrollment code | Format matches `^SC-\d{4}-\d{4,}$`; sequential within a year; **concurrent creation produces unique codes** (parallel calls to `POST /api/orders`); duplicate-key retry; year rollover; unique sparse index allows legacy null codes. |
| Student fields | Create/patch persists every new field; USI/dob/visa/referral validation rejects malformed input; referral reference must exist; email lowercased on POST **and** PATCH; duplicate email rejected on both. |
| Enrollment fields | `channel_type`, `bdc_id`, `b2b_agent_id`, `enrollmentCode` are written at creation and returned by list/detail; `gross_profit`/`net_profit` are **not** stored (D4); admin-created order stays ownerless (D5). |
| Status workflow | `ALLOWED_TRANSITIONS` unchanged; all 21 statuses accepted; invalid transitions rejected; history + audit entry written. Regression-test the frozen 21-status workflow per D7 — no new statuses in M1. |
| Masking / PII | Extend M0 assertions: `grossMargin` hidden from BDC/B2B_AGENT (fix S9); USI/DOB/visa visibility per approved RBAC; `sellingPrice` decision reflected. |
| Report masking | Assert no per-row `supplierCost`/`margin` leaks for BDC/B2B_AGENT across `/api/reports/orders`, `/margin`, `/supplier-costs`, `/monthly-summary`; add a generic recursive-masker test with nested arrays. |
| Ownership | Client create/patch/list respect `getAccessibleClientIds`; duplicates endpoint is scoped; ownerless legacy records remain admin-only; body-supplied owner fields ignored. |
| Subroute ownership | BDC/B2B_AGENT can load their own order timeline (fix S13) and cannot load another owner's; `/payment-plan` performs the ownership check even when no plan exists. |
| Contracts | `ops-store` functions and route responses agree on envelopes and required fields (upload `clientId`, review `status`, detail shapes). |
| Indexes | Apply the new migration script to the in-memory DB and assert index presence/options via `listIndexes`; assert unique sparse behavior. |

### 13.4 Suggested new test file
`tests/m1-student-enrollment.test.ts`, following the `beforeEach(clearDb)` + dynamic `await import("@/app/api/.../route")` pattern already used in `m0-security.test.ts`.

---

## 14. File-by-file M1.2–M1.6 plan

> **Assumption (needs confirmation):** no M1.1–M1.6 milestone definitions exist in the repository (grep for `M1.[1-6]` in all Markdown returned no matches). This audit is treated as the pre-M1.1 deliverable, and the implementation work is proposed below as M1.2–M1.6. Confirm the intended milestone boundaries before scheduling.

### M1.2 — Types, validation, and schema/index migration
| File | Change |
|---|---|
| `src/lib/types.ts` | Add student fields to `Client` (§7.1), enrollment fields to `Order` (§7.2); add optional `ClientStatus` value list; keep all additive. |
| `src/lib/master-validation.ts` **or new** `src/lib/client-validation.ts` | Email/date/USI/visa/referral validators (§10.3). |
| `scripts/migrate-phase-1-m1.mjs` **(new)** | Idempotent, index-only `createIndex` calls (§10.2); no data writes. |
| `tests/helpers.ts` | Extend `seedClient`/`seedOrder` with new fields; add counter helper. |

### M1.3 — Client (Student) API and data integrity
| File | Change |
|---|---|
| `src/app/api/clients/route.ts` | Extended POST whitelist, validation, persist contacts/addresses, lowercased email, complete response, audit, structured list filters/pagination. |
| `src/app/api/clients/[id]/route.ts` | Extended PATCH whitelist + duplicate check + audit; consistent GET shape; `safeObjectId`. |
| `src/app/api/clients/duplicates/route.ts` | Ownership scoping; use real `phone`; remove hardcoded `""`; remove unused import. |
| `tests/m1-student-enrollment.test.ts` | Student field + dedupe + scoping + audit tests. |

### M1.4 — Order (Enrollment) API and code generation
| File | Change |
|---|---|
| `src/app/api/orders/route.ts` | Enrollment code generation (§8); typed owner/channel serialization; return code in create response; audit new fields. |
| `src/app/api/orders/[id]/route.ts` | Serialize `enrollmentCode`/channel/owner consistently; apply masking to GET including `grossMargin` (S9). |
| `src/app/api/orders/[id]/status/route.ts` | No status change (D7 — frozen 21-status workflow); add regression coverage for the 21 statuses and existing transitions; keep transitions table as the source of truth. |
| `src/middleware/auth.ts` | Extend masking for new PII fields; keep all five M0 helpers intact. |
| `tests/m1-student-enrollment.test.ts` | Code uniqueness/concurrency, ownerless-record, field serialization, masking tests. |

### M1.5 — Frontend contracts and views
| File | Change |
|---|---|
| `src/lib/ops-store.ts` | Fix envelopes (§9.2); add `clientId` to upload; send `status` on review; align mutation return types; add new field shapes. |
| `src/views/clients.tsx` | Student form fields, validation error handling, permission-gate Add button. |
| `src/views/client-profile.tsx` | Render new student fields; fix/relabel Audit tab; USI visibility. |
| `src/views/orders.tsx`, `src/views/order-detail.tsx` | Display enrollment code and channel/owner metadata; stop setting order state to `undefined`. |
| `src/components/global-search.tsx` | Phone search once `phone`/`contacts` are returned. |

### M1.6 — Hardening, docs, and release verification
| File | Change |
|---|---|
| `docs/phase-0-rpl-security/field-masking-audit.md`, `docs/phase-0-rpl-security/permission-matrix.md` | Correct stale masking/scope claims to match code. |
| `docs/project-reassessment/06-IMPLEMENTATION-ROADMAP.md` | Already reconciled pre-M1 (2026-11-17): SUPERSEDED banner, D1–D7 source of truth, six explicit constraints, pending B3–B15 table, historical marker on Phase 1. Only verify it stays in sync. |
| `docs/reference/rpl_management_system_database_architecture_design.md` | Note D2 code format and D3/D4/D7 deviations where this project intentionally differs. |
| `docs/phase-1-m1-audit.md` | S3 (D7) and S4 (roadmap reconciliation) are already closed — keep the 21-status workflow recorded as frozen and the roadmap recorded as historical; record any future changed decisions here. |
| `tests/m0-security.test.ts`, `tests/phase-0.test.ts` | Re-run unchanged as regression gates; add only if a new exposure requires an M0 assertion. |
| `package.json` | Optionally add an `npm run migrate:m1` script pointing at the new migration (no dependency changes). |
| Whole repo | Run `npx tsc --noEmit`, `npx oxlint`, `npm test`, `npm run build`; confirm no M0 regression. |

---

## 15. Files inspected for this audit

**Types / core libs**
`src/lib/types.ts`, `src/lib/permissions.ts`, `src/lib/ops-store.ts`, `src/lib/db.ts`, `src/lib/audit.ts` (indirect via route imports), `src/middleware/auth.ts`, `src/lib/master-validation.ts` (referenced), `src/lib/mongodb.ts` (referenced by DB audit).

**Client API**
`src/app/api/clients/route.ts`, `src/app/api/clients/[id]/route.ts`, `src/app/api/clients/duplicates/route.ts`.

**Order API**
`src/app/api/orders/route.ts`, `src/app/api/orders/[id]/route.ts`, `src/app/api/orders/[id]/status/route.ts`, `src/app/api/orders/[id]/dimensions/route.ts`, `src/app/api/orders/[id]/documents/route.ts`, `src/app/api/orders/[id]/checklist/route.ts`, `src/app/api/orders/[id]/certificate/route.ts`, `src/app/api/orders/[id]/timeline/route.ts`, `src/app/api/orders/[id]/payment-plan/route.ts`.

**Document API (M0 ownership paths)**
`src/app/api/documents/upload/route.ts`, `src/app/api/documents/[id]/download/route.ts`, `src/app/api/documents/[id]/review/route.ts`, `src/app/api/documents/[id]/access-log/route.ts` (referenced).

**Other API (integration/adjacent)**
`src/app/api/reports/clients/route.ts`, `src/app/api/reports/orders/route.ts`, `src/app/api/reports/margin/route.ts`, `src/app/api/reports/supplier-costs/route.ts`, `src/app/api/reports/monthly-summary/route.ts`, `src/app/api/invoices/route.ts` (invoice-number precedent), `src/app/api/excel/import/route.ts` (referenced), `src/app/api/audit/route.ts` (referenced), `src/app/api/auth/login/route.ts` (referenced), `src/app/api/roles/route.ts` (referenced).

**Views / components**
`src/views/clients.tsx`, `src/views/client-profile.tsx`, `src/views/orders.tsx`, `src/views/order-detail.tsx`, `src/views/documents.tsx`, `src/components/global-search.tsx`, `src/components/status-badge.tsx`, `src/components/data-table.tsx` (referenced), `src/app/(app)/clients/page.tsx`, `src/app/(app)/clients/[id]/page.tsx`, `src/app/(app)/orders/page.tsx`, `src/app/(app)/orders/[id]/page.tsx` (referenced), `src/lib/fin-store.ts` (referenced).

**Tests**
`tests/helpers.ts`, `tests/setup.ts`, `tests/m0-security.test.ts`, `tests/phase-0.test.ts` (indexed), `tests/phase-1.test.ts` through `tests/phase-5.test.ts` (indexed), `vitest.config.ts` (referenced).

**Scripts**
`scripts/migrate-master-data.mjs`, `scripts/migrate-phase-5.mjs`, `scripts/seed-admin.mjs`, `scripts/verify-login.mjs`, `package.json` (referenced).

**Documentation**
`docs/reference/rpl_management_system_database_architecture_design.md`, `docs/project-reassessment/01-BOSS-REQUIREMENTS-ANALYSIS.md`, `docs/project-reassessment/03-REQUIREMENT-GAP-ANALYSIS.md`, `docs/project-reassessment/04-DATABASE-COMPATIBILITY-ANALYSIS.md`, `docs/project-reassessment/06-IMPLEMENTATION-ROADMAP.md`, `docs/project-reassessment/07-PRODUCTION-ACCEPTANCE-CRITERIA.md`, `docs/project-reassessment/08-EXECUTIVE-SUMMARY.md`, `docs/phase-0-rpl-security/field-masking-audit.md`, `docs/phase-0-rpl-security/permission-matrix.md`, `docs/phase-0-rpl-security/data-scoping-audit.md`, `docs/phase-0-rpl-security/phase-0-implementation-report.md`, `docs/phase-0-rpl-security/phase-0.1-security-hardening-report.md`, `docs/phase-0-rpl-security/phase-0.1-final-acceptance-report.md`, `docs/phase-1-implementation-report.md`, `docs/phase-1-master-data-audit.md`, `docs/phase-6-database-safety-audit.md`, `docs/development/design.md`, `docs/development/workflow.md`, `docs/historical/BACKEND-PLAN.md`, `.gitignore`, `Skills_Connect_Admin_Software_Developer_Specification.docx` (keyword-searched only).

**Additional core files referenced by the audits**
`src/lib/rate-limit.ts`, `src/lib/pricing-validation.ts`, `src/lib/mongodb.ts`, `vitest.config.ts`, `package.json`, `.env` (load pattern only; no values read).

**Git state**
`git status --short`, `git branch --show-current`, `git log -1 --oneline`, `git show --stat 982c682` (M0 provenance verification).

---

## 16. Blockers and open questions

| ID | Item | Owner / action |
|---|---|---|
| B1 | ~~21 vs 23 order statuses (S3)~~ — **RESOLVED 2026-11-17 by approved D7 (Order Status Decision):** keep all 21 statuses and existing `ALLOWED_TRANSITIONS` exactly; no status changes in M1. The two extra statuses are deferred pending management confirmation of names and transition rules; future additions need explicit business approval. No longer a blocker. | Closed — management to confirm the deferred 2 statuses before any future addition |
| B2 | ~~Stale roadmap (S4)~~ — **RESOLVED 2026-11-17 by documentation-only reconciliation:** `06-IMPLEMENTATION-ROADMAP.md` is marked SUPERSEDED with an approved D1–D7 section, six explicit constraints, a pending B3–B15 table, and a historical marker on Phase 1; original text preserved. No longer a blocker. | Closed |
| B3 | **Payment status vocabulary**: code has 6 values; stale roadmap wants 4. No approved decision. Recommend keep 6. | Decision owner |
| B4 | **Enrollment sequence start value**: D2 fixes the format but not the initial `NNNN`. Confirm `0001` vs the roadmap's `1042`. | Decision owner |
| B5 | **Legacy enrollment-code backfill**: assign on demand (admin action) vs one-off migration (§8.4). | Decision owner |
| B6 | **Student name model**: keep `legalName` canonical vs adding split `firstName`/`lastName` (§5). | Decision owner |
| B7 | **Visa status enum values** are not defined in the reference doc; only named in the stale roadmap. | Decision owner |
| B8 | **USI/DOB/visa visibility** by role needs an explicit RBAC decision before UI work (§11.3). | Decision owner |
| B9 | **Selling price masking** docs vs code conflict; decide which is authoritative (§11.3). | Decision owner |
| B10 | **M1.2–M1.6 milestone boundaries** are not defined in the repo; §14 assumes a decomposition that must be confirmed. | Project owner |
| B11 | **Email unique index** cannot be created safely until legacy duplicates are audited (§10.2). | Engineering |
| B12 | **grossMargin leak** (S9) needs a decision: hide for non-admins or redefine as a non-cost-derived display value. | Decision owner + engineering |
| B13 | **Report-level cost/margin leaks and timeline denial (S9/S13)** are exploitable today. Confirm whether they are fixed inside M1 (recommended, same masking/ownership code) or raised as a separate security hotfix before M1 ships. | Security / project owner |
| B14 | **Role check inconsistency (L26):** order list checks `roleNames` broadly while `checkOrderAccess` uses `role ?? roleNames[0]`. Confirm the canonical way roles are represented on tokens before writing new role-gated M1 code. | Engineering |
| B15 | **`paymentStatus` / `notes` gaps (S14):** decide whether M1 should start writing `paymentStatus` on order creation and add `notes` to the `Order` type, or leave both as-is. | Decision owner |

---

## 17. Read-only confirmation

- No source file, test, script, configuration, or dependency was created, edited, or deleted during this audit. The only file written is this audit document, `docs/phase-1-m1-audit.md`.
- No MongoDB connection was made and no database or collection was queried, created, dropped, indexed, seeded, migrated, or backfilled. Production DB `skills_connect_admin` and test DB `skills_connect_admin_test` were not touched.
- No git commit, push, merge, branch switch, stash, or worktree operation was performed. Branch remains `rony-dev`; HEAD remains `295db43`. The pre-existing working-tree items (` M tsconfig.tsbuildinfo`, `?? tsc-errors.txt`) are unchanged.
- All M0 security fixes and all unrelated working-tree changes remain intact.
- **M1.2+ implementation was not started.**

**Post-audit documentation-only reconciliation (2026-11-17):** after this audit was written, two documentation files were edited to resolve S4/B2 — `docs/project-reassessment/06-IMPLEMENTATION-ROADMAP.md` (SUPERSEDED banner, approved D1–D7 source of truth, six explicit constraints, pending B3–B15 table, historical marker on Phase 1) and this audit document (S4/B2 status, recommendation, M1.6 plan). No application source code, tests, dependencies, database records, indexes, or Git state were touched; no commit or push was performed.
