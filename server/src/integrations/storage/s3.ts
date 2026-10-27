import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";

/**
 * Object storage adapter (D4).
 *
 * MinIO in development, Cloudflare R2 in production, plain S3 in between — all
 * three speak the same S3 API, so the provider is an **env-only switch** and
 * this file is the only place any of them is named. Nothing else in the codebase
 * knows or cares which one is configured.
 *
 * ## Why presigned URLs
 *
 * Files never flow through the API. The client asks for a short-lived signed
 * URL and uploads straight to the bucket, which means:
 *  - the API never holds file bytes, so it cannot be exhausted by a large upload;
 *  - the bucket can stay **private** — there is no public-read object to leak a
 *    client's passport scan;
 *  - the raw storage key is never sent to the browser, so a client cannot
 *    guess or enumerate another client's key.
 *
 * The trade-off is that a signed URL is usable by anyone who holds it until it
 * expires. 15 minutes is long enough to upload a file and short enough that a
 * leaked link is not a standing exposure.
 */

/** Signed URLs are valid for 15 minutes (BACKEND-PLAN B4). */
export const SIGNED_URL_TTL_SECONDS = 15 * 60;

export interface StorageAdapter {
  /**
   * A presigned PUT URL. The client uploads the file bytes directly to this
   * URL with a plain HTTP PUT — no auth header, because the signature is in the
   * query string.
   */
  presignUpload(key: string, contentType: string): Promise<string>;

  /** A presigned GET URL for downloading an existing object. */
  presignDownload(key: string): Promise<string>;

  /** Whether an object already exists at `key`. Used to confirm an upload. */
  keyExists(key: string): Promise<boolean>;

  /**
   * The real size in bytes of the stored object, or `null` if it is absent.
   *
   * This is how the upload size cap is actually enforced. A presigned PUT URL
   * cannot carry a length condition the way a presigned POST policy can, so the
   * number the browser claimed is not trustworthy — but `confirmUpload` HEADs
   * the object and compares this against the cap and against what was declared,
   * which makes an oversized upload fail before a reviewer ever sees it.
   */
  objectSize(key: string): Promise<number | null>;
}

function buildClient(): S3Client {
  const endpoint = env.S3_ENDPOINT;
  const credentials =
    env.S3_ACCESS_KEY && env.S3_SECRET_KEY
      ? { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY }
      : undefined;

  return new S3Client({
    endpoint: endpoint || undefined,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    ...(credentials ? { credentials } : {}),
  });
}

let client: S3Client | undefined;

function getClient(): S3Client {
  if (!client) client = buildClient();
  return client;
}

/** Thrown when a storage operation is attempted without a configured bucket. */
export class StorageNotConfiguredError extends Error {
  constructor() {
    super(
      "Object storage is not configured. Set S3_BUCKET (and S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY for MinIO or R2) in server/.env.",
    );
    this.name = "StorageNotConfiguredError";
  }
}

function bucket(): string {
  if (!env.S3_BUCKET) throw new StorageNotConfiguredError();
  return env.S3_BUCKET;
}

export const s3Storage: StorageAdapter = {
  async presignUpload(key, contentType) {
    return getSignedUrl(
      getClient(),
      new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
      { expiresIn: SIGNED_URL_TTL_SECONDS },
    );
  },

  async presignDownload(key) {
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
      expiresIn: SIGNED_URL_TTL_SECONDS,
    });
  },

  async keyExists(key) {
    try {
      await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return true;
    } catch (err) {
      // Only a 404 is "not there yet". A 403 means the credentials cannot read
      // the bucket, which is a configuration fault — reporting it as "missing"
      // hid that from the operator until someone read the logs.
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return false;
      if (status === 403) {
        logger.error({ key }, "Storage denied a HEAD request — check the bucket credentials");
        throw new StorageNotConfiguredError();
      }
      logger.error({ err, key }, "Storage head request failed");
      return false;
    }
  },

  async objectSize(key) {
    try {
      const res = await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
      return res.ContentLength ?? null;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      if (status === 404) return null;
      if (status === 403) {
        logger.error({ key }, "Storage denied a HEAD request — check the bucket credentials");
        throw new StorageNotConfiguredError();
      }
      logger.error({ err, key }, "Storage head request failed");
      return null;
    }
  },
};

/**
 * Test seam.
 *
 * There is no real object storage in the test environment, and the B4 acceptance
 * criteria (upload → review → v2, key never leaves the server, access log rows)
 * are about the *flow*, not about S3. So a suite can inject a fake adapter that
 * returns deterministic URLs and records which keys it was asked about, and the
 * service code under test runs unchanged.
 *
 * `null` clears the override, which is what `afterEach` should do.
 */
let override: StorageAdapter | null = null;

export function setStorageOverride(adapter: StorageAdapter | null): void {
  override = adapter;
}

/**
 * The configured adapter.
 *
 * Storage is deliberately not required to boot the API — B1–B3 all work without
 * it. So this returns `null` when no bucket is set and callers decide what to
 * do, rather than failing at import time.
 */
export function getStorage(): StorageAdapter | null {
  if (override) return override;
  if (!env.S3_BUCKET) return null;
  return s3Storage;
}
