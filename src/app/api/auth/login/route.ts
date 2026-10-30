/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { user, accessToken } and sets httpOnly refresh cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { collection } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import type { RoleName } from "@/lib/types";
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  setRefreshCookie,
  hashPassword,
  hashRefreshToken,
} from "@/lib/api-auth";
import { createRateLimiter, rateLimitKey } from "@/lib/rate-limit";

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

// Fixed window: 5 attempts per 15 minutes per IP+email — matches Express backend.
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { email, password } = await req.json();

    // Rate limit before any database work — matches Express backend.
    const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
    const clientIp = forwardedFor.split(",")[0]?.trim() ?? "unknown";
    const rateLimit = loginRateLimiter.hit(rateLimitKey({ ip: clientIp, body: { email } }));
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: `Too many sign-in attempts. Try again in ${rateLimit.retryAfterSeconds} second(s).`,
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(rateLimit.retryAfterSeconds),
          },
        },
      );
    }

    if (!email || !password) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Email and password are required." } },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase();
    const users = await collection("users");
    const user = await users.findOne({ email: normalizedEmail });
    if (!user) {
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
        { status: 401 },
      );
    }

    if (!user.active) {
      return NextResponse.json(
        { error: { code: "ACCOUNT_INACTIVE", message: "This account is deactivated." } },
        { status: 403 },
      );
    }

    const lockedUntil = user.lockedUntil ? new Date(user.lockedUntil) : null;
    if (lockedUntil && lockedUntil > new Date()) {
      return NextResponse.json(
        { error: { code: "ACCOUNT_LOCKED", message: "Account is locked. Try again later." } },
        { status: 423 },
      );
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) {
      const failed = (user.failedLoginCount ?? 0) + 1;
      const update: Record<string, unknown> = { failedLoginCount: failed };
      if (failed >= 10) {
        update.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }
      await users.updateOne({ _id: user._id }, { $set: update });
      return NextResponse.json(
        { error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password." } },
        { status: 401 },
      );
    }

    await users.updateOne(
      { _id: user._id },
      { $set: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } },
    );

    // Load roles + permissions (mirrors the Express backend, which embeds
    // `roles`/`perms` in the access token so /me and requirePermission work).
    const roleNames: string[] = user.roleNames ?? [];
    const permissions: string[] = roleNames.flatMap((role) =>
      ROLE_PERMISSIONS[role as RoleName] ?? [],
    );

    const accessToken = signAccessToken({
      userId: String(user._id),
      name: user.name,
      email: user.email,
      roleNames,
      permissions,
    });
    const refreshToken = signRefreshToken({ userId: String(user._id) });

    const refreshHash = hashRefreshToken(refreshToken);
    await (await collection("refresh_tokens")).insertOne({
      userId: user._id,
      tokenHash: refreshHash,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
      revoked: false,
    });

    await setRefreshCookie(refreshToken, REFRESH_TTL_SECONDS);

    return NextResponse.json({
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        roleNames,
        permissions,
      },
      accessToken,
    });
  } catch {
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message: "Login failed." } },
      { status: 500 },
    );
  }
}
