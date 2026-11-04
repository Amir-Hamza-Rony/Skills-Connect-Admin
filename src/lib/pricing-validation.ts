/**
 * Shared validation helpers for pricing and commission master data.
 *
 * Used by the dedicated pricing/commission API routes. Keeps validation
 * consistent across price categories, price lists, additional fees and
 * commission rules.
 */

import { NextResponse } from "next/server";
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

export function normalizeCode(v: unknown): string {
  return String(v ?? "").trim().toUpperCase();
}

export const VALID_CURRENCIES = new Set([
  "AUD",
  "BDT",
  "USD",
  "GBP",
  "EUR",
  "INR",
]);

export function isValidCurrency(v: unknown): v is string {
  return typeof v === "string" && VALID_CURRENCIES.has(v);
}

export function isValidDate(v: unknown): boolean {
  if (typeof v !== "string" || !v.trim()) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

export function isPositiveAmount(v: unknown): boolean {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

export function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export async function isPriceCategoryCodeUnique(
  code: string,
  excludeId?: string,
): Promise<boolean> {
  const coll = await collection("price_categories");
  const filter: Record<string, unknown> = { code };
  if (excludeId) {
    const oid = safeObjectId(excludeId);
    if (oid) filter._id = { $ne: oid };
  }
  return !(await coll.findOne(filter));
}

export async function priceListOverlaps(
  qualificationId: any,
  priceCategoryId: any,
  effectiveFrom: Date,
  effectiveTo: Date | null,
  excludeId?: any,
): Promise<boolean> {
  const coll = await collection("price_lists");
  const newEnd = effectiveTo ?? new Date("9999-12-31");
  const filter: Record<string, unknown> = {
    qualificationId,
    priceCategoryId,
    status: "active",
  };
  if (excludeId) {
    filter._id = { $ne: excludeId };
  }
  const candidates = await coll.find(filter).toArray();
  return candidates.some((c: any) => {
    const cStart = c.effectiveFrom ? new Date(c.effectiveFrom) : new Date(0);
    const cEnd = c.effectiveTo ? new Date(c.effectiveTo) : new Date("9999-12-31");
    return cStart <= newEnd && cEnd >= effectiveFrom;
  });
}

export async function validateReferencesExist(
  ids: Array<{ collection: string; id: string; label: string }>,
): Promise<{ ok: boolean; label?: string }> {
  for (const { collection: collName, id, label } of ids) {
    const oid = safeObjectId(id);
    if (!oid) return { ok: false, label };
    const coll = await collection(collName);
    const doc = await coll.findOne({ _id: oid });
    if (!doc) return { ok: false, label };
  }
  return { ok: true };
}
