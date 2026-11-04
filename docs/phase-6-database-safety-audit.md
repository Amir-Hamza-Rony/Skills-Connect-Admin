# Phase 6 — Production Database Safety Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Status:** Complete  

---

## 1. Executive Summary

This document audits MongoDB configuration, indexes, migrations, data access patterns, and database safety for production deployment.

**Key findings:**
- Production and test database separation is implemented via `MONGODB_DB` env var and an in-memory test setup (mongodb-memory-server).
- Migration scripts are idempotent and non-destructive (`createIndex` only).
- No destructive migrations exist.
- Transactions are used for payment allocation, reversal, and Excel import execution.
- No backup/restore automation is present in the codebase.
- No `.env` file is committed; production DB credentials must be provided via Vercel environment variables.

No collections or databases were dropped or modified during this audit.

---

## 2. Production vs. Test Database Separation

### Production
- Database name: `MONGODB_DB` env var (default `skills_connect_admin`).
- Connection URI: `MONGODB_URI` env var (MongoDB Atlas).
- No production data is touched by tests.

### Test
- Tests use `mongodb-memory-server` (replica set) via `tests/setup.ts`.
- `tests/setup.ts` overrides `MONGODB_URI` and `MONGODB_DB` (`skills_connect_admin_test`) to an in-memory instance.
- Tests **never** connect to MongoDB Atlas or the production `skills_connect_admin` database.
- `clearDb()` in `tests/helpers.ts` drops collections individually within the test database only.

**Verification:** Production and test databases are fully separated.

---

## 3. Indexes

### 3.1 Existing indexes (via migration scripts)

**`scripts/migrate-master-data.mjs` (Phase 1/2):**
| Collection | Keys | Unique | Index name |
|------------|------|--------|------------|
| `qualifications` | `{ code: 1 }` | Yes | `uniq_qualification_code` |
| `rtos` | `{ rtoCode: 1 }` | Yes | `uniq_rto_code` |
| `agents` | `{ name: 1, contact: 1 }` | Yes | `uniq_agent_name_contact` |
| `supplier-routes` | `{ qualificationId: 1, sourceAgentId: 1, rtoId: 1 }` | No | `idx_supplier_route_triple` |
| `qualification-rto-mappings` | `{ qualificationId: 1, rtoId: 1 }` | Yes | `uniq_qualification_rto_mapping` |
| `qualification-rto-mappings` | `{ qualificationId: 1 }` | No | `idx_mapping_qualification` |
| `qualification-rto-mappings` | `{ rtoId: 1 }` | No | `idx_mapping_rto` |

**`scripts/migrate-phase-5.mjs` (Phase 5):**
| Collection | Keys | Unique | Index name |
|------------|------|--------|------------|
| `excel_import_templates` | `{ name: 1 }` | Yes | `uniq_excel_import_template_name` |
| `excel_imports` | `{ startedBy: 1 }` | No | `idx_excel_imports_startedBy` |
| `excel_imports` | `{ status: 1 }` | No | `idx_excel_imports_status` |
| `excel_imports` | `{ createdAt: -1 }` | No | `idx_excel_imports_createdAt` |
| `excel_import_rows` | `{ importId: 1 }` | No | `idx_excel_import_rows_importId` |
| `excel_import_rows` | `{ status: 1 }` | No | `idx_excel_import_rows_status` |
| `orders` | `{ clientId: 1 }` | No | `idx_orders_clientId` |
| `orders` | `{ qualificationId: 1 }` | No | `idx_orders_qualificationId` |
| `orders` | `{ rtoId: 1 }` | No | `idx_orders_rtoId` |
| `orders` | `{ status: 1 }` | No | `idx_orders_status` |
| `orders` | `{ createdAt: -1 }` | No | `idx_orders_createdAt` |
| `invoices` | `{ orderId: 1 }` | No | `idx_invoices_orderId` |
| `invoices` | `{ status: 1 }` | No | `idx_invoices_status` |
| `invoices` | `{ createdAt: -1 }` | No | `idx_invoices_createdAt` |
| `invoices` | `{ currency: 1 }` | No | `idx_invoices_currency` |
| `payments` | `{ orderId: 1 }` | No | `idx_payments_orderId` |
| `payments` | `{ invoiceId: 1 }` | No | `idx_payments_invoiceId` |
| `payments` | `{ status: 1 }` | No | `idx_payments_status` |
| `payments` | `{ createdAt: -1 }` | No | `idx_payments_createdAt` |
| `commission_records` | `{ agentId: 1, periodMonth: 1, periodYear: 1 }` | Yes | `uniq_commission_records_agent_period` |
| `commission_payouts` | `{ commissionRecordId: 1 }` | No | `idx_commission_payouts_recordId` |
| `rto-processing` | `{ orderId: 1 }` | No | `idx_rto_processing_orderId` |

### 3.2 Index creation safety

