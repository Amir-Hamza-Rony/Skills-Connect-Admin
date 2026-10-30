/**
 * POST /api/auth/logout-all — signs the user out of every device.
 * Revokes all refresh tokens for the current user.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";
import { clearRefreshCookie } from "@/lib/api-auth";

export const POST = withAuth(
  async (req) => {
    const auth = req.auth;
    if (!auth) {
      return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Not signed in." } }, { status: 401 });
    }

    const tokens = await collection("refresh_tokens");
    const result = await tokens.updateMany(
      { userId: toObjectId(auth.userId), revoked: false },
      { $set: { revoked: true } },
    );

    await clearRefreshCookie();

    return NextResponse.json({ revoked: result.modifiedCount });
  },
);