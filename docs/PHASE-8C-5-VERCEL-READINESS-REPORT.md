# Phase 8C-5 — Vercel Demo Readiness Report

**Repository:** Skills Connect Admin  
**Branch:** `rony-dev`  
**HEAD:** `0593e7ab10a1e0e810bd7a6d9a9223b94ac149a9`  
**Status:** Complete  
**Commit/Push/Deploy:** None performed

---

## 1. Executive Summary

The application is ready for Vercel demo deployment. It is a single Next.js 16 App Router application with no Express server, no BullMQ worker, and no Redis dependency. All API routes are serverless-compatible. Background jobs are processed via a cron-protected API endpoint rather than a persistent worker.

**No VPS-only infrastructure is required for the Vercel demo.** The Hostinger VPS deployment (handled by another developer) is out of scope for this phase.

---

## 2. Vercel Compatibility Audit

### 2.1 Architecture

| Aspect | Finding | Vercel Compatible |
|---|---|---|
| Framework | Next.js 16.4.5 App Router | Yes (native) |
| Runtime | Single `next start` process on port 3000 | Yes |
| Build command | `npm ci && npm run build` | Yes |
| Start command | `npm run start` | Yes |
| Server architecture | Single Next.js service (frontend + API) | Yes |
| Express server | Removed from repo (`server/` gitignored) | N/A |
| BullMQ / worker | Not implemented | N/A (not needed) |
| Redis client | Not integrated | N/A (not needed) |

