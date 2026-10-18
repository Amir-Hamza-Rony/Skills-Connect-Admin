/**
 * Upload allowlist (BACKEND-PLAN §6, "type/size whitelist").
 *
 * ## Why this is a whitelist and not a blacklist
 *
 * The browser sends `Content-Type` when it asks for an upload URL, and the
 * server hands that value straight to the presigned `PutObject`. Without a
 * list, any caller could request a presigned URL for an executable, an HTML
 * document (stored XSS when later served from the same origin) or a 5 GB file —
 * and because the bytes never pass through the API, the API is the only place
 * the decision can be made.
 *
 * ## The size cap is enforced twice, deliberately
 *
 * `ContentLengthRange` on the presigned POST policy is the real enforcement:
 * S3 itself rejects an oversized upload. The declared size on the document row
 * exists so the UI can show it and so `confirm-upload` can compare it against
 * what actually landed.
 *
 * ## `application/octet-stream` is allowed
 *
 * A few legitimate sources (notably some scanners and older browsers) send no
 * useful type. Blocking it would reject real documents for a technicality, so it
 * is allowed and the size cap does the work.
 */

export interface AllowedUpload {
  /** Exact MIME type accepted. */
  readonly contentType: string;
  /** Human label for the UI and for error messages. */
  readonly label: string;
  /** Largest file permitted, in bytes. */
  readonly maxBytes: number;
}

const MB = 1024 * 1024;

/**
 * The document types this system actually stores.
 *
 * Qualification evidence is scanned paper — transcripts, statements of
 * attainment, USI records, passports and similar. Everything else is out of
 * scope and should not be silently accepted.
 */
export const ALLOWED_UPLOAD_TYPES: readonly AllowedUpload[] = [
  { contentType: "application/pdf", label: "PDF", maxBytes: 20 * MB },
  { contentType: "image/jpeg", label: "JPEG image", maxBytes: 10 * MB },
  { contentType: "image/png", label: "PNG image", maxBytes: 10 * MB },
  { contentType: "image/heic", label: "HEIC image", maxBytes: 10 * MB },
  { contentType: "image/webp", label: "WebP image", maxBytes: 10 * MB },
  {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    label: "Word document",
    maxBytes: 20 * MB,
  },
  {
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "Excel spreadsheet",
    maxBytes: 20 * MB,
  },
  { contentType: "text/csv", label: "CSV", maxBytes: 20 * MB },
  { contentType: "text/plain", label: "Plain text", maxBytes: 5 * MB },
  { contentType: "application/octet-stream", label: "Binary file", maxBytes: 25 * MB },
];

/** Hard ceiling across every type, so a bad env value cannot remove the cap. */
export const MAX_UPLOAD_BYTES = Math.max(...ALLOWED_UPLOAD_TYPES.map((t) => t.maxBytes));

export function allowedUpload(contentType: string): AllowedUpload | undefined {
  // Strip any parameters (`; charset=…`) before matching.
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return ALLOWED_UPLOAD_TYPES.find((t) => t.contentType === base);
}

/** Content types offered to the file picker. */
export const ALLOWED_UPLOAD_EXTENSIONS = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
] as const;