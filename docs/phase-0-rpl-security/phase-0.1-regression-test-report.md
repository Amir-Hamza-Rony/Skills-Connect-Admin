# Phase 0.1 — Regression Test Report

## Test Results Summary

| Metric | Value |
|--------|-------|
| Test files | 6 |
| Tests passed | 96 |
| Tests failed | 0 |
| Pass rate | 100% |

## Test Coverage

### Phase 0 — RBAC & Security (30 tests)
All 30 Phase 0 tests pass, including:
- Four-role token verification (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT)
- Unauthorized API access returns 401
- BDC own-record access (200)
- BDC cross-record denial (403)
- B2B_AGENT own-agency access (200)
- B2B_AGENT cross-agency denial (403)
- Partner cost masking from BDC/B2B_AGENT
- Partner cost visible to SUPER_ADMIN/ADMIN
- Order detail masking for BDC
- Super Admin full access

### Phase 1 — Master Data (19 tests)
- RTO management: create, dedupe, activate/deactivate
- Agent management: create, dedupe, update
- Qualification-RTO mapping: create, dedupe, list, update, delete
- Supplier route dedupe and history

### Phase 2 — Commission Rules (17 tests)
- Commission rule creation (draft by default)
- Commission rule validation (agentId vs responsibility)
- Commission rule listing with filters
- Commission calculation
- Commission duplicate prevention
- Commission approval and payout

### Phase 3 — RTO Processing (8 tests)
- RTO processing record creation and listing
- Duplicate RTO processing prevention

### Phase 4 — Finance Summary (11 tests)
- Multi-currency finance summary
- Reconciliation item listing

### Phase 5 — Reports (11 tests)
- Outstanding report per-customer balances

## Pre-Existing Failures Fixed

The following test failures existed before Phase 0.1 and have been resolved:

| Test | Before | After | Fix |
|------|--------|-------|-----|
| Workflow task PATCH | 403 (order access check on non-existent order) | 200 | Skip access check when order doesn't exist |
| Master routes (RTO, Agent, Mapping, Supplier) | 403 (`"Super Admin"` role name check) | 200/201/204 | Changed to `"SUPER_ADMIN"` |
| Commission routes | 403 (`"Super Admin"` role name check) | 200/201 | Changed to `"SUPER_ADMIN"` |
| Reconciliation route | 403 (`"Super Admin"` role name check) | 200 | Changed to `"SUPER_ADMIN"` |
| Finance summary | Empty results (over-scoping) | Correct data | SUPER_ADMIN/ADMIN bypass order filter |
| Outstanding report | Empty results (over-scoping) | Correct data | SUPER_ADMIN/ADMIN bypass order filter |

## Test Infrastructure

- All tests use isolated in-memory MongoDB via `mongodb-memory-server`
- No tests connect to production Atlas
- Test tokens use the four-role model (SUPER_ADMIN, ADMIN, BDC, B2B_AGENT)
- `makeSuperAdminToken()`, `makeAdminToken()`, `makeBDCToken()`, `makeB2BAgentToken()` helpers available
