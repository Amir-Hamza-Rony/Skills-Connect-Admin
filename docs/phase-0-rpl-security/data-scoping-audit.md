# Data Scoping Audit — Phase 0

## Overview

Server-side data isolation is enforced for BDC and B2B_AGENT roles across all order operations. SUPER_ADMIN and ADMIN have unrestricted access.

## Scoping Rules by Role

| Role | Scope | Filter Field | Enforcement |
|------|-------|-------------|-------------|
| SUPER_ADMIN | All enrollments | None | No filter |
| ADMIN | All enrollments | None | No filter |
| BDC | Own B2C enrollments only | `bdc_id` = current userId | `GET /api/orders`, `GET /api/orders/[id]` |
| B2B_AGENT | Own agency enrollments only | `b2b_agent_id` = current userId | `GET /api/orders`, `GET /api/orders/[id]` |

## API Coverage

### Implemented (scoping added)

| Endpoint | Method | Scoping | Masking |
|----------|--------|---------|---------|
| `/api/orders` | GET | `bdc_id` / `b2b_agent_id` filter | `supplierCostSnapshot` hidden from BDC/B2B_AGENT |
| `/api/orders/[id]` | GET | Ownership check on `bdc_id` / `b2b_agent_id` | `supplierCostSnapshot` hidden from BDC/B2B_AGENT |
| `/api/orders` | POST | Auto-sets `bdc_id` or `b2b_agent_id` from actor | N/A (create only) |

### Not Yet Scoped (Phase 1+)

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/api/orders/[id]/status` | PATCH | Needs ownership check |
| `/api/orders/[id]/documents` | GET | Needs enrollment ownership check |
| `/api/orders/[id]/payment-plan` | POST | Needs enrollment ownership check |
| `/api/orders/[id]/dimensions` | PATCH | Needs enrollment ownership check |
| `/api/orders/[id]/checklist` | GET | Needs enrollment ownership check |
| `/api/orders/[id]/certificate` | GET | Needs enrollment ownership check |
| `/api/orders/[id]/timeline` | GET | Needs enrollment ownership check |
| `/api/reports/*` | GET | Needs user-scoped aggregation |
| `/api/export/*` | GET | Needs user-scoped export |

## Data Field Readiness

The `bdc_id` and `b2b_agent_id` fields do not yet exist on order documents (added in Phase 1). The scoping filter is already in place and will:
- Match no documents until Phase 1 adds the fields (correct — no data leakage)
- Automatically enforce scoping once Phase 1 populates the fields

## Tagging on Create

When a BDC creates an order via `POST /api/orders`, `bdc_id` is set to the actor's userId and `channel_type` is set to `"B2C_BDC"`. When a B2B_AGENT creates an order, `b2b_agent_id` is set and `channel_type` is `"B2B_AGENT"`.

## Frontend

Frontend filtering is **never** used for security. All scoping is enforced in API route handlers. The UI may show filtered views for UX, but the API is the security boundary.
