/**
 * Next.js middleware — protects pages from unauthenticated access.
 * API routes handle their own auth via withAuth/requirePermission.
 *
 * The access token lives in browser memory (lib/api.ts), not a cookie, so the
 * middleware cannot verify it on page navigation. Instead it checks for the
 * httpOnly refresh_token cookie — its presence means the user has an active
 * session. API routes self-authenticate and are skipped here.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC = ["/login", "/api/auth/login", "/api/auth/refresh", "/api/health"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths and static assets
  if (PUBLIC.includes(pathname) || pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  // API routes self-authenticate; skip here
  if (pathname.startsWith("/api/")) return NextResponse.next();

  // An httpOnly refresh_token cookie means the user has an active session.
  // Without it, redirect to login.
  if (!req.cookies.get("refresh_token")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next|favicon.ico|.*\\..*).*)"],
};
