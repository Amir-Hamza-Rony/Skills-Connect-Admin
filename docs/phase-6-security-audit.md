# Phase 6 — Security and File Upload Readiness Audit

**Project:** Skills Connect Admin  
**Branch:** `rony-dev`  
**Audit date:** 2026-11-04  
**Status:** Complete  

---

## 1. Executive Summary

This document audits authentication, authorization, RBAC, API route protection, input validation, rate limiting, file upload restrictions, document access logging, file type validation, malware scanning availability, sensitive information exposure, and security-related error handling.

**Key findings:**
- Authentication uses JWT access tokens (15 min) + httpOnly refresh cookies with argon2id password hashing.
- All API routes use `withAuth("permission")` middleware; Super Admin bypasses permission checks.
- Rate limiting exists on login (5 attempts/15 min per IP+email).
- File upload validates type and size; documents stored in MongoDB; access logged.
- **No virus/malware scanning exists** for uploaded documents or Excel files.
- **MIME type validation alone does not provide malware protection** — this is documented as a risk.
- Error messages may leak internal details (e.g., MongoDB errors) — generic error messages recommended for production.

---

## 2. Authentication and Authorization

### 2.1 Token architecture
- **Access token:** JWT, HMAC-SHA256, 15-minute TTL (configurable via `ACCESS_TOKEN_TTL_MIN`), stored in browser memory.
- **Refresh token:** JWT, HMAC-SHA256, 7-day TTL (configurable via `REFRESH_TOKEN_TTL_DAYS`), httpOnly cookie (`secure` in production, `sameSite: lax`), SHA-256 hash stored in `refresh_tokens` collection.
- **Password hashing:** argon2id (via `argon2` package).
- **Token storage:** `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` validated eagerly at module load in `src/lib/api-auth.ts` — app will not boot if missing.

### 2.2 Login flow (`src/app/api/auth/login/route.ts`)
- Rate limiting applied before any database work (5 attempts per 15 min per IP+email).
- Account lockout: 10 failed attempts → 15-minute lock.
- Generic "Invalid email or password" message for both user-not-found and wrong-password (prevents user enumeration).
- Account active check and lockout check before password verification.
- On success: failed-login counter reset, `lastLoginAt` updated, refresh token hash stored, httpOnly cookie set.

### 2.3 Session middleware (`src/middleware.ts`)
- Protects page routes by checking for the `refresh_token` httpOnly cookie.
- Public paths: `/login`, `/api/auth/login`, `/api/auth/refresh`, `/api/health`.
- API routes self-authenticate and are skipped by middleware.
- Redirects to `/login` when no refresh cookie is present.

### 2.4 API route protection (`src/middleware/auth.ts`)
- `withAuth(permission, handler)` verifies the Bearer token, then checks permission.
- `withAuth(handler)` verifies the token only.
- Super Admin bypasses all permission checks (by design).
- Returns 401 for missing/invalid token, 403 for missing permission.

---

## 3. Role-Based Access Control (RBAC)

### 3.1 Permission matrix (`src/lib/permissions.ts`)

| Role | Permissions |
|------|-------------|
| Super Admin | All 21 permissions |
| Finance | clients.view, orders.view, finance.view, finance.manage, finance.reconcile, qb.retry, qb.manage, reports.view, documents.view |
| Operations | clients.view, clients.manage, orders.view, orders.manage, documents.view, documents.review, reports.view |
| Sales / Closing Agent | clients.view, orders.view, finance.view, reports.view |
| RTO / Sourcing Manager | rto.manage, agents.manage, qualifications.manage, pricing.manage, orders.view, reports.view |
| Document Reviewer | clients.view, orders.view, documents.view, documents.review |
| Read Only / Manager | clients.view, orders.view, finance.view, reports.view, documents.view |

**Note:** `permissions.ts` is marked "DISPLAY ONLY" — it mirrors the server-side source of truth. The SPA uses it to hide nav links; the server enforces access on every route.

### 3.2 Route-to-permission mapping

| Route | Permission |
|-------|------------|
| `/dashboard` | None (public after login) |
| `/clients` | clients.view |
| `/orders` | orders.view |
| `/qualifications` | qualifications.manage |
| `/rtos` | rto.manage |
| `/agents` | agents.manage |
| `/pricing` | pricing.manage |
| `/documents` | documents.view |
| `/workflow` | orders.view |
| `/finance` | finance.view |
| `/reports` | reports.view |
| `/audit` | audit.view |
| `/settings` | settings.manage |
| `/users` | users.manage |
| `/roles` | roles.manage |
| `/reconciliation` | finance.reconcile |
| `/integrations/quickbooks` | qb.manage |

