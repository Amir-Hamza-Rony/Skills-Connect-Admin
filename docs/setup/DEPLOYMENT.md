# Skills Connect Admin — Production Deployment

## Application Architecture (verified)

Skills Connect Admin is a **single Next.js 16 application** serving both the React frontend and all API route handlers.

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend + Backend | Next.js 16 (App Router + Route Handlers) | Single application: React dashboard + REST API on one service |
| Database | MongoDB Atlas (native driver) | Clients, orders, qualifications, RTOs, agents, payments, documents, tasks, invoices |
| Auth | JWT access (15 min) + httpOnly rotating refresh cookie (7 days) | Login, RBAC, session security |
| Password hashing | argon2id | Login security |
| File storage | MongoDB BSON Binary | Document bytes stored directly in database |
| Jobs | Inline (no background worker yet) | QuickBooks sync, overdue checks run inline or are deferred |
| External | QuickBooks integration layer (graceful degradation) | Invoice/payment sync with idempotency |
| Deploy | Single Next.js service | Repeatable production deployment |

There is **no Express server**, no `server/` directory, no BullMQ worker, and no separate background job service at runtime. The Express reference implementation is preserved for reference only and is not required at runtime.

---

## Required Environment Variables

All secrets must be supplied through the hosting provider's environment / secret manager. Never commit `.env`.

| Variable | Purpose | Required | Secret? |
|----------|---------|----------|---------|
| `MONGODB_URI` | MongoDB Atlas connection string | Yes | Yes |
| `MONGODB_DB` | Database name (`skills_connect_admin`) | No (default used if absent) | No |
| `JWT_ACCESS_SECRET` | Signing key for short-lived access JWT | Yes | Yes |
| `JWT_REFRESH_SECRET` | Signing key for rotating refresh token | Yes | Yes |
| `ACCESS_TOKEN_TTL_MIN` | Access token lifetime in minutes | No (default 15) | No |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime in days | No (default 7) | No |
| `COOKIE_SECURE` | `true` in production (HTTPS), `false` in dev | No | No |
| `COOKIE_SAME_SITE` | Cookie same-site policy (`lax`/`none`) | No | No |
| `LOGIN_RATE_LIMIT_MAX` | Login attempts per window | No (default 5) | No |
| `LOGIN_RATE_LIMIT_WINDOW_MIN` | Rate-limit window in minutes | No (default 15) | No |
| `ACCOUNT_LOCK_MAX_FAILURES` | Failed login attempts before lockout | No (default 10) | No |
| `ACCOUNT_LOCK_MINUTES` | Lockout duration in minutes | No (default 15) | No |
| `NEXT_PUBLIC_API_BASE_URL` | External backend URL (empty = same-origin Next.js API) | No | No |
| `NEXT_PUBLIC_APP_NAME` | Application display name | No | No |
| `SEED_ADMIN_EMAIL` | First admin email (first-run seed) | No | Yes |
| `SEED_ADMIN_PASSWORD` | First admin password (first-run seed) | No | Yes |
| `SEED_ADMIN_NAME` | First admin display name | No | No |
| `QB_ENCRYPTION_KEY` | AES-256-GCM key derivation secret for QB OAuth token encryption | Only when using QuickBooks | Yes |
| `QB_CLIENT_ID` | QuickBooks OAuth client ID | Only when using QuickBooks | Yes |
| `QB_CLIENT_SECRET` | QuickBooks OAuth client secret | Only when using QuickBooks | Yes |
| `QB_REALM_ID` | QuickBooks company realm ID | Only when using QuickBooks | Yes |
| `QB_WEBHOOK_SECRET` | QuickBooks webhook signature verification | Only when using QuickBooks webhooks | Yes |
| `QB_REDIRECT_URI` | OAuth redirect URI | Only when using QuickBooks | No |
| `QB_SANDBOX` | Use QuickBooks sandbox (`true`/`false`) | Only when using QuickBooks | No |
| `QB_TOKEN_URL` | Override QuickBooks token endpoint | Only when using QuickBooks | No |
| `QB_AUTH_URL` | Override QuickBooks OAuth authorization endpoint | Only when using QuickBooks | No |
| `QB_INCOME_ACCOUNT_ID` | QuickBooks income account ID for sync | Only when using QuickBooks | No |

See `docs/ENVIRONMENT_VARIABLES.md` for the complete inventory.

---

## Production Build and Start

### Scripts (from `package.json`)

| Script | Command | Purpose |
|--------|---------|---------|
| `npm run dev` | `next dev` | Start Next.js development server |
| `npm run build` | `next build` | Production build (includes TypeScript check) |
| `npm run start` | `next start` | Start production Next.js server |
| `npm run lint` | `oxlint` | Run linter |
| `npm run test` | `vitest run` | Run test suite |
| `npm run typecheck` | `next typegen && tsc --noEmit` | Type-check |
| `npm run seed:admin` | `node scripts/seed-admin.mjs` | Seed first admin user |

### Deployment workflow (single Next.js service)

1. **Connect the repository** to your hosting provider (Render, or any Node.js host).
2. **Set environment variables** in the hosting provider dashboard (secrets marked `sync: false` must be set manually).
3. **Build:** `npm ci && npm run build`
4. **Start:** `npm run start` (Next.js production server on port 3000)
5. **Health check:** `GET /api/health/ready` — returns 200 when MongoDB is reachable, 503 otherwise.
6. **Seed the database:** `npm run seed:admin` (creates the first Super Admin user).

### Redis

| Category | Status | Details |
|---|---|---|
| Provisioned Redis service | Yes | `render.yaml` provisions `skills-connect-redis` (starter plan, oregon region) |
| Actual Redis application integration | No | No `REDIS_URL` reference in `src/`; application does not connect to Redis |
| Implemented background jobs | No | No BullMQ, no ioredis, no worker scripts in `package.json` |
| Planned background jobs | Future only | Redis is provisioned for future background job use but is not integrated |
| Current job behavior | Inline / deferred | QuickBooks sync, overdue checks run inline or are deferred; no background processor |

`render.yaml` provisions a Redis database (`skills-connect-redis`), but the application **does not currently connect to Redis**. Rate limiting is in-memory only (see `src/lib/rate-limit.ts`). Redis is provisioned for future background job use but is not integrated into the application code. Do not assume Redis-backed rate limiting or job queues are operational.

---

## What Is NOT Blocking Deployment

| Item | Status | Notes |
|------|--------|-------|
| QuickBooks sandbox credentials | Optional | Finance works without it; QB sync stays unauthenticated until credentials + `QB_ENCRYPTION_KEY` are set |
| Excel migration workbook | Optional | Needed for data migration only, not for basic deploy |
| Background worker / BullMQ | Not implemented | No worker exists; jobs run inline or are deferred |

---

## Support

If deployment fails:

1. Check `GET /api/health/ready` returns 200 (MongoDB connected).
2. Verify `MONGODB_URI` IP allowlist includes your hosting provider's outbound IPs.
3. Verify all `sync: false` secrets are set in the hosting provider dashboard.
4. Verify `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=lax` for production (HTTPS).
5. Check hosting provider logs for build and runtime errors.
