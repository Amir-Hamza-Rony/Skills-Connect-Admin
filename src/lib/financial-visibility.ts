/**
 * Role-based financial field visibility for API responses.
 *
 * Security hotfix (F8 / F9 / F10a). This is a NEW helper: it does not modify
 * any of the five protected M0 helpers in `src/middleware/auth.ts`
 * (checkOrderAccess, getAccessibleClientIds, checkClientAccess,
 * maskFinancialFields, filterOrdersByRole).
 *
 * Approved policy:
 *  - SUPER_ADMIN / ADMIN: all financial fields visible.
 *  - BDC: supplier cost, margin and margin percentage hidden; selling price
 *    and revenue aggregates remain visible.
 *  - B2B_AGENT (and any unrecognised non-admin role): all of the above plus
 *    selling price and price-derived revenue aggregates hidden (fail closed).
 *
 * This check deliberately examines every role claim rather than a single
 * primary role. A B2B_AGENT claim must mask price/revenue even on a dual-role
 * account, so central role normalization must not weaken this fail-closed rule.
 *
 * Keys are deleted rather than set to undefined so callers can rely on fields
 * being absent from the serialized JSON. Arrays and nested objects are walked
 * so report rows cannot bypass the policy.
 */

import type { AuthUser } from "@/middleware/auth";

/** Fields revealing partner cost / margin — hidden from BDC and B2B_AGENT. */
const COST_MARGIN_FIELDS = [
  "supplierCostSnapshot",
  "supplierCost",
  "cost",
  "margin",
  "grossMargin",
  "net_profit",
  "gross_profit",
  "percent",
  "marginPercent",
] as const;

/** Fields revealing selling price / revenue — hidden from B2B_AGENT only. */
const PRICE_REVENUE_FIELDS = [
  "sellingPrice",
  "revenue",
  "pipelineValue",
  "invoiced",
  "clientInvoiced",
  "collected",
  "paid",
  "outstanding",
  "overdueAmount",
  "commissionEarned",
  "feeTotal",
] as const;

const COST_MARGIN = new Set<string>(COST_MARGIN_FIELDS);
const PRICE_REVENUE = new Set<string>(PRICE_REVENUE_FIELDS);

function rolesOf(auth: AuthUser): string[] {
  return [auth?.role, ...(auth?.roleNames ?? [])].filter(
    (r): r is string => typeof r === "string",
  );
}

/** Admins see every financial field; used for explicit call-site checks too. */
export function canViewAllFinancials(auth: AuthUser): boolean {
  const roles = rolesOf(auth);
  return roles.includes("SUPER_ADMIN") || roles.includes("ADMIN");
}

/** BDC retains selling price / revenue; B2B_AGENT (or unknown) does not. */
export function canViewPriceAndRevenue(auth: AuthUser): boolean {
  if (canViewAllFinancials(auth)) return true;
  const roles = rolesOf(auth);
  return roles.includes("BDC") && !roles.includes("B2B_AGENT");
}

/**
 * Mutate `value` in place, removing every financial field the caller may not
 * see. Safe to call on plain objects, arrays and nested report structures.
 * BSON values, Dates and Buffers are left untouched.
 */
export function applyFinancialVisibility<T>(auth: AuthUser, value: T): T {
  if (canViewAllFinancials(auth)) return value;
  const hidePriceRevenue = !canViewPriceAndRevenue(auth);

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (node instanceof Date || Buffer.isBuffer(node)) return;
    if (typeof (node as { _bsontype?: unknown })._bsontype === "string") return;

    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (COST_MARGIN.has(key)) {
        delete record[key];
        continue;
      }
      if (hidePriceRevenue && PRICE_REVENUE.has(key)) {
        delete record[key];
        continue;
      }
      visit(record[key]);
    }
  };

  visit(value);
  return value;
}
