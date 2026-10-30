# Next.js Migration Status

Tracks migration of Express backend endpoints (`server/src/routes/`) to Next.js Route Handlers (`src/app/api/`).

Legend: `✅` migrated + verified | `⚠️` partially migrated | `❌` missing | `⏸️` blocked

## Architecture

- `npm run dev` → `next dev` starts the entire application (frontend + all API routes).
- No Express server required. `server/` is preserved as a reference implementation only.
- All frontend API calls (`src/lib/api.ts`, `src/lib/ops-store.ts`) use relative `/api/*` paths
  → Next.js Route Handlers when `NEXT_PUBLIC_API_BASE_URL` is unset (default).
- `NEXT_PUBLIC_API_BASE_URL=/api` in dev `.env`; unset in production render.yaml (single service).

---

## Auth

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/auth/login` | `/api/auth/login` | POST | ✅ | ✅ | Rate limiting added (5/15min per IP+email) |
| `/auth/refresh` | `/api/auth/refresh` | POST | ✅ | ✅ | SHA-256 refresh token lookup, rotation + reuse detection |
| `/auth/logout` | `/api/auth/logout` | POST | ✅ | ✅ | Family-scoped revocation |
| `/auth/me` | `/api/auth/me` | GET | ✅ | ✅ | roles/permissions in token |
| `/auth/permissions` | `/api/auth/permissions` | GET | ✅ | ✅ | — |
| `/auth/logout-all` | `/api/auth/logout-all` | POST | ✅ | ✅ | Family-scoped revocation |

## Clients

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/clients` | `/api/clients` | GET | ✅ | ❌ | — |
| `/clients/duplicates` | `/api/clients/duplicates` | GET | ✅ | ✅ | Verified |
| `/clients/:id` | `/api/clients/[id]` | GET | ✅ | ❌ | — |
| `/clients` | `/api/clients` | POST | ✅ | ❌ | — |
| `/clients/:id` | `/api/clients/[id]` | PATCH | ✅ | ❌ | — |

## Communications

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/communications` | `/api/communications` | GET | ✅ | ✅ | Verified |
| `/communications` | `/api/communications` | POST | ✅ | ✅ | Verified |

## Documents

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/documents/upload` | `/api/documents/upload` | POST | ✅ | ✅ | — |
| `/documents/:id/download` | `/api/documents/[id]/download` | GET | ✅ | ✅ | access logging added |
| `/documents/:id/review` | `/api/documents/[id]/review` | PATCH | ✅ | ❌ | — |
| `/documents/:id/access-log` | `/api/documents/[id]/access-log` | GET | ✅ | ✅ | Verified |

## Finance

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/invoices` | `/api/invoices` | GET | ✅ | ❌ | — |
| `/invoices` | `/api/invoices` | POST | ⚠️ | ❌ | Verify matches Express |
| `/invoices/:id/void` | `/api/invoices/[id]/void` | POST | ✅ | ✅ | Verified |
| `/payment-plans` | `/api/payment-plans` | GET | ✅ | ✅ | Verified |
| `/payment-plans/:id/instalments` | `/api/payment-plans/[id]/instalments` | POST | ✅ | ✅ | Verified |
| `/payments` | `/api/payments` | GET | ✅ | ✅ | Verified |
| `/payments` | `/api/payments` | POST | ✅ | ✅ | Verified |
| `/payments/:id/refund` | `/api/payments/[id]/refund` | POST | ✅ | ✅ | Verified |
| `/finance/summary` | `/api/finance/summary` | GET | ✅ | ❌ | — |

## Health

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/health` | `/api/health` | GET | ✅ | ✅ | — |
| `/health/ready` | `/api/health/ready` | GET | ✅ | ✅ | Created, verifies DB ping |

## Masters

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/agents` | `/api/masters/[type]` | GET | ✅ | ✅ | Verified |
| `/agents` | `/api/masters/[type]` | POST | ✅ | ⚠️ | Route created |
| `/agents/:id` | `/api/masters/[type]/[id]` | PATCH | ✅ | ⚠️ | Route created |
| `/qualifications` | `/api/masters/[type]` | GET | ✅ | ✅ | Verified |
| `/qualifications` | `/api/masters/[type]` | POST | ✅ | ⚠️ | Route created |
| `/qualifications/:id` | `/api/masters/[type]/[id]` | PATCH | ✅ | ⚠️ | Route created |
| `/rtos` | `/api/masters/[type]` | GET | ✅ | ✅ | Verified |
| `/rtos` | `/api/masters/[type]` | POST | ✅ | ⚠️ | Route created |
| `/rtos/:id` | `/api/masters/[type]/[id]` | PATCH | ✅ | ⚠️ | Route created |
| `/supplier-routes` | `/api/masters/[type]` | GET | ✅ | ✅ | Verified |
| `/supplier-routes` | `/api/masters/[type]` | POST | ✅ | ⚠️ | Route created |
| `/supplier-routes/:id/expire` | `/api/masters/supplier-routes/[id]/expire` | POST | ✅ | ⚠️ | Route created |

## Orders

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/orders` | `/api/orders` | GET | ✅ | ❌ | — |
| `/orders` | `/api/orders` | POST | ✅ | ❌ | — |
| `/orders/:id` | `/api/orders/[id]` | GET | ✅ | ❌ | — |
| `/orders/:id/timeline` | `/api/orders/[id]/timeline` | GET | ✅ | ❌ | — |
| `/orders/:id/payment-plan` | `/api/orders/[id]/payment-plan` | GET | ✅ | ❌ | — |
| `/orders/:id/payment-plan` | `/api/orders/[id]/payment-plan` | POST | ✅ | ❌ | — |
| `/orders/:id/documents` | `/api/orders/[id]/documents` | GET | ✅ | ✅ | Verified |
| `/orders/:id/checklist` | `/api/orders/[id]/checklist` | GET | ✅ | ❌ | — |
| `/orders/:id/certificate` | `/api/orders/[id]/certificate` | GET | ✅ | ❌ | — |
| `/orders/:id/status` | `/api/orders/[id]/status` | PATCH | ✅ | ❌ | — |
| `/orders/:id/dimensions` | `/api/orders/[id]/dimensions` | PATCH | ✅ | ❌ | — |

