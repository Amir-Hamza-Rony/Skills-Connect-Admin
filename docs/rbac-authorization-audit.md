# RBAC Authorization Audit — SUPER_ADMIN Access Fix

**Project:** Skills Connect Admin
**Branch:** `rony-dev`
**Audit date:** 2026-11-18
**Status:** Complete — root cause identified and fixed, verified via tests/typecheck/lint/build.

---

## 1. Executive Summary

The SUPER_ADMIN account was receiving "Your role does not include the `rto.manage` permission" (and similar) errors when accessing administrative modules, despite having the `SUPER_ADMIN` role. Two independent defects caused this:

1. **Frontend `RequirePermission` lacked a SUPER_ADMIN bypass** — the client-side permission gate only checked `userPermissions.includes(required)`, with no role-based short-circuit. SUPER_ADMIN's permission list was missing several module-specific permissions, so the frontend blocked navigation before any API call was made.

2. **SUPER_ADMIN's permission list was incomplete** — `ROLE_PERMISSIONS.SUPER_ADMIN` did not include `rto.manage`, `agents.manage`, `commissions.manage`, `commissions.view`, `qb.retry`, `qb.manage`, or `finance.reconcile`, which are required by the RTO, Agent, Commission, and Reconciliation modules.

A third latent defect was found in the seed script: `roleNames: ["Super Admin"]` (non-canonical casing) would not match the server-side `roleNames.includes("SUPER_ADMIN")` bypass, causing even backend permission checks to fail for seeded SUPER_ADMIN accounts.

All three defects have been fixed. Existing SUPER_ADMIN accounts must **log in again** after the fix so that the updated `ROLE_PERMISSIONS` mapping is embedded in a fresh access token.

---

## 2. Root Cause

### 2.1 Frontend permission gate had no SUPER_ADMIN bypass

`src/components/require-auth.tsx` — `RequirePermission` component checked only:

```typescript
if (!hasPermission(permissions, perm)) { return <Not authorised /> }
```

There was no check for `user.roleNames.includes("SUPER_ADMIN")`. The backend middleware (`src/middleware/auth.ts:54-56`) already had this bypass, but the frontend did not. As a result, SUPER_ADMIN users were blocked at the UI layer even though the backend would have authorized them.

### 2.2 SUPER_ADMIN permission list was incomplete

`src/lib/permissions.ts` — `ROLE_PERMISSIONS.SUPER_ADMIN` was missing permissions required by several modules:

| Permission | Required by module | Was in SUPER_ADMIN list? |
|---|---|---|
| `rto.manage` | RTO & College Management, RTO Processing | No |
| `agents.manage` | Agent Management | No |
| `commissions.manage` | Commission Rules, Records, Payouts | No |
| `commissions.view` | Commission Rules, Records, Payouts (view) | No |
| `qb.retry` | QuickBooks sync retry | No |
| `qb.manage` | QuickBooks management | No |
| `finance.reconcile` | Reconciliation | No |

Because the frontend checked `permissions.includes(perm)` and SUPER_ADMIN's list lacked these, the UI showed "Not authorised" for affected pages.

### 2.3 Seed script used non-canonical role name

`scripts/seed-admin.mjs` — created users with `roleNames: ["Super Admin"]` instead of `["SUPER_ADMIN"]`. The server-side bypass checks `roleNames.includes("SUPER_ADMIN")`, so a seeded account with `"Super Admin"` would NOT match the bypass and would fall through to permission-based checks with an empty permissions array (since `ROLE_PERMISSIONS["Super Admin"]` is `undefined`).

---

## 3. Affected Modules and Permissions

| Module | Required permission | Frontend page | Backend API |
|---|---|---|---|
| RTO & College Management | `rto.manage` | `src/app/(app)/rtos/page.tsx` | `src/app/api/masters/[type]/route.ts` (type=rtos) |
| Agent Management | `agents.manage` | `src/app/(app)/agents/page.tsx` | `src/app/api/masters/[type]/route.ts` (type=agents) |
| Commission Rules | `commissions.manage` | `src/app/(app)/commission-rules/page.tsx` | `src/app/api/masters/commission-rules/route.ts` |
| Commission Records | `commissions.manage` | `src/app/(app)/commission-records/page.tsx` | `src/app/api/commission-records/route.ts` |
| Commission Payouts | `commissions.manage` | `src/app/(app)/commission-payouts/page.tsx` | `src/app/api/commission-payouts/route.ts` |
| Reconciliation | `finance.reconcile` | `src/app/(app)/reconciliation/page.tsx` | `src/app/api/finance/summary/route.ts` |
| RTO Processing | `rto.manage` | `src/app/(app)/rto-processing/page.tsx` | `src/app/api/rto-processing/route.ts` |