---

## 4. API Route Protection

All mutating and read API routes are protected by `withAuth` with specific permissions:

- Orders, invoices, payments, clients, qualifications, RTOs, agents, pricing, commission, commission rules, documents, workflow, audit, reconciliation — all use `withAuth("permission")`.
- QB routes use `settings.manage` (connect/disconnect), `finance.view` (status/sync), `qb.retry` (retry sync).
- Reports use `reports.view`.
- Excel routes use `finance.manage`.

**Verification:** Every API route inspected uses `withAuth` with an explicit permission string or token-only verification. No unprotected mutation routes found.

---

## 5. Input Validation

Validation is performed inline in each route handler (no centralized validation middleware):

| Route | Validation |
|-------|------------|
| Login | Email/password required, rate limit, account lockout |
| Order creation | Required fields, supplier route existence, qualification–RTO mapping |
| Invoice creation | Currency, dates, order existence, duplicate prevention |
| Payment creation | Amount, currency, method, invoice existence, over-allocation prevention, idempotency, exchange rate positive number |
| Commission rules | Tiers, dates, agent/responsibility exclusivity |
| Document upload | File type, size per type |
| Excel upload | Extension (.xlsx/.xls), MIME type, max 10 MB |
| Webhook | HMAC-SHA256 signature validation |

**Gap:** No centralized validation middleware — inconsistent error formats possible across routes.

---

## 6. Rate Limiting

| Endpoint | Limiter | Window | Max | Keyed by |
|----------|---------|--------|-----|----------|
| Login (`/api/auth/login`) | `createRateLimiter` (in-memory fixed window) | 15 min | 5 attempts | IP + email |

**Limitations:**
- In-memory only — not shared across serverless instances. In multi-instance Vercel deployments, each instance maintains its own counter.
- Rate limiting only on login; no rate limiting on other mutation endpoints.
- No Redis-backed distributed rate limiter.

**Recommendation:** For production multi-instance deployment, back rate limiting with Redis or use the Express backend's login rate limiter.

---

## 7. File Upload Restrictions

### 7.1 Document upload (`src/app/api/documents/upload/route.ts`)

| Constraint | Value |
|------------|-------|
| Allowed types | `application/pdf`, `image/jpeg`, `image/png`, `image/webp`, `text/csv`, `text/plain` |
| Max size (PDF) | 20 MB |
| Max size (images) | 10 MB each |
| Max size (CSV/TXT) | 20 MB / 5 MB |
| Storage | MongoDB `documents` collection (binary) |
| Access logging | `writeDocumentAccessLog()` on upload |
| Versioning | Auto-incrementing version; prior versions marked "Superseded" |

### 7.2 Excel upload (`src/app/api/excel/upload/route.ts`)

