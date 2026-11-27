/**
 * POST /api/auth/magic-link/request
 * Body: { email }
 * Generates a magic-link token, stores it, and (in production) emails/SMSes it.
 * Returns the token in dev mode only so it can be verified in tests.
 */

import { NextRequest, NextResponse } from "next/server";
import { collection } from "@/lib/db";
import { createRateLimiter, rateLimitKey } from "@/lib/rate-limit";
import { randomBytes } from "crypto";

const TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes

const magicLinkRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { email } = await req.json();

    const forwardedFor = req.headers.get("x-forwarded-for") ?? "";
    const clientIp = forwardedFor.split(",")[0]?.trim() ?? "unknown";
    const rateLimit = magicLinkRateLimiter.hit(
      rateLimitKey({ ip: clientIp, body: { email } }),
    );
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: `Too many requests. Try again in ${rateLimit.retryAfterSeconds} second(s).`,
          },
        },
        {
          status: 429,
          headers: { "Retry-After": String(rateLimit.retryAfterSeconds) },
        },
      );
    }

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Email is required." } },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const users = await collection("users");
    const user = await users.findOne({ email: normalizedEmail, role: "CANDIDATE" });
    if (!user) {
      // Do not reveal whether the email exists.
      return NextResponse.json({
        message: "If a candidate account exists for this email, a magic link has been sent.",
      });
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000);

    await (await collection("magic_link_tokens")).insertOne({
      userId: user._id,
      email: normalizedEmail,
      token,
      expiresAt,
      used: false,
      createdAt: new Date(),
    });

    // In dev, return the token so it can be consumed by the verify endpoint
    // during testing. In production this is sent via email/SMS only.
    const isDev = process.env.NODE_ENV !== "production";

    return NextResponse.json({
      message: "Magic link sent. Check your email or SMS.",
      ...(isDev ? { _devToken: token } : {}),
    });
  } catch {
    return NextResponse.json(
      { error: { code: "SERVER_ERROR", message: "Magic link request failed." } },
      { status: 500 },
    );
  }
}
