# `server/` — Skills Connect Admin API

Node + Express + TypeScript backend. Replaces the in-memory preview stores in
`src/lib/*.ts`. Phase plan and status live in [`../BACKEND-PLAN.md`](../BACKEND-PLAN.md).

## Current phase: B2 — auth + RBAC ✅

Express app, validated config, MongoDB (Atlas) connection, structured logging, health
endpoints, and full authentication with server-side RBAC. Business routes for masters,
clients and orders arrive in B3.

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Node | ≥ 20 (24 recommended) | `node -v` |
| npm | ≥ 10 | workspaces require it |
| Docker Desktop | any recent | only needed for `docker compose up` |

MongoDB is **not** local — D3 uses MongoDB Atlas, reached over the network.

## First-time setup

```powershell
# 1. Install every workspace (one hoisted node_modules at the repo root)
npm install

# 2. Create your local env file — never commit it
Copy-Item server/.env.example server/.env
# then paste your Atlas mongodb+srv:// URI into MONGODB_URI
#   -> get the IP allowlist right too: curl ifconfig.me

# 3. Generate the two JWT secrets (nothing else provides these)
#    paste each into JWT_ACCESS_SECRET / JWT_REFRESH_SECRET — they must differ

# 4. Create the 7 roles + the first Super Admin
#    set SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD / SEED_ADMIN_NAME first
npm run server:seed

# 5. Start local infra (Redis for B5, MinIO for B4)
docker compose up -d
```

## Commands

Run from the repo root:

```powershell
npm run server:dev        # watch mode on http://localhost:4000
npm run server:build      # compile to server/dist
npm run server:start      # run the compiled build
npm run server:test       # Vitest + Supertest (68 tests, real in-memory Mongo)
npm run server:typecheck  # strict typecheck, no emit
npm run server:seed       # idempotent: upsert roles, create admin if absent
npm run server:smoke      # live end-to-end check against a RUNNING server
```

`server:smoke` talks to `http://127.0.0.1:4000` using the seeded admin credentials in
`server/.env`. Start the server first, then run it. It is re-runnable.

## Endpoints

### Public

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness. Always 200 while the process runs. |
| `GET` | `/health/ready` | Readiness. 503 until MongoDB is reachable. |
| `POST` | `/auth/login` | `{email, password}` → access token + httpOnly refresh cookie. |

### Authenticated (Bearer access token)

| Method | Path | Permission |
|---|---|---|
| `GET` | `/auth/me` | any signed-in user |
| `GET` | `/auth/permissions` | any signed-in user |
| `POST` | `/auth/refresh` | refresh cookie (rotates) |
| `POST` | `/auth/logout` | refresh cookie |
| `POST` | `/auth/logout-all` | any signed-in user |
| `GET` | `/users` | `users.manage` |
| `POST` | `/users` | `users.manage` |
| `PATCH` | `/users/:id` | `users.manage` |
| `POST` | `/users/:id/reset-password` | `users.manage` |
| `POST` | `/users/:id/unlock` | `users.manage` |
| `GET` | `/roles` | `users.manage` |
| `PATCH` | `/roles/:id` | `roles.manage` |

```powershell
curl.exe http://localhost:4000/health
curl.exe -i http://localhost:4000/health/ready
```

## Layout

```text
src/
├─ config/     env.ts (zod, fail-fast) · db.ts (Mongoose)
├─ lib/        app-error · logger · password (argon2id) · tokens (JWT + refresh)
│              cookies · rate-limit · version
├─ middleware/ request-log · error-handler · not-found
│              require-auth · require-permission · login-rate-limit
├─ models/     user · role · refresh-token · audit-log
├─ routes/     health · auth.routes · users.routes · roles.routes
├─ services/   auth (login/rotate/revoke) · permissions (RBAC source) · audit
├─ scripts/    seed-admin.ts
├─ app.ts      Express app factory (no port — testable)
└─ server.ts   bootstrap, listener, graceful shutdown
tests/         health · env · auth · users   (helpers/test-db.ts)
scripts/       smoke.mjs — live end-to-end check
```

## Auth design (D1)

- **Access token** — signed JWT, 15 min, returned in the body. The SPA keeps it in memory
  only; it is never written to web storage.
- **Refresh token** — opaque 256-bit random string in an httpOnly, path-scoped cookie.
  Only its SHA-256 hash is stored. Opaque rather than JWT because revocation and reuse
  detection need a server lookup.
- **Rotation** — each refresh marks the presented token used and issues a successor in the
  same *family*. Presenting an already-used token means it leaked, so the **whole family is
  revoked** and both parties are forced to sign in again.
- **Immediate revocation** — access tokens carry the user's `tokenVersion`. Deactivating an
  account or resetting a password increments it, so already-issued tokens stop working on
  the very next request. A timestamp comparison cannot do this reliably because a JWT `iat`
  only has second resolution.
- **Permissions** — recomputed from database roles on every request, so a matrix change
  takes effect immediately rather than at the next token refresh.
- **Lockout** — rate limited per IP+email on the route, plus a per-account counter that
  locks the account after repeated failures.

## Conventions

- **ESM + NodeNext.** Relative imports need the `.js` extension (`./env.js`).
- **Never log secrets.** `src/lib/logger.ts` has a `redact` list — add any new
  secret-bearing field there.
- **Env access only through `config/env.ts`.** It throws at import if the config
  is invalid, so a misconfigured deployment fails loudly instead of at runtime.
- **RBAC lives in `services/permissions.ts` only.** `src/lib/permissions.ts` on the
  frontend is a UI hint; the server is the single source of truth.
- **Errors:** throw `AppError` for anything the caller should see. Everything
  else becomes an opaque 500 and is logged in full server-side only.
- **Responses:** errors use `{ error: { code, message, details?, requestId } }`.
- **Audit:** every mutation writes an `audit_logs` row. That collection is append-only —
  update and delete hooks throw by design.

## Still blocked (owner supplies)

- R2 credentials (B4) · QuickBooks sandbox (B5) · source workbook (B6) · hosting (B6)
- Docker Desktop — unblocks `docker compose up` and the Dockerfile (nothing depends on it yet)