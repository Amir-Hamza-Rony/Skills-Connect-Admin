/**
 * POST /api/auth/logout
 * Revokes the refresh token's family and clears the cookie.
 */

import { NextRequest, NextResponse } from "next/server";
import { collection } from "@/lib/db";
import { clearRefreshCookie, getRefreshToken, hashRefreshToken } from "@/lib/api-auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const token = await getRefreshToken();
  if (token) {
    const tokens = await collection("refresh_tokens");
    const tokenHash = hashRefreshToken(token);
    const tokenDoc = await tokens.findOne({ tokenHash });
    if (tokenDoc) {
      // Revoke the whole family — mirrors the Express backend's logout behaviour.
      await tokens.updateMany({ userId: tokenDoc.userId }, { $set: { revoked: true } });
    }
  }
  await clearRefreshCookie();
  return NextResponse.json({ ok: true });
}
