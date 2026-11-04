# Phase 3 — Client, Order & Operational Management Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Baseline:** Phases 0–2 complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 52 tests PASS.

---

## Existing implementation

### Clients
- `GET/POST /api/clients` — list (search by legalName/email/preferredName) + create. Email dedupe (409 CONFLICT).
- `GET/PATCH /api/clients/[id]` — get + patch (legalName, preferredName, email, phone, status, sourceAgentId, notes).
- `Client` type: id, legalName, preferredName, email, phone, contacts[], addresses[], status, sourceAgentId, notes, createdAt.
- Frontend: `src/views/clients.tsx` (list + create), `src/views/client-profile.tsx` (detail with Orders/Contacts/Communications/Documents/Payments/Invoices/Timeline/Notes/Audit tabs, orders history, document summaries).
- Store: `src/lib/ops-store.ts` `listClients`, `getClient`, `createClient`, `primaryPhone`, `primaryEmail`, `formatAddress`.
- Multiple orders per client supported via `listOrders(clientId)`.

### Orders
- `GET/POST /api/orders` — list + create. Phase 2 added pricing snapshot fields (priceCategoryId, priceListId, supplierRouteId, exchangeRate, convertedAmount, additionalFees, feeTotal, currency as `Currency` union).
- `PATCH /api/orders/[id]/status` — status transitions with allowed matrix + history + audit.
- `PATCH /api/orders/[id]/dimensions` — evidenceStatus, rtoSubmissionStatus, certificateStatus with history + certificate collection sync.
- `Order` type references clientId, qualificationId, salesAgentId, sourceAgentId, rtoId. Supplier cost snapshot captured server-side.
- Frontend: `src/views/orders.tsx` (list + create), `src/views/order-detail.tsx` (detail with agents/RTO, commercials, invoices/payments, workflow, status history, documents link).

### Documents / evidence
- `POST /api/documents/upload` — multipart, file bytes stored in MongoDB, versioning (supersedes prior), status Received.
- `GET /api/documents/[id]/download` — stream bytes, no public URLs.
- `PATCH /api/documents/[id]/review` — approve/reject + reason + reviewedAt.
- `GET /api/documents/[id]/access-log` — reads `document_access_logs` (but **no write** to it observed — audit gap).
- `OrderDocument`: id, orderId, clientId, type, version, fileName, contentType, sizeBytes, status, receivedAt, reviewedAt, reviewedBy, rejectionReason.
- Checklist: `DOC_CHECKLISTS.default` static template (`checklistFor` returns same list for every qualification — not per-qualification configurable).
- Frontend: `src/views/documents.tsx` (queues Missing/Under Review/Rejected/Received/Approved, upload new version, review, download).

### Workflow tasks
- `GET /api/workflow/tasks` — filter by orderId/assigneeId/status.
- `PATCH /api/workflow/tasks/[id]` — status/assignee/dueDate/priority with history + audit.
- `POST /api/workflow/tasks` — create task for an order (orderId, stage, title, assigneeId, dueDate, priority).
- `WorkflowTask`: id, orderId, stage, title, assigneeId, dueDate, status, priority, createdAt, updatedAt, history.
- Frontend: `src/views/tasks.tsx` (task board, status toggle).
- No comments/activity text, no overdue detection, tasks not explicitly linked to client (only via order).

### RTO processing
- Order has `rtoSubmissionStatus` (Not Ready/Ready/Submitted/Acknowledged/Under Assessment/Additional Evidence Required/Issued) updated via dimensions route.
- **No dedicated RTO processing record** with submission date, processing status, RTO reference, fees/notes, processing history.
- Order references `rtoId` but **no optional RTO contact** field on the order.
- No validation that qualification→RTO mapping exists when creating an order.
- No validation that supplier route is compatible with the selected qualification/agent/RTO.

