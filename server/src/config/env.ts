import { config as loadEnvFile } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Environment contract (BACKEND-PLAN B1).
 *
 * The server MUST NOT boot with a half-valid config — a missing or malformed
 * variable has to fail here, loudly, before any listener opens. That is the
 * whole point of validating with zod at import time instead of reading
 * `process.env` ad hoc across the codebase.
 *
 * Secrets come from the local `.env` file or the process environment ONLY.
 * Never commit `.env`; never log the values resolved here.
 */

/** `server/src/config` -> `server/.env`, then repo-root `.env` as a fallback. */
function loadLocalEnvFiles(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, "../../.env"), resolve(here, "../../../.env")];
  for (const path of candidates) {
    // `quiet` stops dotenv printing an "injected env (n)" banner on every boot —
    // it is noise in the structured log stream and confirms file paths.
    if (existsSync(path)) loadEnvFile({ path, quiet: true });
  }
}
loadLocalEnvFiles();

/**
 * A blank value in a `.env` file means "not set", not "empty string".
 * Without this, `PORT=` would coerce to 0 and `LOG_LEVEL=` would fail its enum
 * — both confusing errors for someone filling in a template.
 */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** Comma-separated string -> trimmed, non-empty array. */
const csv = (fallback: string) =>
  z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0),
      )
      .default(fallback.split(",").map((entry) => entry.trim())),
  );

const port = (fallback: number) =>
  z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(65_535).default(fallback),
  );

const positiveInt = (fallback: number) =>
  z.preprocess(blankToUndefined, z.coerce.number().int().positive().default(fallback));

const optionalText = z.preprocess(blankToUndefined, z.string().min(1).optional());

const MONGO_URI_REQUIRED =
  "MONGODB_URI is required — use the mongodb+srv:// connection string from MongoDB Atlas";

const JWT_SECRET_REQUIRED =
  "JWT_ACCESS_SECRET is required — generate one with 32+ random bytes (see server/.env.example)";

const JWT_REFRESH_SECRET_REQUIRED =
  "JWT_REFRESH_SECRET is required — generate a DIFFERENT random secret from JWT_ACCESS_SECRET";

/** `"true"` -> true, anything else -> false; blank -> the fallback. */
const booleanFromEnv = (fallback: boolean) =>
  z.preprocess(blankToUndefined, z.string().default(String(fallback)).transform((v) => v === "true"));

const logLevel = z.preprocess(
  blankToUndefined,
  z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
);

