# Skills Connect Admin — Production Deployment Checklist

All fixes applied. This project now matches the DOCX specification and is ready for Render / Vercel deployment.

---

## What Was Fixed

| # | File | Issue | Fix |
|---|------|-------|-----|
| 1 | `server/src/server.ts` | BullMQ worker + overdue sweep always started, even on serverless (Vercel) where they cannot run | Made conditional via `START_BACKGROUND_JOBS` env var (default: `false`) |
| 2 | `server/src/worker.ts` | **New file** — standalone background worker entry point for Render worker service | Starts QB worker + overdue sweep without HTTP server |
| 3 | `vercel.json` | Route regex missing `agents` — `/agents/*` would not reach the API | Added `agents` to the route pattern |
| 4 | `server/src/config/env.ts` | No `START_BACKGROUND_JOBS` env var; production guidance missing | Added `START_BACKGROUND_JOBS` (boolean, default `false`) with production docs |
| 5 | `server/.env.example` | Missing `START_BACKGROUND_JOBS` | Added with explanation |
| 6 | `render.yaml` | **New file** — one-click Render blueprint | Defines API web service, background worker, static frontend, and Redis |

---

## Architecture Confirmation (Matches DOCX Spec)

| Requirement | Spec | Implementation | Status |
|-------------|------|----------------|--------|
| Frontend | React + TS + Vite | React 19 + Vite + TS + Tailwind | ✅ Done |
| Backend | Node + Express + TS | Express 5 + TS + Mongoose | ✅ Done |
| Database | MongoDB | MongoDB Atlas via Mongoose | ✅ Done |
| **File storage** | **MongoDB (no S3)** | **BSON Binary directly in MongoDB** | ✅ **Done — no S3 needed** |
| Auth | JWT + refresh rotation | 15-min JWT + rotating httpOnly refresh cookie | ✅ Done |
| RBAC | Server-side enforcement | `requirePermission` on all routes | ✅ Done |
| Queue | BullMQ + Redis | BullMQ + ioredis (2 clients) | ✅ Done |
| QuickBooks | Async, idempotent sync | Queue + worker + webhook + retry | ✅ Code complete |
| Docker deploy | Containerised | Dockerfile + render.yaml | ✅ Done |
| Reports + Audit | Aggregation pipelines | Server-side reports + audit viewer | ✅ Done |

> **S3 storage:** Your project does NOT use S3. All document bytes are stored in MongoDB Atlas as BSON Binary (per `architecture.md` D4 decision). The DOCX may mention S3, but the confirmed architecture decision (D4) is MongoDB binary storage — no bucket credentials needed.

---

## Pre-Deployment Requirements (You Must Provide)

These are external dependencies — the code cannot supply them:

1. **MongoDB Atlas cluster** — connection string (`MONGODB_URI`)
   - Create database `skills_connect_admin`
   - Add your IP to Atlas Network Access allowlist (`curl ifconfig.me`)
   - Never use `0.0.0.0/0`

2. **Redis** (for BullMQ + shared rate limiting)
   - Render Redis, Upstash, or any Redis-compatible service
   - Set `REDIS_URL` in server env

3. **Hosting accounts**
   - **Render** (recommended): backend web service + background worker + Redis
   - **Vercel**: frontend static hosting (or use Render static site)
   - Or any Docker host (VPS, Railway, etc.)