---

## 4. Changes Made

### 4.1 Frontend SUPER_ADMIN bypass (`src/components/require-auth.tsx`)

Added a SUPER_ADMIN role check at the top of `RequirePermission`, mirroring the server-side `requirePermission` middleware:

```typescript
if (user?.roleNames?.includes("SUPER_ADMIN")) {
  return <>{children}</>
}
```

This ensures SUPER_ADMIN can navigate to all administrative pages regardless of the specific permission being checked. The `user` object (which includes `roleNames`) was already available from `useAuth()`; it was simply not being used by `RequirePermission`.

### 4.2 SUPER_ADMIN permission list (`src/lib/permissions.ts`)

Added all missing permissions to `ROLE_PERMISSIONS.SUPER_ADMIN`:
`rto.manage`, `agents.manage`, `qb.retry`, `qb.manage`, `commissions.manage`, `commissions.view`, `finance.reconcile`

ADMIN received the same additions (ADMIN and SUPER_ADMIN share the same full administrative permission set).

### 4.3 Seed script role-name normalization (`scripts/seed-admin.mjs`)

Changed `roleNames: ["Super Admin"]` → `roleNames: ["SUPER_ADMIN"]` so seeded accounts match the canonical `RoleName` values used by the server-side bypass.

### 4.4 Permission sync migration script (`scripts/sync-rbac-permissions.mjs`)

New idempotent script that:
1. Normalizes non-canonical `roleNames` values (e.g., "Super Admin" → "SUPER_ADMIN") in existing user records
2. Backfills "SUPER_ADMIN" into `roleNames` for users whose `role` is `SUPER_ADMIN` but whose `roleNames` lacks it
3. Does not touch passwords, password hashes, or any field other than `roleNames`
4. Is safe to run multiple times (idempotent)

**Note:** Permissions are derived from `ROLE_PERMISSIONS[role]` at login time and embedded in the JWT. They are NOT stored per-user in the database. Therefore, after this fix, existing SUPER_ADMIN accounts must **log in once** to receive a fresh access token containing the updated permissions. The sync script only fixes `roleNames` casing; it does not (and cannot) update already-issued tokens.

---

## 5. Session Refresh Requirements

Permissions are baked into the JWT access token at login (`src/app/api/auth/login/route.ts:107-110`). Existing SUPER_ADMIN sessions with stale tokens will continue to work for the token's remaining TTL (15 minutes) but will not reflect the new permission list. After the token expires, the refresh-token rotation will issue a new access token with the updated permissions.

**Action required:** Users logged in as SUPER_ADMIN before this fix should log out and log back in (or simply wait for token expiry and refresh) to pick up the new permissions. No password or credential changes are needed.

---

## 6. Protected Helpers Preserved

The following M0 helpers were NOT modified:
- `checkOrderAccess`
- `getAccessibleClientIds`
- `checkClientAccess`
- `maskFinancialFields`
- `filterOrdersByRole`

All existing `OrderStatus` values (21) and `ALLOWED_TRANSITIONS` remain unchanged. Existing `clients` and `orders` collections are untouched. No new authorization system was introduced — the existing RBAC architecture was corrected.

---

## 7. Testing Results

| Check | Command | Result |
|---|---|---|
| Total tests | `vitest run` | 224 passed |
| Total tests failed | `vitest run` | 0 |
| Test files | `vitest run` | 16 passed (16) |
| TypeScript typecheck | `next typegen && tsc --noEmit` | PASS |
| Lint | `oxlint` | PASS (pre-existing warnings only) |
| Production build | `next build` | PASS |

New test file: `tests/rbac-authorization.test.ts` (10 tests covering SUPER_ADMIN access to all affected modules, ADMIN retained access, BDC/B2B_AGENT blocked, unauthenticated 401, stale roleNames handling, sync idempotency, and user-role relationship preservation).

All existing Phase 0–3 tests continue to pass — no regressions.

---

## 8. Remaining Limitations

1. **Token TTL:** Existing SUPER_ADMIN access tokens issued before this fix will not include the new permissions until they expire (max 15 minutes) and are refreshed. Users must log out and back in (or wait for refresh) to see the fix take effect in the UI.

2. **Database `roleNames` casing:** Any existing user records created by the old seed script with `roleNames: ["Super Admin"]` must be corrected by running `scripts/sync-rbac-permissions.mjs` before their next login, otherwise the server-side SUPER_ADMIN bypass will not match.

3. **No per-user permission storage:** Permissions are role-derived, not per-user. If future requirements call for user-specific permission overrides, a new `permissions` field would need to be added to the `users` collection and the login route updated to merge role-derived and user-specific permissions.
