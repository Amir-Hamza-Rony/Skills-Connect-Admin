# `server/` — Skills Connect Admin API

Node + Express + TypeScript backend. Replaces the in-memory preview stores in
`src/lib/*.ts`. Phase plan and status live in [`../BACKEND-PLAN.md`](../BACKEND-PLAN.md).

## Current phase: B1 — foundation

Express app, validated config, MongoDB (Atlas) connection, structured logging,
and health endpoints. No business routes yet — those arrive in B2–B6.

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

# 3. Start local infra (Redis for B5, MinIO for B4)
docker compose up -d
docker compose ps
```

## Commands

Run from the repo root:

```powershell
npm run server:dev        # watch mode on http://localhost:4000
npm run server:build      # compile to server/dist
npm run server:start      # run the compiled build
npm run server:test       # Vitest + Supertest
npm run server:typecheck  # strict typecheck, no emit
```

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness. Always 200 while the process runs. |
| `GET` | `/health/ready` | Readiness. 503 until MongoDB is reachable. |

```powershell
curl.exe http://localhost:4000/health
curl.exe -i http://localhost:4000/health/ready
```

## Layout

```text
src/
├─ config/     env.ts (zod, fail-fast) · db.ts (Mongoose)
├─ lib/        app-error.ts · logger.ts · version.ts
├─ middleware/ request-log.ts · error-handler.ts · not-found.ts
├─ routes/     health.ts
├─ app.ts      Express app factory (no port — testable)
└─ server.ts   bootstrap, listener, graceful shutdown
tests/         health.test.ts · env.test.ts
```

## Conventions

- **ESM + NodeNext.** Relative imports need the `.js` extension (`./env.js`).
- **Never log secrets.** `src/lib/logger.ts` has a `redact` list — add any new
  secret-bearing field there.
- **Env access only through `config/env.ts`.** It throws at import if the config
  is invalid, so a misconfigured deployment fails loudly instead of at runtime.
- **Errors:** throw `AppError` for anything the caller should see. Everything
  else becomes an opaque 500 and is logged in full server-side only.
- **Responses:** errors use `{ error: { code, message, details?, requestId } }`.

## Still blocked (owner supplies)

- Atlas URI → `server/.env` (`MONGODB_URI`) — unblocks live `db: connected`
- Docker Desktop — unblocks `docker compose up` and the Dockerfile
- R2 credentials (B4) · QuickBooks sandbox (B5) · source workbook (B6) · hosting (B6)