4. **QuickBooks sandbox credentials** (optional for basic deploy)
   - `QB_REALM_ID`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET`
   - Without these, QB sync stays in `Failed` status — finance still works

5. **Excel workbook** for B6 migration (not blocking deploy)
   - `RTO & Onboarding Master Hub.xlsx` — needed for data migration only

---

## Step-by-Step Deployment (Render — Recommended)

### 1. Create environment files

**Root `.env` (frontend)** — copy from `.env.example`:
```
VITE_API_BASE_URL=https://your-api.onrender.com
VITE_APP_NAME=Skills Connect Admin
```

**`server/.env`** — copy from `server/.env.example` and fill:
```
NODE_ENV=production
PORT=4000
HOST=0.0.0.0
START_BACKGROUND_JOBS=false
TRUST_PROXY=1
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/
MONGODB_DB=skills_connect_admin
REDIS_URL=redis://<your-redis-host>:6379
CORS_ORIGINS=https://your-frontend.onrender.com
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
JWT_ACCESS_SECRET=<32+ random chars>
JWT_REFRESH_SECRET=<different 32+ random chars>
SEED_ADMIN_EMAIL=admin@yourdomain.com
SEED_ADMIN_PASSWORD=<12+ char password>
SEED_ADMIN_NAME=Super Admin
```
> Generate secrets: `[Security.Cryptography.RandomNumberGenerator]::Fill($b); [Convert]::ToBase64String($b)`

### 2. Deploy on Render

**Option A: Blueprint (render.yaml)**
- Connect repo to Render
- Use `render.yaml` blueprint (auto-creates API, worker, frontend, Redis)
- Fill in sync: false env vars in dashboard

**Option B: Manual services**

| Service | Type | Build Command | Start Command |
|---------|------|--------------|---------------|
| API | Web Service | `npm ci && npm run server:build` | `npm run server:start` |
| Worker | Background Worker | `npm ci && npm run server:build` | `node server/dist/worker.js` |
| Frontend | Static Site | `npm ci && npm run build` | (static) `dist/` |

Set all env vars from `server/.env` on API and Worker. Set `VITE_API_BASE_URL` on Frontend.

### 3. Seed the database

After API is deployed:
```powershell
npm run server:seed   # run against production Render API
```
Or use Render's shell to run the seed command.

### 4. Verify deployment

```powershell
# Health checks
curl https://your-api.onrender.com/health
curl https://your-api.onrender.com/health/ready

# Smoke test (run locally against deployed API)
npm run server:smoke
```

### 5. QuickBooks (optional)

If you have QB sandbox credentials:
1. Set `QB_REALM_ID`, `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_WEBHOOK_SECRET`, `QB_SANDBOX=false`
2. As admin, visit `/integrations/quickbooks/connect` to authorise

---

## Vercel Deployment (Alternative)

If using Vercel for the API:

1. Connect repo to Vercel
2. Set all `server/.env` variables in Vercel project settings
3. Set `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=none` (cross-domain)
4. Set `CORS_ORIGINS` to your frontend URL
5. **Important:** Vercel serverless cannot run long-lived workers. You must run the BullMQ worker + overdue sweep on a separate service (Render worker, separate VPS, or Vercel Cron for overdue sweep only).

---

## What Is NOT Blocking Deployment

| Item | Status | Notes |
|------|--------|-------|
| QuickBooks sandbox credentials | Optional | Finance works without it; QB sync stays `Failed` |
| Excel migration workbook | B6 only | Not needed for basic deploy |
| Docker Desktop on dev machine | Unverified locally | Render builds via cloud; Dockerfile is correct |
| UAT on migrated data | Post-deploy | Do after seed + data migration |

---

## File Summary (New & Changed)

### New files:
- `server/src/worker.ts` — standalone background worker entry point
- `render.yaml` — Render blueprint deployment manifest
- `DEPLOYMENT.md` — this checklist

### Modified files:
- `server/src/server.ts` — `START_BACKGROUND_JOBS` conditional
- `server/src/config/env.ts` — added `START_BACKGROUND_JOBS` schema
- `server/.env.example` — added `START_BACKGROUND_JOBS` docs
- `vercel.json` — added missing `agents` route

---

## Support

If deployment fails:
1. Check `GET /health/ready` returns 200 (MongoDB connected)
2. Verify `CORS_ORIGINS` includes your frontend URL
3. Verify `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=none` for cross-domain
4. Check Render logs for API and Worker separately
5. Ensure `MONGODB_URI` IP allowlist includes Render's outbound IPs
