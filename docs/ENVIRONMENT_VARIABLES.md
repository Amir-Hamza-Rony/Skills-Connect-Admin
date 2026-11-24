# Skills Connect Admin — Environment Variable Reference

All secrets are supplied through the hosting provider's environment / secret manager. Never commit `.env`. Never print secret values to logs or terminal output.

## Required Variables

| Variable | Purpose | Required | Secret? | Example |
|----------|---------|----------|---------|---------|
| `MONGODB_URI` | MongoDB Atlas connection string | Yes | Yes | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/skills_connect_admin?retryWrites=true&w=majority` |
| `JWT_ACCESS_SECRET` | Signing key for short-lived access JWT | Yes | Yes | 32+ random chars |
| `JWT_REFRESH_SECRET` | Signing key for rotating refresh token (must differ from access secret) | Yes | Yes | 32+ random chars |

## Optional Variables (with defaults)

| Variable | Purpose | Required | Secret? | Default | Example |
|----------|---------|----------|---------|---------|---------|
| `MONGODB_DB` | Database name | No | No | `skills_connect_admin` | `skills_connect_admin` |
| `ACCESS_TOKEN_TTL_MIN` | Access token lifetime in minutes | No | No | `15` | `15` |
| `REFRESH_TOKEN_TTL_DAYS` | Refresh token lifetime in days | No | No | `7` | `7` |
| `COOKIE_SECURE` | `true` in production (HTTPS), `false` in dev | No | No | `false` (dev) / `true` (prod) | `true` |
| `COOKIE_SAME_SITE` | Cookie same-site policy | No | No | `lax` | `lax` |
| `LOGIN_RATE_LIMIT_MAX` | Login attempts per window | No | No | `5` | `5` |
| `LOGIN_RATE_LIMIT_WINDOW_MIN` | Rate-limit window in minutes | No | No | `15` | `15` |
| `ACCOUNT_LOCK_MAX_FAILURES` | Failed login attempts before lockout | No | No | `10` | `10` |
| `ACCOUNT_LOCK_MINUTES` | Lockout duration in minutes | No | No | `15` | `15` |
| `NEXT_PUBLIC_API_BASE_URL` | External backend URL; empty = same-origin Next.js API | No | No | `""` | `""` |
| `NEXT_PUBLIC_APP_NAME` | Application display name | No | No | `Skills Connect Admin` | `Skills Connect Admin` |
| `SEED_ADMIN_EMAIL` | First admin email (first-run seed) | No | Yes | `admin@example.com` | `admin@example.com` |
| `SEED_ADMIN_PASSWORD` | First admin password (first-run seed) | No | Yes | 12+ chars | `<12+ char password>` |
| `SEED_ADMIN_NAME` | First admin display name | No | No | `Super Admin` | `Super Admin` |

## QuickBooks Variables (optional — only needed when integrating)

| Variable | Purpose | Required | Secret? | Example |
|----------|---------|----------|---------|---------|
| `QB_ENCRYPTION_KEY` | AES-256-GCM key derivation secret for QB OAuth token encryption | Only when using QuickBooks | Yes | 32+ random chars (never commit) |
| `QB_CLIENT_ID` | QuickBooks OAuth client ID | Only when using QuickBooks | Yes | `<client-id>` |
| `QB_CLIENT_SECRET` | QuickBooks OAuth client secret | Only when using QuickBooks | Yes | `<client-secret>` |
| `QB_REALM_ID` | QuickBooks company realm ID | Only when using QuickBooks | Yes | `<realm-id>` |
| `QB_WEBHOOK_SECRET` | QuickBooks webhook signature verification | Only when using QuickBooks webhooks | Yes | `<webhook-secret>` |
| `QB_REDIRECT_URI` | OAuth redirect URI | Only when using QuickBooks | No | `http://localhost:3000/integrations/quickbooks/callback` |
| `QB_SANDBOX` | Use QuickBooks sandbox | Only when using QuickBooks | No | `true` |
| `QB_TOKEN_URL` | Override QuickBooks token endpoint | Only when using QuickBooks | No | `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer` |
| `QB_AUTH_URL` | Override QuickBooks OAuth authorization endpoint | Only when using QuickBooks | No | `https://appcenter.intuit.com/connect/oauth2` |
| `QB_INCOME_ACCOUNT_ID` | QuickBooks income account ID for sync | Only when using QuickBooks | No | `1` |

## QB_ENCRYPTION_KEY Specifics

- **Source:** `src/lib/quickbooks.ts:49-53`
- **Behavior:** `process.env.QB_ENCRYPTION_KEY` is read and passed to `scryptSync(secret, "skills-connect-qb", 32)` to derive a 32-byte encryption key.
- **Required when:** Storing QuickBooks OAuth access/refresh tokens (`exchangeCodeForTokens`, `refreshAccessToken`).
- **Missing behavior:** `encryptToken()` returns `null`; token exchange fails closed with error `"QuickBooks encryption is not configured. Set QB_ENCRYPTION_KEY before connecting."`
- **Application startup:** The application starts successfully without this key; only QuickBooks token storage is affected.
- **Changing the key:** Changing `QB_ENCRYPTION_KEY` after tokens are stored makes existing encrypted tokens unreadable. Do not rotate without re-encrypting stored tokens.
- **Never commit:** Supply via deployment environment / secret manager only.

## Redis

| Variable | Purpose | Required | Secret? |
|----------|---------|----------|---------|
| `REDIS_URL` | Redis connection URL | No | No |

**Important:** Redis is provisioned externally (see `render.yaml`) but the application **does not currently connect to Redis**. Rate limiting is in-memory only (see `src/lib/rate-limit.ts`). `REDIS_URL` is not referenced anywhere in application source code. Do not assume Redis-backed rate limiting or job queues are operational.

## File Storage

No environment variables for file storage are required. Document bytes are stored as BSON Binary directly in MongoDB.

## Variable Loading

- `.env` is gitignored and never committed.
- `.env.example` is tracked and contains placeholders only (no real credentials).
- Production secrets must be set in the hosting provider dashboard (e.g., Render environment variables).
- `NEXT_PUBLIC_*` prefixed variables are baked into the frontend at build time; all others are server-only.

## Safety Checklist

- [ ] No `.env` file is tracked in git
- [ ] `.env.example` contains placeholders only (no real credentials)
- [ ] All `sync: false` variables in `render.yaml` are set in the hosting provider dashboard
- [ ] `QB_ENCRYPTION_KEY` is set only if using QuickBooks token storage
- [ ] No secret values appear in logs, API responses, or frontend code
- [ ] `COOKIE_SECURE=true` and `COOKIE_SAME_SITE=lax` for production (HTTPS)