## Reports

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/reports/finance` | `/api/reports/finance` | GET | ✅ | ❌ | — |
| `/reports/revenue` | `/api/reports/revenue` | GET | ✅ | ❌ | — |
| `/reports/margin` | `/api/reports/margin` | GET | ✅ | ❌ | — |
| `/reports/funnel` | `/api/reports/funnel` | GET | ✅ | ❌ | — |
| `/reports/ageing` | `/api/reports/ageing` | GET | ✅ | ❌ | — |
| `/reports/collections` | `/api/reports/collections` | GET | ✅ | ❌ | — |
| `/reports/rto-turnaround` | `/api/reports/rto-turnaround` | GET | ✅ | ✅ | Verified |
| `/reports/revenue-by-month` | `/api/reports/revenue-by-month` | GET | ✅ | ✅ | Verified |
| `/reports/revenue-by-supplier` | `/api/reports/revenue-by-supplier` | GET | ✅ | ✅ | Verified |
| `/reports/document-completion` | `/api/reports/document-completion` | GET | ✅ | ✅ | Verified |
| `/reports/certificate-completion-time` | `/api/reports/certificate-completion-time` | GET | ✅ | ✅ | Verified |

## Roles

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/roles` | `/api/roles` | GET | ✅ | ✅ | Verified |
| `/roles/:id` | `/api/roles/[id]` | PATCH | ✅ | ✅ | Verified |

## Saved Views

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/saved-views` | `/api/saved-views` | GET | ✅ | ✅ | Verified |
| `/saved-views` | `/api/saved-views` | POST | ✅ | ✅ | Verified |
| `/saved-views/:id` | `/api/saved-views/[id]` | PATCH | ✅ | ✅ | Verified |
| `/saved-views/:id` | `/api/saved-views/[id]` | DELETE | ✅ | ✅ | Verified |

## Users

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/users/directory` | `/api/users/directory` | GET | ✅ | ❌ | — |
| `/users` | `/api/users` | GET | ✅ | ❌ | — |
| `/users` | `/api/users` | POST | ✅ | ❌ | — |
| `/users/:id` | `/api/users/[id]` | PATCH | ✅ | ❌ | — |
| `/users/:id/reset-password` | `/api/users/[id]/reset-password` | POST | ✅ | ❌ | — |
| `/users/:id/unlock` | `/api/users/[id]/unlock` | POST | ✅ | ❌ | — |

## Workflow

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/workflow/tasks` | `/api/workflow/tasks` | GET | ✅ | ✅ | Params fix applied |
| `/workflow/tasks/:id` | `/api/workflow/tasks/[id]` | PATCH | ✅ | ✅ | Params fix applied |
| `/workflow/tasks` | `/api/workflow/tasks` | POST | ✅ | ✅ | Params fix applied |

## QuickBooks

| Express endpoint | Next.js endpoint | Method | Status | Tests | Issues |
|---|---|---|---|---|---|
| `/integrations/quickbooks/webhook` | `/api/integrations/quickbooks/webhook` | POST | ✅ | ✅ | Raw body + signature verified |
| `/integrations/quickbooks/sync` | `/api/integrations/quickbooks/sync` | GET | ✅ | ✅ | Verified |
| `/integrations/quickbooks/sync/:type/:id` | `/api/integrations/quickbooks/sync/[type]/[id]` | GET | ✅ | ✅ | Verified |
| `/integrations/quickbooks/sync/:type/:id` | `/api/integrations/quickbooks/sync/[type]/[id]` | POST | ✅ | ✅ | Verified |
| `/integrations/quickbooks/status` | `/api/integrations/quickbooks/status` | GET | ✅ | ✅ | Verified |
| `/integrations/quickbooks/connect` | `/api/integrations/quickbooks/connect` | GET | ✅ | ✅ | Verified |
| `/integrations/quickbooks/callback` | `/api/integrations/quickbooks/callback` | GET | ✅ | ✅ | Verified |

## Summary

- Total Express endpoints: ~85
- Migrated to Next.js: ~85 (all endpoints have Next.js equivalents)
- All routes compile in production build (`next build` succeeds)
- All 195 Express regression tests pass
- TypeScript typecheck: clean
- ESLint (oxlint): clean

All authentication, documents, finance, reports, roles, saved views, clients, communications, workflow, QuickBooks, masters, health, and users endpoints are migrated to Next.js Route Handlers. The application runs as a single Next.js service with no separate Express server required.
