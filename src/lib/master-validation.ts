/**
 * Validation helpers for master data create/update operations.
 *
 * Used by the generic master API routes so that qualification codes, RTO
 * codes and agent records cannot be duplicated unintentionally, and required
 * fields are enforced before any database write.
 */

import { collection, safeObjectId } from "@/lib/db";

export interface ValidationError {
  code: string;
  message: string;
}

export function requireFields(
  body: Record<string, unknown>,
  fields: string[],
): ValidationError | null {
  for (const f of fields) {
    const v = body[f];
    if (v === undefined || v === null || v === "") {
      return { code: "BAD_REQUEST", message: `${f} is required.` };
    }
  }
  return null;
}

/** Normalise a qualification code: trim and upper-case. */
export function normalizeCode(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

/** Check that a qualification code is unique (excluding an optional id). */
export async function isQualificationCodeUnique(
  code: string,
  excludeId?: string,
): Promise<boolean> {
  const coll = await collection("qualifications");
  const filter: Record<string, unknown> = { code };
  if (excludeId) {
    const oid = safeObjectId(excludeId);
    if (oid) filter._id = { $ne: oid };
  }
  const existing = await coll.findOne(filter);
  return !existing;
}

/** Check that an RTO code is unique (excluding an optional id). */
export async function isRtoCodeUnique(
  code: string,
  excludeId?: string,
): Promise<boolean> {
  const coll = await collection("rtos");
  const filter: Record<string, unknown> = { rtoCode: code };
  if (excludeId) {
    const oid = safeObjectId(excludeId);
    if (oid) filter._id = { $ne: oid };
  }
  const existing = await coll.findOne(filter);
  return !existing;
}

/** Check that an agent name+contact combination is unique (excluding an optional id). */
export async function isAgentUnique(
  name: string,
  contact: string,
  excludeId?: string,
): Promise<boolean> {
  const coll = await collection("agents");
  const filter: Record<string, unknown> = {
    name: name.trim(),
    contact: contact.trim(),
  };
  if (excludeId) {
    const oid = safeObjectId(excludeId);
    if (oid) filter._id = { $ne: oid };
  }
  const existing = await coll.findOne(filter);
  return !existing;
}

/** Validate a date string is a real calendar date. */
export function isValidDate(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}