| Constraint | Value |
|------------|-------|
| Allowed extensions | `.xlsx`, `.xls` |
| Allowed MIME | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.ms-excel` |
| Max size | 10 MB |
| Parse mode | exceljs read-only (no formula evaluation, no macro execution) |
| Preview only | No data persisted on upload |

### 7.3 Document download (`src/app/api/documents/[id]/download/route.ts`)
- Streams bytes from MongoDB.
- No public URLs.
- Access logged via `writeDocumentAccessLog()`.
- `Content-Disposition: attachment` header set.

---

## 8. Presigned URL Expiration

**Not applicable.** The application does not use presigned URLs or S3-compatible storage. Documents are stored directly in MongoDB and streamed via API. No expiration configuration exists or is needed.

---

## 9. Document Access Logging

- Upload: logged to `document_access_logs` (documentId, actorId, action="upload", ip, requestId).
- Download: logged to `document_access_logs` (documentId, actorId, action="download", ip, requestId).
- Review (approve/reject): `documents.review` permission required; no explicit access log entry on review (the status change itself may or may not be audited via `writeAudit`).

---

## 10. File Type Validation

- Document upload: validates `file.type` (MIME) against an allowlist.
- Excel upload: validates both file extension and MIME-derived type.
- **No magic-byte/file-content validation** — MIME type is derived from the filename extension in the Excel route (`mimeOf()`), which can be spoofed by renaming a malicious file.
- **No antivirus/malware scanning** of uploaded file contents.

---

## 11. Malware Scanning Availability

**Status:** NOT IMPLEMENTED.

No antivirus, malware scanner, or content disarm and reconstruction (CDR) integration exists for:
- Document uploads (PDF, images, CSV, TXT)
- Excel uploads (.xlsx/.xls)

**Critical:** MIME type validation alone does **not** provide malware protection. A malicious file can have a valid `.pdf` or `.xlsx` extension and MIME type while containing embedded scripts, exploits, or malicious macros.

### Recommended safe integration approach (documented, not implemented)

1. **ClamAV integration:** Scan uploaded file bytes with ClamAV (clamscan or clamdscan) before storing in MongoDB. Reject files with detected threats.
2. **Excel macro/formula stripping:** Already partially addressed — exceljs read-only mode does not evaluate formulas or execute macros. Additional validation could strip embedded objects.
3. **File content type verification:** Use magic-byte inspection (e.g., `file-type` package) to verify the actual file content matches the declared extension, rather than trusting the filename.
4. **File size limits:** Already enforced (helps mitigate zip bombs / decompression bombs).

None of these changes are implemented in this phase. They require management approval.

---

## 12. Sensitive Information Exposure

### Protected
- API responses never include passwords, password hashes, tokens, or secrets (verified for auth, QuickBooks, payments).
- QB tokens encrypted at rest (AES-256-GCM via `QB_ENCRYPTION_KEY`); never returned to frontend.
- Audit logging redacts known-sensitive keys: `password`, `passwordHash`, `token`, `tokens`, `refreshToken`, `accessToken`, `secret`, `jwt`, `session`.
- Login response returns `accessToken` in body (necessary for client-side API calls) but never returns the refresh token (httpOnly cookie only).

### Gaps
- Error messages may leak internal details (e.g., MongoDB error messages). Need generic error messages in production.
- `console.error` in audit helper logs errors to stderr — ensure no secrets are passed to `writeAudit()`.

---

## 13. Security-Related Error Handling

| Area | Behavior |
|------|----------|
| Login failure | Generic 401 "Invalid email or password" (no user enumeration) |
| Rate limit exceeded | 429 with `Retry-After` header |
| Account locked | 423 "Account is locked" |
| Account inactive | 403 "This account is deactivated" |
| Missing permission | 403 "Missing permission: X" |
| Unauthenticated | 401 "Not signed in" / "Invalid or expired token" |
| Invalid file type | 422 with specific type message |
| File too large | 422 with size limit message |
| QB not configured | 422 "QuickBooks is not configured" |
| Webhook invalid signature | 401 "Webhook signature verification failed" |
| Audit write failure | Swallowed (never breaks primary operation), logged to stderr |

---

## 14. Summary of Statuses

| Area | Status |
|------|--------|
| Authentication (JWT + refresh cookie) | VERIFIED |
| Password hashing (argon2id) | VERIFIED |
| RBAC on all API routes | VERIFIED |
| Super Admin bypass | VERIFIED (by design) |
| Login rate limiting | VERIFIED (in-memory, single-instance) |
| Account lockout | VERIFIED |
| Generic auth error messages | VERIFIED |
| File type validation | VERIFIED (extension + MIME) |
| File size limits | VERIFIED |
| Document access logging | VERIFIED |
| No public document URLs | VERIFIED |
| Excel read-only parsing (no macros) | VERIFIED |
| Malware/virus scanning | NOT IMPLEMENTED |
| MIME-type-only validation risk | DOCUMENTED (not a substitute for scanning) |
| Sensitive data in API responses | VERIFIED (none exposed) |
| QB token encryption at rest | VERIFIED (AES-256-GCM) |
| Audit logging redaction | VERIFIED |
| Error message information leakage | GAP (may leak internal details) |
| Centralized validation middleware | GAP (inline validation only) |

---

## 15. Evidence Files

- `src/lib/api-auth.ts` — JWT signing/verification, argon2, cookie handling, eager secret validation
- `src/app/api/auth/login/route.ts` — Login, rate limiting, lockout, generic errors
- `src/middleware.ts` — Page-level session protection
- `src/middleware/auth.ts` — API route auth + permission enforcement
- `src/lib/permissions.ts` — RBAC matrix and route-permission mapping
- `src/lib/rate-limit.ts` — In-memory fixed-window rate limiter
- `src/app/api/documents/upload/route.ts` — Document upload validation + access log
- `src/app/api/documents/[id]/download/route.ts` — Document download + access log
- `src/app/api/documents/[id]/review/route.ts` — Document review (permission-protected)
- `src/app/api/excel/upload/route.ts` — Excel upload validation + read-only parsing
- `src/lib/audit.ts` — Audit helper with sensitive-key redaction
- `src/lib/quickbooks.ts` — QB token encryption (AES-256-GCM)