- Both migration scripts use MongoDB `createIndex`, which is **idempotent** — running them multiple times does not duplicate indexes or fail if an index already exists.
- Neither script drops, modifies, or deletes existing documents or collections.
- Index names are explicit, preventing accidental duplicate index creation with different names.

---

## 4. Migration Scripts

| Script | Purpose | Idempotent? | Destructive? | Reads .env? |
|--------|---------|-------------|--------------|-------------|
| `scripts/migrate-master-data.mjs` | Phase 1/2 indexes | Yes | No | Yes |
| `scripts/migrate-phase-5.mjs` | Phase 5 indexes | Yes | No | Yes |

Both scripts:
- Exit with code 1 if `MONGODB_URI` is not set.
- Load `.env` only if the key is not already in `process.env`.
- Connect, create indexes, then close the connection.
- Log each index creation.

**Pre-deploy requirement:** Run both scripts against the target production database before first deploy.

---

## 5. Data Access Patterns

### 5.1 Connection handling

Two connection helpers exist:

| File | Used by | Caching | Validation |
|------|---------|---------|------------|
| `src/lib/db.ts` | Most API routes | Module-scoped `MongoClient` + `Db` | Lazy (fails on first DB access if `MONGODB_URI` missing) |
| `src/lib/mongodb.ts` | Some code | Module-scoped (global cache in dev) | Eager (throws at import if `MONGODB_URI` missing) |

Both use the native MongoDB driver. `getClient()` returns the connected client for session/transaction use.

### 5.2 Transaction usage

Transactions (`client.startSession()` + `withTransaction`) are used in:
- `src/app/api/payments/route.ts` — payment allocation + reversal
- `src/app/api/commission-payouts/route.ts` — commission payouts
- `src/app/api/excel/import/route.ts` — Excel import execution (transaction-safe)

Transactions require a replica set. MongoDB Atlas provides replica sets by default. The test setup uses `mongodb-memory-server` replica set (`rs0`) to support this.

### 5.3 Query patterns

- Most report routes use `collection.find(filter).toArray()` without cursor limits on unindexed fields (mitigated by Phase 5 indexes).
- Pagination uses `skip/limit` — acceptable for moderate data volumes.
- No aggregation pipelines with `$lookup` were found in report routes (reduces cross-collection scan risk).

---

## 6. Duplicate Index Handling

- Migration scripts use explicit index names, so re-running does not create duplicates.
- MongoDB `createIndex` is idempotent: if an index with the same keys and options exists, it is a no-op.
- No duplicate index risk identified.

---

## 7. Backup and Restore Considerations

**No backup/restore automation exists in the codebase.**

### Recommendations (documented, not implemented)
- Enable MongoDB Atlas continuous cloud backups (point-in-time recovery).
- Schedule regular `mongodump` exports to secure storage.
- Document a restore procedure: restore dump → run migration scripts → verify indexes.
- Test restore procedure in a non-production environment before relying on it.

---

## 8. Rollback Strategy

### Schema/index rollback
- Migration scripts are additive (indexes only). No `dropIndex` or collection drops exist.
- To roll back an index migration, manually drop the specific index via `db.collection(coll).dropIndex(name)`.
- No data migrations exist, so no data rollback is needed.

### Application rollback
- Deploy previous version of the application code.
- Indexes created by the new version remain compatible (indexes are backward-compatible with older code).

---

## 9. Connection Safety Summary

| Concern | Status |
|---------|--------|
| Production/test DB separation | VERIFIED |
| Idempotent migrations | VERIFIED |
| Non-destructive migrations | VERIFIED |
| No destructive migration scripts | VERIFIED |
| Transaction support | VERIFIED (payments, payouts, Excel import) |
| Replica set required for transactions | NOTED (Atlas provides by default) |
| Duplicate index risk | NONE (explicit names + idempotent createIndex) |
| Backup/restore automation | NOT IMPLEMENTED |
| Rollback procedure | DOCUMENTED (manual index drop + code redeploy) |
| `MONGODB_URI` validation | PARTIAL (eager in `mongodb.ts`, lazy in `db.ts`) |

---

## 10. Evidence Files

- `src/lib/db.ts` — MongoDB connection (db.ts variant, used by most routes)
- `src/lib/mongodb.ts` — MongoDB connection (mongodb.ts variant, eager validation)
- `src/middleware/auth.ts` — API auth (no DB writes in middleware)
- `scripts/migrate-master-data.mjs` — Phase 1/2 index migration
- `scripts/migrate-phase-5.mjs` — Phase 5 index migration
- `tests/setup.ts` — In-memory test DB setup (mongodb-memory-server replica set)
- `tests/helpers.ts` — `clearDb()` (drops collections individually, test DB only)
- `src/app/api/payments/route.ts` — Transaction usage (payment allocation)
- `src/app/api/commission-payouts/route.ts` — Transaction usage (payouts)
- `src/app/api/excel/import/route.ts` — Transaction usage (Excel import)
- `docs/phase-5-production-readiness-audit.md` — Phase 5 DB index notes (baseline)