### Assessment / licensing / certificate
- Order has `evidenceStatus`, `rtoSubmissionStatus`, `certificateStatus` with history.
- `CertificateBadge`/`EvidenceBadge`/`RtoSubmissionBadge` components exist.
- **No licensing tracking**, **no certificate delivery (hard copy)** tracking, **no configurable workflow stages** per qualification.

### Permissions
- `clients.view/manage`, `orders.view/manage`, `documents.view/review`, `audit.view`, `rto.manage`, `qualifications.manage`, `agents.manage`, `pricing.manage`, `commissions.manage/view`.
- `ROUTE_PERMISSIONS` maps `/clients`, `/orders`, `/documents`, `/workflow`, `/pricing`, etc.
- No `documents.manage` permission (upload gated by `documents.view`).

---

## Missing functionality & gaps

| Area | Gap |
|------|-----|
| Client–Order relationship | Exists (`listOrders(clientId)`). Client profile shows orders history. No dedicated duplicate-prevention beyond email. |
| Qualification–RTO mapping validation on order | **Missing.** Order can reference any qualification + any RTO even if no active mapping exists. |
| Supplier route compatibility validation on order | **Missing.** Order can reference supplier route triple that doesn't match the selected qualification/agent/RTO. |
| Optional RTO contact on order | **Missing.** Order has rtoId but no rtoContactId / rtoContactName. |
| RTO processing record | **Missing.** No `rto-processing` collection: submission date, processing status, RTO reference, fees, notes, history. |
| Document access-log writes | **Missing.** `document_access_logs` is read but never written (upload/download not logged). |
| Per-qualification document checklist | **Missing.** `checklistFor` returns static default for every qualification. |
| Workflow comments / activity text | **Missing.** Tasks have status history but no free-text comments. |
| Overdue task detection | **Missing.** No overdue flag/computation on tasks. |
| Licensing tracking | **Missing.** No licence authority/reference/expiry per order. |
| Certificate delivery tracking | **Missing.** `certificateStatus` exists but no delivery method/date/tracking. |
| Configurable workflow stages | **Missing.** Status matrix is hardcoded; not qualification-configurable. |

---

## Data model gaps (new collections needed)

- `rto-processing` — orderId, rtoId, submissionStatus, submissionDate, processingStatus, rtoReference, processingFees, notes, history[], createdAt, updatedAt. Unique index on orderId (one processing record per order).
- `document_access_logs` writes — documentId, actorId, action, ip, requestId, createdAt (collection exists, only read route).

Existing collections reused (no duplicates): clients, orders, documents, workflow-tasks, qualifications, rtos, agents, supplier-routes, qualification-rto-mappings, price_lists, additional_fees.

---

## API gaps

- No `PATCH /api/orders/[id]` general update (only status/dimensions). General field updates (e.g. rto contact) missing.
- Order creation does not validate qualification→RTO mapping or supplier route compatibility.
- No RTO processing API routes.
- Document upload/download not written to access-log.

---

## UI gaps

- Client profile orders history exists. Order detail exists.
- No RTO processing page/section.
- No per-order RTO contact management.
- No overdue task highlighting.
- No certificate delivery view.

---

## Migration considerations

- Adding `rtoProcessingId` / `rtoContact` to orders is additive; existing orders keep null.
- New `rto-processing` collection is additive; no existing data affected.
- Document access-log writes are additive; existing documents unaffected.
- No destructive migration. No automatic duplicate resolution.

---

## Implementation sequence

1. Audit document (this file).
2. Order enhancements: validate Qualification–RTO mapping + supplier route compatibility on create; add optional RTO contact; general order PATCH.
3. RTO processing: new `rto-processing` collection + API routes + page.
4. Documents: write access-log on upload/download; per-order checklist display.
5. Workflow: overdue detection + comments activity.
6. Assessment/licensing/certificate: licensing fields + certificate delivery tracking.
7. Frontend integration across client profile, order detail, documents, workflow, RTO processing.
8. Tests + typecheck + lint + build.
