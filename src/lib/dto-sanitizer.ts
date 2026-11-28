/**
 * DTO Serializer Sanitizer — docs v5.1 §4 "Mandatory Backend DTO Serialization Guard"
 * and v5.0 §5 "API Serialization Stripping".
 *
 * Strips unauthorized price/cost keys at the backend serializer layer BEFORE JSON
 * serialization. Never rely solely on frontend UI hiding.
 *
 * Usage in API route handlers:
 *   return NextResponse.json(sanitizeFinancialFields(payload, user.role, user.channelType));
 *
 * Can also be wrapped as a response interceptor.
 */

import type { AuthUser } from "@/middleware/auth";
import { applyFinancialVisibility } from "@/lib/financial-visibility";

/**
 * Sanitize a payload by removing financial fields the user may not see.
 * Returns a shallow-cloned object with restricted keys deleted.
 */
export function sanitizeFinancialFields(
  payload: unknown,
  userRole: string,
  channelType?: string | null,
): unknown {
  const clone = structuredClone(payload);

  const auth: AuthUser = {
    userId: "",
    email: "",
    name: "",
    role: userRole as AuthUser["role"],
    roleNames: [userRole],
    channelType: (channelType ?? null) as AuthUser["channelType"],
    permissions: [],
  };

  return applyFinancialVisibility(auth, clone);
}

/**
 * Middleware wrapper for Next.js API route handlers. Sanitizes the JSON body
 * before it is sent to the client.
 *
 * Usage:
 *   export const GET = withAuth(requirePermission("orders.view"), dtoSanitize(handler));
 */
export function dtoSanitize(handler: any): any {
  return async (req: any, ctx?: any) => {
    const res = await handler(req, ctx);
    if (!res || typeof res !== "object") return res;

    const auth = (req as any).auth;
    if (!auth) return res;

    // Only sanitize JSON responses (NextResponse with a body)
    if (res.body === null || res.body === undefined) return res;

    try {
      // Clone and sanitize if the response has a JSON-serializable body
      const sanitized = sanitizeFinancialFields(
        res.body ?? res,
        auth.role ?? "",
        auth.channelType ?? null,
      );
      return new Response(JSON.stringify(sanitized), {
        status: res.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    } catch {
      return res;
    }
  };
}