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

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  roleNames: string[];
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
      if (authedReq.auth.roleNames.includes("Super Admin")) {
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
        roleNames: payload.roleNames,
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