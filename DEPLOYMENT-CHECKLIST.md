# Phase 7 — Production Readiness: Deployment Checklist

## Pre-Deployment Checklist

### Code Quality
- [ ] `npm run lint` — passes with no errors (warnings acceptable)
- [ ] `npm run typecheck` — passes cleanly
- [ ] `npm test` — all tests pass (399+ tests)
- [ ] No `console.log`, `debugger`, or TODO/FIXME markers in production code
- [ ] No secrets or API keys committed to the repository

### Security
- [ ] All API routes enforce authentication via `withAuth` middleware
- [ ] All API routes enforce permissions via `checkPermission` / `RequirePermission`
- [ ] Financial field masking applied via `applyFinancialVisibility()` on all sensitive endpoints
- [ ] 100-Point ID gate enforced on order status transitions (RECEIVED blocked when < 100)
- [ ] Immutable price snapshots locked on RECEIVED status
- [ ] CSRF protection via httpOnly refresh cookies and `credentials: "include"`
- [ ] Access tokens never written to localStorage/sessionStorage
- [ ] Environment variables set: `QB_CLIENT_ID`, `QB_CLIENT_SECRET`, `QB_ENCRYPTION_KEY`

### Database
- [ ] MongoDB connection string configured (`MONGODB_URI`)
- [ ] All required collections exist: `users`, `clients`, `orders`, `qualifications`, `rtos`, `rto_qualification_scopes`, `enrolment_kits`, `invoices`, `payments`, `supplier-routes`, `price-categories`, `price-lists`, `additional-fees`, `commission-rules`, `commission-records`, `commission-payouts`, `rpl-partners`, `certificate-deliveries`, `documents`, `workflow-tasks`
- [ ] Indexes created on frequently queried fields (clientId, orderId, qualificationId, rtoId, status, createdAt)

### API Routes
- [ ] All `/api/*` routes return proper HTTP status codes (200, 201, 400, 401, 403, 404, 409)
- [ ] All error responses follow `{ error: { code, message } }` format
- [ ] API rate limiting configured (if applicable)
- [ ] Request size limits configured for file uploads

### Frontend
- [ ] All 9 sidebar sections render without errors
- [ ] All 5 portal routes (`/admin`, `/ops`, `/sales`, `/partner`, `/applicant`) enforce role-based access
- [ ] ErrorBoundary wraps the app shell (crash protection)
- [ ] Global error handler (`global-error.tsx`) catches unhandled errors
- [ ] All forms have proper validation and error messages
- [ ] All DataTable components have `aria-label` on rows and `scope="col"` on headers

### Performance
- [ ] DataTable renders 1000+ rows without blocking
- [ ] API list endpoints paginate or limit results appropriately
- [ ] Images and assets optimized
- [ ] Next.js caching configured appropriately

### Deployment
- [ ] Build succeeds: `npm run build`
- [ ] Start command works: `npm start` or `next start`
- [ ] Health check endpoint available (if applicable)
- [ ] Rollback procedure documented (previous git tag/commit)
- [ ] Monitoring/alerting configured for 5xx errors
- [ ] Log aggregation configured

### Rollback Procedure
1. Identify the last known good commit/tag
2. `git checkout <last-good-commit>`
3. `git push origin <branch> --force` (if needed)
4. Redeploy from the rolled-back commit
5. Verify health check passes
6. Monitor error rates for 15 minutes

## Post-Deployment Verification
- [ ] Smoke test all 9 sidebar sections
- [ ] Verify role-based redirects work (SALES_BDC cannot access /admin)
- [ ] Verify financial data masking works (SALES_BDC cannot see trueRtoCost)
- [ ] Verify 100-Point ID gate blocks RECEIVED when < 100 points
- [ ] Verify price snapshots are immutable after RECEIVED
- [ ] Monitor error rates for 15 minutes post-deploy
