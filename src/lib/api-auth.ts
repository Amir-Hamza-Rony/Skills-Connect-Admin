/**
 * Auth helpers for Next.js API routes.
 *
 * JWT access token (15 min) + opaque refresh token in httpOnly cookie.
 * JWT uses HMAC-SHA256 via Node crypto (no jsonwebtoken dependency).
 * Passwords hashed with argon2id (matching Express backend).
 */

import { cookies } from "next/headers";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import argon2 from "argon2";

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET!;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const ACCESS_TTL_MIN = Number(process.env.ACCESS_TOKEN_TTL_MIN ?? 15);
const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required.");
}

function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function signPayload(payload: object, secret: string): string {
  const header = base64Url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = base64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${header}.${body}`;
  const sig = createHmac("sha256", secret).update(signingInput).digest();
  return `${signingInput}.${base64Url(sig)}`;
}

function verifyPayload(token: string, secret: string): object | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    const signingInput = `${headerB64}.${bodyB64}`;
    const expected = createHmac("sha256", secret).update(signingInput).digest();
    const actual = Buffer.from(sigB64.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    if (!timingSafeEqual(expected, actual)) return null;
    const json = Buffer.from(bodyB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** Hash a password with argon2id. */
export async function hashPassword(password: string): Promise<{ hash: string }> {
  const hash = await argon2.hash(password);
  return { hash };
}

/** Verify a password against stored argon2id hash. */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

/** Hash a refresh token with SHA-256 (deterministic, so it can be looked up by hash).
 *
 * Refresh tokens are already 256 bits of cryptographically random data, so
 * argon2 is unnecessary — SHA-256 is sufficient and lets us look up the token
 * by its hash, which argon2 (randomised per call) does not support.
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sign an access token. */
export function signAccessToken(payload: object): string {
  return signPayload(
    { ...payload, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_MIN * 60 },
    ACCESS_SECRET,
  );
}

/** Sign a refresh token. A random `nonce` guarantees that two rotations in the
 * same second still produce different token values, so cookie rotation is
 * observable on the client. */
export function signRefreshToken(payload: object): string {
  const nonce = randomBytes(8).toString("hex");
  return signPayload(
    {
      ...payload,
      exp: Math.floor(Date.now() / 1000) + REFRESH_TTL_DAYS * 86400,
      nbf: Math.floor(Date.now() / 1000),
      nonce,
    },
    REFRESH_SECRET,
  );
}

/** Verify an access token. */
export function verifyAccessToken(token: string): {
  userId: string;
  email: string;
  name: string;
  roleNames: string[];
  permissions: string[];
} {
  const payload = verifyPayload(token, ACCESS_SECRET);
  if (!payload) throw new Error("Invalid token");
  return {
    userId: String((payload as { userId: unknown }).userId),
    email: String((payload as { email: unknown }).email),
    name: String((payload as { name: unknown }).name ?? ""),
    roleNames: Array.isArray((payload as { roleNames: unknown }).roleNames)
      ? (payload as { roleNames: unknown[] }).roleNames.filter((r): r is string => typeof r === "string")
      : [],
    permissions: Array.isArray((payload as { permissions: unknown }).permissions)
      ? (payload as { permissions: unknown[] }).permissions.filter((p): p is string => typeof p === "string")
      : [],
  };
}

/** Get the refresh token from cookies. */
export async function getRefreshToken(): Promise<string | null> {
  try {
    const store = await cookies();
    return store.get("refresh_token")?.value ?? null;
  } catch {
    return null;
  }
}

/** Set the refresh cookie. */
export async function setRefreshCookie(token: string, maxAgeSeconds: number): Promise<void> {
  const store = await cookies();
  store.set("refresh_token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

/** Clear the refresh cookie. */
export async function clearRefreshCookie(): Promise<void> {
  const store = await cookies();
  store.set("refresh_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
