/**
 * POST /api/auth/refresh
 * Rotates the access token using the httpOnly refresh cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { collection } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/permissions";
import type { RoleName } from "@/lib/types";
import {
  signAccessToken,
  signRefreshToken,
  setRefreshCookie,
  hashRefreshToken,
  getRefreshToken,
} from "@/lib/api-auth";

const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const oldToken = await getRefreshToken();
  if (!oldToken) {
    return NextResponse.json({ error: { code: "NO_REFRESH_TOKEN", message: "No refresh token." } }, { status: 401 });
  }

  const tokens = await collection("refresh_tokens");
  const tokenHash = hashRefreshToken(oldToken);
  const tokenDoc = await tokens.findOne({ tokenHash });

  if (!tokenDoc) {
    return NextResponse.json({ error: { code: "INVALID_REFRESH", message: "Refresh token not found." } }, { status: 401 });
  }

  // Reuse detection: the token existed but was already revoked (rotated or logged out).
  // Revoke the whole family for safety — mirrors the Express backend.
  if (tokenDoc.revoked) {
    await tokens.updateMany({ userId: tokenDoc.userId }, { $set: { revoked: true } });
    return NextResponse.json(
      { error: { code: "REFRESH_REUSE_DETECTED", message: "Session revoked." } },
      { status: 401 },
    );
  }

  // Rotate: mark the current token as used/revoked and issue a successor in the same family.
  await tokens.updateOne({ _id: tokenDoc._id }, { $set: { revoked: true } });

  const users = await collection("users");
  const user = await users.findOne({ _id: tokenDoc.userId });
  if (!user || !user.active) {
    return NextResponse.json({ error: { code: "USER_INACTIVE", message: "User inactive." } }, { status: 401 });
  }

  const roleNames: string[] = user.roleNames ?? [];
  const permissions: string[] = roleNames.flatMap((role) =>
    ROLE_PERMISSIONS[role as RoleName] ?? [],
  );

  const newRefresh = signRefreshToken({ userId: String(user._id) });
  const newHash = hashRefreshToken(newRefresh);
  await tokens.insertOne({
    userId: user._id,
    tokenHash: newHash,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    revoked: false,
  });

  await setRefreshCookie(newRefresh, REFRESH_TTL_SECONDS);

  const accessToken = signAccessToken({
    userId: String(user._id),
    name: user.name,
    email: user.email,
    roleNames,
    permissions,
  });
  return NextResponse.json({ accessToken });
}
