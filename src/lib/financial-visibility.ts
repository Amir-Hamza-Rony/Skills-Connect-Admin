/**
 * Role-based financial field visibility for API responses.
 *
 * Security hotfix. Implements the 4-layer controlled pricing visibility matrix
 * from docs v5.1 §1 and v5.0 §2.
 *
 * Approved policy:
 *   - SUPER_ADMIN / ACCOUNTS: all 4 layers visible (True RTO Cost, Approved Internal
 *     Floor, B2B Wholesale, B2C Retail).
 *   - OPS_ADMIN: True RTO Cost hidden; Approved Internal Cost, B2B Wholesale,
 *     B2C Retail view-only.
 *   - SALES_BDC: True RTO Cost hidden; Approved Internal Cost view-only;
 *     B2C Retail visible (quote/apply); B2B Wholesale hidden.
 *   - EXTERNAL_BROKER: only assigned B2B Wholesale tier visible; everything
 *     else hidden.
 *   - CANDIDATE (IN_HOUSE_B2C): own invoice only; all cost layers hidden.
 *   - CANDIDATE (EXTERNAL_BROKER): ALL pricing, fees, invoice tabs hidden.
 *
 * Keys are deleted rather than set to undefined so fields are absent from JSON.
 * Arrays and nested objects are walked so report rows cannot bypass the policy.
 */

import type { AuthUser } from "@/middleware/auth";

/** Fields revealing True RTO Base Cost — hidden from everyone except SUPER_ADMIN/ACCOUNTS. */
const TRUE_RTO_COST_FIELDS = [
  "true_rto_cost",
  "snap_true_rto_cost",
  "supplierCostSnapshot",
  "supplierCost",
  "cost",
  "rtoFee",
] as const;

/** Fields revealing Approved Internal Cost — hidden from non-admin/non-ops. */
const APPROVED_INTERNAL_FIELDS = [
  "approved_internal_cost",
  "snap_approved_internal_cost",
  "approvedInternalCost",
  "margin",
  "grossMargin",
  "net_profit",
  "gross_profit",
  "percent",
  "marginPercent",
] as const;

/** Fields revealing B2B Wholesale Price — hidden from BDC, candidates, non-broker. */
const B2B_WHOLESALE_FIELDS = [
  "fixed_b2b_price",
  "b2b_wholesale_price",
  "b2bPrice",
  "wholesalePrice",
] as const;

/** Fields revealing B2C Retail Price / revenue — hidden from B2B brokers and B2B candidates. */
const B2C_RETAIL_FIELDS = [
  "sellingPrice",
  "b2c_retail_price",
  "b2cPrice",
  "retailPrice",
  "revenue",
  "pipelineValue",
  "invoiced",
  "clientInvoiced",
  "collected",
  "unallocated",
  "unallocatedAmount",
  "paid",
  "outstanding",
  "overdue",
  "overdueAmount",
  "totalOutstanding",
  "totalOverdue",
  "commissionEarned",
  "feeTotal",
  "amount",
] as const;

/** Invoice-related fields — hidden from B2B candidates entirely. */
const INVOICE_FIELDS = [
  "invoices",
  "invoice",
  "invoiceNumber",
  "snap_sale_price",
  "snap_additional_fees",
  "snap_discount",
  "snap_total_billed",
] as const;

const TRUE_RTO_COST = new Set<string>(TRUE_RTO_COST_FIELDS);
const APPROVED_INTERNAL = new Set<string>(APPROVED_INTERNAL_FIELDS);
const B2B_WHOLESALE = new Set<string>(B2B_WHOLESALE_FIELDS);
const B2C_RETAIL = new Set<string>(B2C_RETAIL_FIELDS);
const INVOICE = new Set<string>(INVOICE_FIELDS);

function rolesOf(auth: AuthUser): string[] {
  return [auth?.role, ...(auth?.roleNames ?? [])].filter(
    (r): r is string => typeof r === "string",
  );
}

/** Admins (SUPER_ADMIN / ACCOUNTS / ADMIN) see every financial field. */
export function canViewAllFinancials(auth: AuthUser): boolean {
  const roles = rolesOf(auth);
  return roles.includes("SUPER_ADMIN") || roles.includes("ACCOUNTS") || roles.includes("ADMIN");
}

/** Can view Approved Internal Cost (SUPER_ADMIN, ACCOUNTS, ADMIN, OPS_ADMIN, SALES_BDC). */
export function canViewApprovedInternal(auth: AuthUser): boolean {
  const roles = rolesOf(auth);
  if (canViewAllFinancials(auth)) return true;
  return roles.includes("OPS_ADMIN") || roles.includes("SALES_BDC");
}

/** Can view B2C retail price / revenue (SUPER_ADMIN, ACCOUNTS, ADMIN, OPS_ADMIN, SALES_BDC, BDC). */
export function canViewPriceAndRevenue(auth: AuthUser): boolean {
  if (canViewAllFinancials(auth)) return true;
  const roles = rolesOf(auth);
  return (
    roles.includes("OPS_ADMIN") ||
    roles.includes("SALES_BDC") ||
    (roles.includes("BDC") && !roles.includes("B2B_AGENT"))
  );
}

/** Can view B2B wholesale price (SUPER_ADMIN, ACCOUNTS, OPS_ADMIN, EXTERNAL_BROKER assigned tier). */
export function canViewB2BWholesale(auth: AuthUser): boolean {
  const roles = rolesOf(auth);
  if (canViewAllFinancials(auth)) return true;
  if (roles.includes("OPS_ADMIN")) return true;
  if (roles.includes("EXTERNAL_BROKER") || roles.includes("B2B_AGENT")) return true;
  return false;
}

/** B2B candidate (channel_type EXTERNAL_BROKER) sees NO pricing/invoice data. */
export function isB2BCandidate(auth: AuthUser): boolean {
  const roles = rolesOf(auth);
  return roles.includes("CANDIDATE") && auth.channelType === "EXTERNAL_BROKER";
}

/**
 * Mutate `value` in place, removing every financial field the caller may not see.
 * Safe to call on plain objects, arrays and nested report structures.
 */
export function applyFinancialVisibility<T>(auth: AuthUser, value: T): T {
  if (canViewAllFinancials(auth)) return value;

  const roles = rolesOf(auth);
  const hideTrueRto = !roles.includes("SUPER_ADMIN") && !roles.includes("ACCOUNTS") && !roles.includes("ADMIN");
  const hideApprovedInternal = !canViewApprovedInternal(auth);
  const hideB2C = !canViewPriceAndRevenue(auth);
  const hideB2B = !canViewB2BWholesale(auth);
  const hideInvoices = isB2BCandidate(auth);

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
      if (hideTrueRto && TRUE_RTO_COST.has(key)) {
        delete record[key];
        continue;
      }
      if (hideApprovedInternal && APPROVED_INTERNAL.has(key)) {
        delete record[key];
        continue;
      }
      if (hideB2B && B2B_WHOLESALE.has(key)) {
        delete record[key];
        continue;
      }
      if (hideB2C && B2C_RETAIL.has(key)) {
        delete record[key];
        continue;
      }
      if (hideInvoices && INVOICE.has(key)) {
        delete record[key];
        continue;
      }
      visit(record[key]);
    }
  };

  visit(value);
  return value;
}