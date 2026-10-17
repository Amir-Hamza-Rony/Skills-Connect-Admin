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
  S3_FORCE_PATH_STYLE: z.preprocess(
    blankToUndefined,
    z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),
  ),

  // ---- HTTP ----
  CORS_ORIGINS: csv("http://localhost:5173,http://127.0.0.1:5173"),
  JSON_BODY_LIMIT: z.preprocess(blankToUndefined, z.string().min(1).default("1mb")),
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