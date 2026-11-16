/**
 * Auth middleware for Next.js API routes.
 *
 * Two usage patterns:
 *   export const GET = withAuth(requirePermission("users.manage"), handler);
 *   export const GET = withAuth(handler);  // just token verification
 *
 * handler receives: (req: AuthedRequest, ctx?: { params?: { id?: string; type?: string } }) => Promise<NextResponse>
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/api-auth";
import type { RoleName } from "@/lib/types";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  full_name?: string;
  role?: RoleName;
  roleNames: string[];
  agency_name?: string | null;
  b2b_tier?: "SILVER" | "GOLD" | "PLATINUM";
  default_commission_pct?: number;
  permissions: string[];
}

export interface AuthedRequest extends NextRequest {
  auth?: AuthUser;
}

export type RouteHandler = (
  req: AuthedRequest,
  ctx?: any,
) => Promise<NextResponse>;

function getToken(req: NextRequest): string | null {
  const ah = req.headers.get("authorization");
  if (!ah || !ah.startsWith("Bearer ")) return null;
  return ah.slice(7);
}

function requirePermission(permission: string) {
  return function (handler: RouteHandler): RouteHandler {
    return async (req, ctx) => {
      const authedReq = req as AuthedRequest;
      if (!authedReq.auth) {
        return NextResponse.json(
          { error: { code: "UNAUTHENTICATED", message: "Not signed in." } },
          { status: 401 },
        );
      }
      if (authedReq.auth.roleNames.includes("SUPER_ADMIN")) {
        return handler(authedReq, ctx);
      }
      if (!authedReq.auth.permissions.includes(permission)) {
        return NextResponse.json(
          { error: { code: "FORBIDDEN", message: `Missing permission: ${permission}` } },
          { status: 403 },
        );
      }
      return handler(authedReq, ctx);
    };
  };
}

function verifyToken(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    const token = getToken(req);
    if (!token) {
      return Promise.resolve(
        NextResponse.json(
          { error: { code: "UNAUTHENTICATED", message: "Not signed in." } },
          { status: 401 },
        ),
      );
    }
    try {
      const payload = verifyAccessToken(token);
      (req as AuthedRequest).auth = {
        userId: payload.userId,
        email: payload.email,
        name: payload.name,
        full_name: payload.full_name,
        role: (payload.role as RoleName | undefined),
        roleNames: payload.roleNames,
        agency_name: payload.agency_name ?? null,
        b2b_tier: payload.b2b_tier,
        default_commission_pct: payload.default_commission_pct,
        permissions: payload.permissions,
      };
      return handler(req as AuthedRequest, ctx);
    } catch {
      return Promise.resolve(
        NextResponse.json(
          { error: { code: "UNAUTHENTICATED", message: "Invalid or expired token." } },
          { status: 401 },
        ),
      );
    }
  };
}

/**
 * withAuth(permission, handler) OR withAuth(handler)
 * Detects whether the first argument is a string (permission) or a function (handler).
 */
export function withAuth(
  a: string | RouteHandler,
  b?: RouteHandler,
): RouteHandler {
  if (typeof a === "string") {
    // withAuth(permission, handler) — verify the token first, then check the
    // permission. Composing verifyToken around requirePermission ensures
    // req.auth is populated before the permission check runs.
    if (!b) throw new Error("withAuth(permission, handler) requires a handler");
    return verifyToken(requirePermission(a)(b));
  }
  // withAuth(handler) — just token verification
  return verifyToken(a);
}

export { requirePermission };

/**
 * Check whether the authenticated user may access a given order.
 *
 * - SUPER_ADMIN / ADMIN: all orders.
 * - BDC: orders where bdc_id === userId or salesAgentId === userId.
 * - B2B_AGENT: orders where b2b_agent_id === userId or sourceAgentId === userId.
 *
 * Returns true if access is allowed, false otherwise.
 */
export function checkOrderAccess(auth: AuthUser, order: any): boolean {
  const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
  const userId = auth.userId;

  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;

  if (role === "BDC") {
    return (
      order.bdc_id && String(order.bdc_id) === userId
    ) || (
      order.salesAgentId && String(order.salesAgentId) === userId
    );
  }

  if (role === "B2B_AGENT") {
    return (
      order.b2b_agent_id && String(order.b2b_agent_id) === userId
    ) || (
      order.sourceAgentId && String(order.sourceAgentId) === userId
    );
  }

  return false;
}

/**
 * Check whether the authenticated user may access a given client.
 * Clients do not yet have an owner field in Phase 0; scoping is applied at
 * the list level via the `sourceAgentId`/`salesAgentId` mapping in Phase 1.
 * For Phase 0, SUPER_ADMIN and ADMIN see all clients; BDC/B2B_AGENT see
 * only clients linked to their own agent id.
 */
export function checkClientAccess(auth: AuthUser, client: any): boolean {
  const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
  const userId = auth.userId;

  if (role === "SUPER_ADMIN" || role === "ADMIN") return true;

  if (role === "BDC") {
    return (
      client.sourceAgentId && String(client.sourceAgentId) === userId
    );
  }

  if (role === "B2B_AGENT") {
    return (
      client.sourceAgentId && String(client.sourceAgentId) === userId
    );
  }

  return false;
}

/**
 * Mask financial fields on a record based on the requesting user's role.
 * - SUPER_ADMIN / ADMIN: no masking.
 * - BDC: hides supplierCostSnapshot and any derived margin/net_profit.
 * - B2B_AGENT: hides supplierCostSnapshot and any derived margin/net_profit.
 *
 * Mutates and returns the record (caller should apply before serialization).
 */
export function maskFinancialFields(auth: AuthUser, record: any): any {
  const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
  if (role === "SUPER_ADMIN" || role === "ADMIN") return record;

  const fieldsToMask = [
    "supplierCostSnapshot",
    "supplierCost",
    "margin",
    "net_profit",
    "gross_profit",
    "grossMargin",
  ];
  for (const f of fieldsToMask) {
    if (f in record) record[f] = undefined;
  }
  // Also mask nested supplier-cost-like objects.
  if (record.byCurrency) {
    for (const cur of Object.keys(record.byCurrency)) {
      const curRec = record.byCurrency[cur];
      for (const f of ["supplierCost", "margin", "net_profit", "gross_profit"]) {
        if (f in curRec) curRec[f] = undefined;
      }
    }
  }
  if (record.totals) {
    for (const f of fieldsToMask) {
      if (f in record.totals) record.totals[f] = undefined;
    }
  }
  return record;
}

/**
 * Filter an array of orders to only those the authenticated user may access.
 * - SUPER_ADMIN / ADMIN: all orders.
 * - BDC: orders where bdc_id === userId or salesAgentId === userId.
 * - B2B_AGENT: orders where b2b_agent_id === userId or sourceAgentId === userId.
 */
export function filterOrdersByRole(auth: AuthUser, orders: any[]): any[] {
  const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
  const userId = auth.userId;
  if (role === "SUPER_ADMIN" || role === "ADMIN") return orders;

  return orders.filter((o: any) => {
    if (role === "BDC") {
      return (
        (o.bdc_id && String(o.bdc_id) === userId) ||
        (o.salesAgentId && String(o.salesAgentId) === userId)
      );
    }
    if (role === "B2B_AGENT") {
      return (
        (o.b2b_agent_id && String(o.b2b_agent_id) === userId) ||
        (o.sourceAgentId && String(o.sourceAgentId) === userId)
      );
    }
    return false;
  });
}