### 2.2 Vercel Configuration (`vercel.json`)

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "crons": [
    {
      "path": "/api/cron/process-jobs",
      "schedule": "*/5 * * * *",
      "description": "Process due background jobs"
    }
  ]
}
```

- Build command: `npm run build` ✅
- Cron: `*/5 * * * *` (every 5 minutes) for job processing ✅
- Auto-deploy: `false` (set in render.yaml, not vercel.json) — manual control ✅

### 2.3 Environment Variables

All required variables are documented in `docs/ENVIRONMENT_VARIABLES.md`. None are hardcoded. Secrets (`QB_ENCRYPTION_KEY`, `JWT_ACCESS_SECRET`, etc.) must be set in Vercel project settings.

| Variable | Required | Secret | Notes |
|---|---|---|---|
| `MONGODB_URI` | Yes | Yes | MongoDB Atlas connection string |
| `JWT_ACCESS_SECRET` | Yes | Yes | JWT signing key |
| `JWT_REFRESH_SECRET` | Yes | Yes | Must differ from access secret |
| `QB_ENCRYPTION_KEY` | Only for QB | Yes | `sync: false` — set manually |
| `QB_CLIENT_ID` | Only for QB | Yes | OAuth client ID |
| `QB_CLIENT_SECRET` | Only for QB | Yes | OAuth client secret |
| `QB_REALM_ID` | Only for QB | Yes | Company realm ID |
| `QB_WEBHOOK_SECRET` | Only for QB webhooks | Yes | Webhook signature verification |

### 2.4 MongoDB Connection (Serverless)

Two connection patterns exist in the codebase:

**`src/lib/db.ts`** (used by most routes):
- Module-level `MongoClient` caching
- Connects on first use, reuses within the module lifecycle
- Suitable for serverless (connection persists across invocations in the same container)

**`src/lib/mongodb.ts`** (secondary pattern):
- Creates a new `MongoClient` on every module load in production
- Development uses global caching to prevent hot-reload duplicates
- **Concern:** In production serverless, each cold start creates a new client without cross-invocation pooling

**Recommendation:** Consolidate to the `db.ts` pattern (module-level caching) for consistent serverless behavior. This is a known minor concern, not a blocker.

### 2.5 File Upload and Document Storage

- Documents stored as MongoDB BSON Binary (no S3/MinIO/R2)
- Upload via `multipart/form-data` through `/api/documents/upload`
- Access token sent as Bearer header; refresh cookie via `credentials: "include"`
- **Vercel consideration:** Serverless function body limits apply (typically 4.5 MB for Hobby, larger for Pro). Large document uploads may exceed limits.

### 2.6 Request Body Limits

Next.js serverless functions have default body size limits. Document uploads and large Excel imports may exceed these. No custom body limit configuration is present in the codebase.

### 2.7 Timeout Risks

- API routes have no explicit timeout configuration
- QB transport has per-request timeout (default 15s, configurable via `QB_REQUEST_TIMEOUT_MS`)
- Cron job processing is batched (default 25 jobs per invocation) to avoid timeouts
- **Vercel consideration:** Hobby tier has 10s function timeout; Pro has longer. Cron job processing may need batch size adjustment.

### 2.8 Scheduled Job Authentication

- Cron endpoint `POST /api/cron/process-jobs` requires `settings.manage` permission
- Vercel Cron requests do not include a bearer token by default
- **Concern:** Vercel Cron cannot authenticate to the endpoint without additional configuration
- **Workaround:** The endpoint can be called manually or via an external scheduler with auth headers

### 2.9 Logging and Error Handling

- Structured audit logs via `src/lib/audit.ts` with `sanitizeAudit` (strips sensitive keys)
- Console logging for errors
- No external logging service integration (no Logtail, Datadog, etc.)
- Errors return appropriate HTTP status codes (400, 401, 403, 404, 500, 502, 504)

---

## 3. External Provider Dependencies

| Provider | Purpose | Required for Demo | Credentials Needed |
|---|---|---|---|
| MongoDB Atlas | Database | Yes | `MONGODB_URI` |
| QuickBooks | Invoice/payment sync | No | `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_REALM_ID`, `QB_ENCRYPTION_KEY` |
| Redis | Rate limiting/jobs | No | `REDIS_URL` (not integrated) |
| Vercel Cron | Job scheduling | No | Vercel project settings |

None of the external providers are required for the basic Vercel demo. The application functions fully with just MongoDB.

---

## 4. Manual Deployment Checklist

### Pre-deployment
1. [ ] Create Vercel project connected to `github.com/Amir-Hamza-Rony/Skills-Connect-Admin`
2. [ ] Set build command: `npm ci && npm run build`
3. [ ] Set start command: `npm run start`
4. [ ] Set environment variables (all `sync: false` variables manually)
5. [ ] Enable Vercel Cron for `/api/cron/process-jobs` (if background jobs needed)
6. [ ] Configure MongoDB Atlas IP allowlist for Vercel outbound IPs

### Environment Variables to Set in Vercel
```
MONGODB_URI=<required>
MONGODB_DB=skills_connect_admin
JWT_ACCESS_SECRET=<required, 32+ random chars>
JWT_REFRESH_SECRET=<required, must differ from access secret>
QB_ENCRYPTION_KEY=<optional, only for QuickBooks>
QB_CLIENT_ID=<optional>
QB_CLIENT_SECRET=<optional>
QB_REALM_ID=<optional>
QB_WEBHOOK_SECRET=<optional>
```

### Post-deployment
1. [ ] Verify `GET /api/health/ready` returns 200
2. [ ] Seed first admin: `npm run seed:admin` (or via Vercel)
3. [ ] Test login/logout flow
4. [ ] Test QB OAuth connect (if credentials configured)
5. [ ] Test cron endpoint manually (if auth configured)

---

## 5. What Is NOT Required for Vercel Demo

| Item | Reason |
|---|---|
| BullMQ worker | Not implemented; jobs run via cron endpoint |
| Redis client | Not integrated; rate limiting is in-memory |
| Express server | Removed from repo |
| S3/MinIO/R2 | Documents stored in MongoDB BSON Binary |
| Separate frontend/backend | Single Next.js service |
| Dockerfile | Not needed for Vercel |

---

## 6. Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| In-memory rate limiter | Single-instance only | Acceptable for demo; Redis can be added later |
| Vercel Cron auth | Cron requests lack bearer token | Call endpoint manually or configure auth bypass |
| MongoDB connection per cold start | Potential connection limit issues | Monitor and consolidate connection pattern |
| Document upload size limits | Vercel body limits | Compress documents or use smaller files |
| No external logging | Console logging only | Acceptable for demo |

---

## 7. Final Verdict

**READY FOR VERCEL DEMO**

The application is fully compatible with Vercel's serverless execution model:
- ✅ Next.js App Router (native Vercel framework)
- ✅ Single service (frontend + API)
- ✅ No persistent worker required
- ✅ No Redis/BullMQ dependency
- ✅ Cron endpoint configured in vercel.json
- ✅ All secrets configurable via Vercel project settings
- ✅ MongoDB Atlas compatible
- ✅ Build and start commands match Vercel expectations

No deployment has been performed. The Vercel project must be created and configured manually.
