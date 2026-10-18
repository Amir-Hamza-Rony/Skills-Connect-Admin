import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { SignJWT, jwtVerify, errors as joseErrors } from "jose";

import { env } from "../config/env.js";
import type { Permission } from "../services/permissions.js";

/**
 * Token strategy (D1):
 *
 * - ACCESS token = short-lived signed JWT (15 min). Stateless, kept in memory
 *   by the SPA and never written to localStorage, so an XSS payload cannot
 *   simply read it back out of persistent storage.
 * - REFRESH token = 256-bit opaque random string in an httpOnly cookie. It MUST
 *   be opaque rather than a JWT: revocation and reuse detection require a server
 *   lookup, so a self-contained token would buy nothing while leaking the
 *   session state into the browser.
 */

const b64url = (buf: Buffer): string => buf.toString("base64url");

export interface AccessTokenInput {
  sub: string;
  roles: string[];
  perms: Permission[];
  /** Must match the user's current `tokenVersion` for the token to be accepted. */
  ver: number;
}

/** What `verifyAccessToken` resolves to — adds the issued-at stamp. */
export interface AccessTokenPayload extends AccessTokenInput {
  /** Issued-at as a Unix timestamp in seconds. */
  issuedAt: number;
}

/** HMAC key material derived from the configured secret. */
function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(input: AccessTokenInput): Promise<string> {
  const ttlSeconds = env.ACCESS_TOKEN_TTL_MIN * 60;
  return new SignJWT({ roles: input.roles, perms: input.perms, ver: input.ver })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(input.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(env.JWT_ACCESS_SECRET));
}

export class InvalidTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTokenError";
  }
}

export async function verifyAccessToken(token: string): Promise<AccessTokenPayload> {
  try {
    const { payload } = await jwtVerify(token, key(env.JWT_ACCESS_SECRET), {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ["HS256"],
    });
    if (typeof payload.sub !== "string") throw new InvalidTokenError("Token has no subject");
    return {
      sub: payload.sub,
      roles: Array.isArray(payload.roles) ? payload.roles.filter((r): r is string => typeof r === "string") : [],
      perms: Array.isArray(payload.perms) ? (payload.perms as Permission[]) : [],
      issuedAt: payload.iat ?? 0,
      ver: typeof payload.ver === "number" ? payload.ver : -1,
    };
  } catch (err) {
    if (err instanceof InvalidTokenError) throw err;
    if (err instanceof joseErrors.JWTExpired) throw new InvalidTokenError("Access token expired");
    throw new InvalidTokenError("Access token is invalid");
  }
}

/* ---------------- Refresh tokens ---------------- */

/** A refresh token and the hash that is persisted in its place. */
export interface GeneratedRefreshToken {
  /** Given to the browser. Never stored, never logged. */
  raw: string;
  /** SHA-256 hex — what goes in `refresh_tokens.token_hash`. */
  hash: string;
}

export function generateRefreshToken(): GeneratedRefreshToken {
  const raw = b64url(randomBytes(32));
  return { raw, hash: hashRefreshToken(raw) };
}

/**
 * SHA-256 is correct here (not argon2): the input is already 256 bits of
 * cryptographically random data, so there is nothing to brute-force, and the
 * lookup must be fast because it happens on every refresh.
 */
export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** Constant-time compare of two hex digests of equal length. */
export function digestsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Random identifier grouping one session's rotation chain. */
export function newFamilyId(): string {
  return b64url(randomBytes(16));
}