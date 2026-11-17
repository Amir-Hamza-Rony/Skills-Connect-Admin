/**
 * Validation helpers for client (Student) create/update operations.
 *
 * M1.2 foundation only: these are pure/DB-read helpers following the existing
 * `master-validation.ts` convention. No route calls them yet (M1.3), and no
 * dependency was added. Deliberately absent: visa-status enum values (B7),
 * USI format rules (no business rule defined), and email uniqueness (B11).
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
