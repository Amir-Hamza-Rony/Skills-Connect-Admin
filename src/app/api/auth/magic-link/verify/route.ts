/**
 * POST /api/auth/magic-link/verify
 * Body: { token }
 * Verifies a magic-link token, issues a CANDIDATE JWT, and sets the refresh cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { collection } from "@/lib/db";
import { resolvePrimaryRole, ROLE_PERMISSIONS } from "@/lib/permissions";
import type { RoleName } from "@/lib/types";
import {
  signAccessToken,
  signRefreshToken,
  setRefreshCookie,
  hashRefreshToken,
} from "@/lib/api-auth";

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { token } = await req.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Token is required." } },
        { status: 400 },
      );
    }

    const tokens = await collection("magic_link_tokens");
    const record = await tokens.findOne({ token, used: false });
    if (!record) {
      return NextResponse.json(
        { error: { code: "INVALID_TOKEN", message: "Invalid or expired magic link." } },
        { status: 401 },
      );
    }

    const now = new Date();
    if (record.expiresAt && record.expiresAt < now) {
      return NextResponse.json(
        { error: { code: "TOKEN_EXPIRED", message: "Magic link has expired." } },
        { status: 401 },
      );
    }

    const users = await collection("users");
    const user = await users.findOne({ _id: record.userId });
    if (!user || !user.active) {
      return NextResponse.json(
        { error: { code: "ACCOUNT_INACTIVE", message: "This account is deactivated." } },
        { status: 403 },
      );
    }

    // Mark token as used.
    await tokens.updateOne({ _id: record._id }, { $set: { used: true, usedAt: now } });

    const roleNames: string[] = user.roleNames ?? [];
    const permissions: string[] = roleNames.flatMap((role) =>
      ROLE_PERMISSIONS[role as RoleName] ?? [],
    );
    const primaryRole = resolvePrimaryRole({ role: user.role, roleNames }) ?? undefined;

    const accessToken = signAccessToken({
      userId: String(user._id),
      name: user.name,
      email: user.email,
      full_name: user.full_name ?? user.name,
      role: primaryRole,
      roleNames,
      agency_name: user.agency_name ?? null,
      b2b_tier: user.b2b_tier ?? "SILVER",
      default_commission_pct: user.default_commission_pct ?? 0,
      channelType: (user.channelType ?? null) as "IN_HOUSE_B2C" | "EXTERNAL_BROKER" | null,
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
        full_name: user.full_name ?? user.name,
        email: user.email,
        role: primaryRole,
        roleNames,
        channelType: user.channelType ?? null,
        agency_name: user.agency_name ?? null,
        b2b_tier: user.b2b_tier ?? "SILVER",
        default_commission_pct: user.default_commission_pct ?? 0,
        permissions,
      },
      accessToken,
      redirect: "/applicant",
    });
  } catch {
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message: "Magic link verification failed." } },
      { status: 500 },
    );
  }
}
