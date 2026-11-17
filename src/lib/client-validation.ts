/**
 * Validation helpers for client (Student) create/update operations.
 *
 * Follows the existing `master-validation.ts` convention: pure helpers plus
 * read-only DB checks. Wired into the client routes in M1.3. No dependency was
 * added. Deliberately absent: visa-status enum values (B7), USI format rules
 * (no business rule defined), and a UNIQUE email index (B11) — the duplicate
 * check below is application-level only, matching the pre-existing behaviour.
 *
 * `toPublicClient` is the single read serializer for client responses. It
 * intentionally OMITS dob / usiNumber / visaStatus: role-based visibility for
 * those PII fields is pending business decision B8, so no projection is shipped
 * in M1.3 (fail closed). The values are still persisted on write.
 */

import { collection, safeObjectId } from "@/lib/db";
import { isValidDate } from "@/lib/master-validation";

export interface ValidationError {
  code: string;
  message: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim and lowercase an email value for storage and deduplication. */
export function normalizeEmail(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

/** Basic email format check; the caller decides how to report failures. */
export function isValidEmail(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return EMAIL_PATTERN.test(v.trim());
}

/** Trim a new optional string field; empty/missing values become `null`. */
export function normalizeOptionalString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/** ISO/parseable date validation, reusing the master-data helper pattern. */
export function isValidDateString(v: unknown): boolean {
  return isValidDate(v);
}

/** Format-only ObjectId check for `referredByStudentId` (never throws). */
export function isValidObjectIdString(v: unknown): boolean {
  return typeof v === "string" && safeObjectId(v) !== null;
}

/** Referential check that a referral target exists in `clients`. */
export async function referencedClientExists(v: unknown): Promise<boolean> {
  const id = typeof v === "string" ? safeObjectId(v) : null;
  if (!id) return false;
  const clients = await collection("clients");
  const found = await clients.findOne({ _id: id }, { projection: { _id: 1 } });
  return found !== null;
}

/**
 * Application-level email uniqueness check (NOT a DB constraint — B11 keeps
 * `idx_clients_email` non-unique). `excludeId` supports PATCH of the same row.
 * Mirrors `isQualificationCodeUnique` in `master-validation.ts`.
 */
export async function isClientEmailUnique(
  email: string,
  excludeId?: string,
): Promise<boolean> {
  const clients = await collection("clients");
  const filter: Record<string, unknown> = { email: normalizeEmail(email) };
  if (excludeId) {
    const oid = safeObjectId(excludeId);
    if (oid) filter._id = { $ne: oid };
  }
  return (await clients.findOne(filter, { projection: { _id: 1 } })) === null;
}

const CONTACT_TYPES = new Set(["phone", "email", "whatsapp"]);

/** Normalize a `contacts` array; drop malformed entries, never throw. */
export function normalizeContacts(v: unknown): Array<{
  label: string;
  type: "phone" | "email" | "whatsapp";
  value: string;
  primary: boolean;
}> {
  if (!Array.isArray(v)) return [];
  const out: Array<{
    label: string;
    type: "phone" | "email" | "whatsapp";
    value: string;
    primary: boolean;
  }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const type = String(raw.type ?? "");
    if (!CONTACT_TYPES.has(type)) continue;
    const value = normalizeOptionalString(raw.value);
    if (value === null) continue;
    out.push({
      label: normalizeOptionalString(raw.label) ?? type,
      type: type as "phone" | "email" | "whatsapp",
      value,
      primary: raw.primary === true,
    });
  }
  return out;
}

/** Normalize an `addresses` array; drop empty/malformed entries, never throw. */
export function normalizeAddresses(v: unknown): Array<{
  label: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primary: boolean;
}> {
  if (!Array.isArray(v)) return [];
  const out: Array<{
    label: string;
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    primary: boolean;
  }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const street = normalizeOptionalString(raw.street);
    const city = normalizeOptionalString(raw.city);
    const state = normalizeOptionalString(raw.state);
    const postalCode = normalizeOptionalString(raw.postalCode);
    const country = normalizeOptionalString(raw.country);
    // Keep the entry only if it carries at least one real address part.
    if (street === null && city === null && state === null && postalCode === null && country === null) {
      continue;
    }
    out.push({
      label: normalizeOptionalString(raw.label) ?? "Home",
      street: street ?? "",
      city: city ?? "",
      state: state ?? "",
      postalCode: postalCode ?? "",
      country: country ?? "",
      primary: raw.primary === true,
    });
  }
  return out;
}

/**
 * Canonical read serializer shared by all client endpoints. Legacy documents
 * lacking optional fields remain valid (missing -> "" / null defaults).
 *
 * PII fields dob / usiNumber / visaStatus are deliberately NOT returned until
 * B8 decides role visibility (fail closed in M1.3).
 */
export function toPublicClient(doc: Record<string, any>): Record<string, unknown> {
  return {
    id: String(doc._id),
    legalName: doc.legalName,
    preferredName: doc.preferredName ?? "",
    email: doc.email,
    phone: doc.phone ?? "",
    status: doc.status ?? "Prospect",
    contacts: doc.contacts ?? [],
    addresses: doc.addresses ?? [],
    sourceAgentId: doc.sourceAgentId ?? null,
    notes: doc.notes ?? "",
    referredByStudentId: doc.referredByStudentId ?? null,
    externalReferrerName: doc.externalReferrerName ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt ?? null,
  };
}