const schema = z.object({
  // ---- Runtime ----
  NODE_ENV: z.preprocess(
    blankToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  PORT: port(4000),
  HOST: z.preprocess(blankToUndefined, z.string().min(1).default("0.0.0.0")),
  LOG_LEVEL: logLevel,
  /** Set to a number only when running behind a proxy you control. */
  TRUST_PROXY: positiveInt(0).optional(),

  // ---- Database (D3: MongoDB Atlas) ----
  // `error` covers the "key absent" case; `.min()` covers the "present but
  // blank" case. Both must give the same actionable message.
  MONGODB_URI: z
    .string({ error: MONGO_URI_REQUIRED })
    .min(1, MONGO_URI_REQUIRED),
  MONGODB_DB: z.preprocess(blankToUndefined, z.string().min(1).default("skills_connect_admin")),
  MONGODB_TIMEOUT_MS: positiveInt(10_000),

  // ---- Queue (B5: BullMQ) ----
  REDIS_URL: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("redis://localhost:6379"),
  ),

  // ---- Object storage (D4: MinIO in dev, Cloudflare R2 in prod) ----
  /** Left unset until B4 — storage must not be required to boot the API. */
  STORAGE_PROVIDER: z.preprocess(
    blankToUndefined,
    z.enum(["minio", "s3", "r2"]).default("minio"),
  ),
  S3_ENDPOINT: optionalText,
  S3_REGION: z.preprocess(blankToUndefined, z.string().min(1).default("auto")),
  S3_BUCKET: optionalText,
  S3_ACCESS_KEY: optionalText,
  S3_SECRET_KEY: optionalText,
  S3_FORCE_PATH_STYLE: booleanFromEnv(true),

  // ---- HTTP ----
  CORS_ORIGINS: csv("http://localhost:5173,http://127.0.0.1:5173"),
  JSON_BODY_LIMIT: z.preprocess(blankToUndefined, z.string().min(1).default("1mb")),

  // ---- Auth (D1: JWT access + rotating refresh) ----
  // Both required from B2 onward. They are generated locally — never issued by a
  // provider. They MUST differ; `refuseBootIfSecretsMatch` enforces that below.
  JWT_ACCESS_SECRET: z
    .string({ error: JWT_SECRET_REQUIRED })
    .min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_REFRESH_SECRET: z
    .string({ error: JWT_REFRESH_SECRET_REQUIRED })
    .min(32, "JWT_REFRESH_SECRET must be at least 32 characters"),
  JWT_ISSUER: z.preprocess(blankToUndefined, z.string().min(1).default("skills-connect-admin")),
  JWT_AUDIENCE: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("skills-connect-admin-web"),
  ),
  ACCESS_TOKEN_TTL_MIN: positiveInt(15),
  REFRESH_TOKEN_TTL_DAYS: positiveInt(7),

  // ---- Refresh cookie ----
  /** `false` in dev (http on localhost); production must be `true`. */
  COOKIE_SECURE: booleanFromEnv(false),
  /** `lax` works when API and SPA share a site; cross-site hosting needs `none`. */
  COOKIE_SAME_SITE: z.preprocess(
    blankToUndefined,
    z.enum(["lax", "strict", "none"]).default("lax"),
  ),

  // ---- Argon2id (password hashing) ----
  ARGON2_MEMORY_COST: positiveInt(19_456),
  ARGON2_TIME_COST: positiveInt(2),
  ARGON2_PARALLELISM: positiveInt(1),

  // ---- Rate limiting ----
  /** Per IP+route attempts allowed inside the window. */
  LOGIN_RATE_LIMIT_MAX: positiveInt(5),
  LOGIN_RATE_LIMIT_WINDOW_MIN: positiveInt(15),
  /** Consecutive failures before the account itself is locked. */
  ACCOUNT_LOCK_MAX_FAILURES: positiveInt(10),
  ACCOUNT_LOCK_MINUTES: positiveInt(15),
  /** Backstop against runaway loops across every non-public route. */
  GLOBAL_RATE_LIMIT_MAX: positiveInt(300),
  GLOBAL_RATE_LIMIT_WINDOW_MIN: positiveInt(1),

  // ---- QuickBooks (B5: invoices / payments sync) ----
  // Left unset until QB sandbox credentials are supplied. The sync endpoints
  // fail cleanly (a named `Failed` status) while these are absent, so the rest of
  // finance works without QuickBooks.
  QB_REALM_ID: optionalText,
  QB_CLIENT_ID: optionalText,
  QB_CLIENT_SECRET: optionalText,
  QB_SANDBOX: booleanFromEnv(true),
  /** Where the QB webhook should be verified against. */
  QB_WEBHOOK_SECRET: optionalText,
  /** QuickBooks Item/Account id for enrolled-course invoice revenue. */
  QB_INCOME_ACCOUNT_ID: z.preprocess(blankToUndefined, z.string().min(1).default("1")),
  /**
   * API and token endpoints. Overridable so the integration can be exercised
   * end-to-end against a local stand-in for QuickBooks (`tests/helpers/qb-stub`).
   *
   * The defaults are Intuit's and nothing in production should override them.
   * The variable exists so the OAuth exchange, the v3 create calls and the token
   * refresh are genuinely testable rather than assumed.
   */
  QB_API_BASE_URL: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("https://quickbooks.api.intuit.com"),
  ),
  QB_TOKEN_URL: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer"),
  ),
  QB_AUTH_URL: z.preprocess(
    blankToUndefined,
    z.string().min(1).default("https://appcenter.intuit.com/connect/oauth2"),
  ),

  // ---- Seed admin (first-run only; used by `npm run server:seed`) ----
  SEED_ADMIN_EMAIL: z.preprocess(blankToUndefined, z.string().email().optional()),
  SEED_ADMIN_PASSWORD: z.preprocess(blankToUndefined, z.string().min(12).optional()),
  SEED_ADMIN_NAME: z.preprocess(blankToUndefined, z.string().min(1).optional()),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
  throw new Error(
    [
      "Invalid environment configuration — refusing to boot:",
      details,
      "",
      "Fix: copy `server/.env.example` to `server/.env` and fill in the values.",
      "     Never commit `.env`.",
    ].join("\n"),
  );
}

export const env = parsed.data;
export type Env = typeof env;

/**
 * Using one secret for both token types would let a stolen refresh token be
 * replayed as an access token, defeating the 15-minute access window. Fail at
 * boot rather than ship that.
 */
if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
  throw new Error(
    "Invalid environment configuration — refusing to boot:\n" +
      "  • JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET.\n" +
      "    Generate two separate secrets (see server/.env.example).",
  );
}

/** Production must not ship without TLS on the refresh cookie. */
if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
  throw new Error(
    "Invalid environment configuration — refusing to boot:\n" +
      "  • COOKIE_SECURE must be true in production (the refresh token is a bearer credential).",
  );
}