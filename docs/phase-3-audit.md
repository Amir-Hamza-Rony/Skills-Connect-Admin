# Phase 3 — RPL Partner Management, RTO Accreditation & Certificate Delivery Audit

**Project:** Skills Connect Admin
**Branch:** `rony-dev`
**Audit date:** 2026-11-18
**Baseline:** Phases 0, 1, 2 complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 194 tests PASS.
**Status:** Audit complete — implementation complete. `tsc --noEmit` PASS, `next build` PASS, `oxlint` PASS, 205 tests PASS (205 total, 11 new Phase 3 tests).

---

## Scope determination

Phase 3 scope (per current master prompt): **RPL Partner Management, RTO Accreditation & Certificate Delivery**.

Note: Existing `docs/phase-3-implementation-report.md` labels a prior "Phase 3" as "Client, Order & Operational Management" (already complete — includes RTO processing, licensing fields, certificate delivery fields on orders, document access logs). The current master prompt redefines Phase 3 as RPL Partner Management, RTO Accreditation & Certificate Delivery, to be implemented within the existing MongoDB architecture (preserving `clients`/`orders`, all 21 `OrderStatus` values, `ALLOWED_TRANSITIONS`, protected M0 helpers).

## Existing implementation (relevant to Phase 3)

| Area | Status | Evidence |
|------|--------|----------|
| Roles/RBAC | ALREADY IMPLEMENTED | 4 boss roles (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT) in `types.ts:7`; `ROLE_PERMISSIONS` in `permissions.ts`; `withAuth`/`requirePermission` in `middleware/auth.ts` |
| Users with boss fields | ALREADY IMPLEMENTED | `User.full_name`, `b2b_tier`, `default_commission_pct`, `agency_name` in `types.ts:15-29` |
| Clients with student fields | ALREADY IMPLEMENTED | `Client.usiNumber`, `visaStatus`, `referredByStudentId`, `externalReferrerName` in `types.ts:263-283` |
| Orders with enrollment fields | ALREADY IMPLEMENTED | `Order.enrollmentCode`, `channelType`, `bdc_id`, `b2b_agent_id` in `types.ts:293-353` |
| Certificate delivery fields on Order | ALREADY IMPLEMENTED | `certificateDeliveryMethod`, `certificateDeliveryDate`, `certificateTrackingNumber` in `types.ts:316-318` |
| CertificateStatus | ALREADY IMPLEMENTED | Includes "Delivered to Client" in `types.ts:219-224` |
| `certificates` collection | ALREADY IMPLEMENTED | Created on order creation (`src/app/api/orders/route.ts:388-389`) |
| Documents infrastructure | ALREADY IMPLEMENTED | Upload/download/review/access-log (`src/app/api/documents/`) |
| RTO type | PARTIALLY IMPLEMENTED | `Rto` type exists (`types.ts:82-92`) but NO accreditation fields |
| RTO processing | ALREADY IMPLEMENTED | `rto-processing` collection + API + UI (Phase 3 prior docs) |
| RPL Partner | NOT IMPLEMENTED | No `RplPartner` type, no `rpl_partners` collection, no API, no UI |
| Partner assignment | NOT IMPLEMENTED | No `rplPartnerId` on Order, no partner assignment validation |
| Certificate file management | PARTIALLY IMPLEMENTED | Documents exist but no certificate-specific upload/management workflow |
| Certificate delivery workflow | PARTIALLY IMPLEMENTED | Fields exist on Order but no dedicated delivery tracking API/workflow |

## New collections required (Phase 3)

- `rpl_partners` — partner_code (unique), legalName, tradingName, contactPerson, email, phone, address, status, notes, timestamps
- `certificate_deliveries` — orderId, certificateReference, deliveryStatus, deliveryDate, recipient, deliveryMethod, trackingNumber, confirmationDetails, deliveryNotes, updatedBy, timestamps (additive; Order already stores delivery snapshot fields)

## Collections extended (additive only)

- `rtos` — add accreditationNumber, accreditationBody, accreditationExpiry, lastAuditDate, accreditationStatus, supportingDocumentIds, notes
- `orders` — add optional `rplPartnerId` (reference to rpl_partners)

## Types to add/modify (`src/lib/types.ts`)

- `RplPartner` interface + `RplPartnerStatus` union
- `CertificateDelivery` interface + `CertificateDeliveryStatus` union
- Extend `Rto` with accreditation fields (all optional for backward compatibility)
- Extend `Order` with optional `rplPartnerId`
- Permission: `rplPartners.manage`, `rplPartners.view`

## API routes to add

- `GET/POST /api/rpl-partners` — list (search/pagination/status filter) + create
- `GET/PATCH/DELETE /api/rpl-partners/[id]` — get + update (with history/audit) + delete
- `GET/POST /api/certificate-deliveries` — list (filter by order/status) + create delivery record
- `GET/PATCH /api/certificate-deliveries/[id]` — get + update delivery status (with transition validation)
- `POST /api/certificates/[id]/upload` — certificate file upload (reuse documents infrastructure)
- `GET /api/certificates/[id]/download` — secure certificate download

## API routes to modify

- `src/app/api/orders/route.ts` (POST) — optional `rplPartnerId` validation (partner must exist and be active)
- `src/app/api/masters/[type]/route.ts` — add `rtos` accreditation fields handling (already falls through to generic field copy, but add explicit accreditation validation)
- `src/app/api/masters/[type]/[id]/route.ts` — same for PATCH

## Security requirements

- `rplPartners.manage` / `rplPartners.view` permissions; server-side `requirePermission` on all RPL partner APIs
- `RequirePermission` server-side guards on all RPL partner/accreditation/certificate pages
- Partner must be active for new assignments (enforced server-side)
- Certificate file access restricted; no public URLs; download via authenticated route
- Audit logging via `writeAudit` on all mutations
- No secrets/PII in API responses

## Business decisions unresolved (documented, not blocking)

- Whether multiple RPL partners can be assigned to one order → implement single `rplPartnerId` on Order (cardinality: one partner per order); document as confirmed-safe behavior
- Certificate delivery confirmation requirements (signature, photo proof, etc.) → implement manual tracking workflow; no external courier integration
- RTO accreditation expiry enforcement (auto-deactivate vs manual review) → track expiry dates and display warnings; do NOT auto-deactivate without approved business rule

## Migration risks

- New `rpl_partners` and `certificate_deliveries` collections are additive; no existing data affected
- Extending `rtos` with optional accreditation fields is backward-compatible
- Adding optional `rplPartnerId` to `orders` is backward-compatible
- No destructive migrations; no existing indexes dropped

## Dependencies

- Phase 0/1/2 infrastructure (auth, RBAC, audit, db layer, store pattern)
- Existing `documents` collection for certificate file storage
- Existing `orders` collection for certificate-to-order relationship

## Verification targets

- TypeScript typecheck (`tsc --noEmit`)
- Lint (`oxlint`)
- Production build (`next build`)
- Full test suite (`vitest run`) including new phase-3 tests + existing phase-0/1/2 regression
- No Phase 0/1/2 regression; all 21 `OrderStatus` values preserved; `ALLOWED_TRANSITIONS` unchanged; protected M0 helpers intact
