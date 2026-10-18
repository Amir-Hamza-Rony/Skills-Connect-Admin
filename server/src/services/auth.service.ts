import { env } from "../config/env.js";
import { AppError } from "../lib/app-error.js";
import { createRateLimiter } from "../lib/rate-limit.js";
import { dummyVerify, verifyPassword } from "../lib/password.js";
import {
  digestsMatch,
  generateRefreshToken,
  hashRefreshToken,
  newFamilyId,
  signAccessToken,
} from "../lib/tokens.js";
import { User } from "../models/user.model.js";
import { RefreshToken } from "../models/refresh-token.model.js";
import { recordAudit } from "./audit.service.js";
import { resolvePermissions } from "./permissions.js";

/**
 * Login, refresh rotation with reuse detection, and logout (BACKEND-PLAN B2).
 *
 * Refresh rotation is the security-critical part:
 *
 *   login    -> T1 (family F)
 *   refresh  -> T1 becomes used, T2 issued (family F)
 *   refresh  -> T2 becomes used, T3 issued (family F)
 *   refresh  -> T1 presented again  ==  T1 was replayed  =>  revoke ALL of F
 *
 * Reuse can only happen if a token leaked: either the legitimate client replayed
 * it or an attacker stole it. Revoking the whole family logs out both parties,
 * which is the safe outcome — it forces the real user to re-authenticate and
 * surfaces the compromise.
 */

export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  roleNames: string[];
  permissions: ReturnType<typeof resolvePermissions>;
  /** Current token generation — embedded in the access token as `ver`. */
  tokenVersion: number;
}

export interface LoginResult {
  user: AuthenticatedUser;
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Per-account lockout, in addition to the per-IP limiter on the route. */
const accountLimiter = createRateLimiter({
  windowMs: env.ACCOUNT_LOCK_MINUTES * 60 * 1000,
  max: env.ACCOUNT_LOCK_MAX_FAILURES,
});

export function resetAccountLimiter(): void {
  accountLimiter.clearAll();
}

function refreshExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
}

async function loadAuthedUser(userId: string): Promise<AuthenticatedUser> {
  const user = await User.findById(userId).select("+tokenVersion");
  if (!user) throw AppError.unauthorized("Account no longer exists.");
  const roles = (await user.populate<{
    roleIds: Array<{ name: string; permissions: never[] }>;
  }>("roleIds")).roleIds as unknown as Array<{ name: string; permissions: never[] }>;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roleNames: roles.map((r) => r.name),
    permissions: resolvePermissions(roles.map((r) => r.permissions)),
    tokenVersion: user.tokenVersion,
  };
}

export async function login(
  email: string,
  password: string,
  meta: RequestMeta,
): Promise<LoginResult> {
  const normalised = email.trim().toLowerCase();

  // Fetched with the lockout fields explicitly selected.
  const user = await User.findOne({ email: normalised }).select(
    "+passwordHash +failedLoginCount +lockedUntil",
  );

  if (!user) {
    // Equalise timing so a missing account is indistinguishable from a bad password.
    await dummyVerify(password);
    throw AppError.unauthorized("Invalid email or password.");
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    throw new AppError(
      423,
      "ACCOUNT_LOCKED",
      `Account temporarily locked after repeated failed sign-ins. Try again in ${minutes} minute(s).`,
    );
  }

  if (!user.active) {
    // Still hash to keep timing uniform for a deactivated account.
    await dummyVerify(password);
    throw AppError.forbidden("This account is deactivated. Contact an administrator.");
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok) {
    const failures = accountLimiter.hit(user.id);
    user.failedLoginCount = (user.failedLoginCount ?? 0) + 1;
    if (!failures.allowed) {
      user.lockedUntil = new Date(Date.now() + env.ACCOUNT_LOCK_MINUTES * 60 * 1000);
    }
    await user.save();

    await recordAudit({
      ...meta,
      actorId: user.id,
      actorEmail: user.email,
      action: "auth.login.failed",
      entityType: "user",
      entityId: user.id,
      after: { attempts: failures.remaining },
    });
    throw AppError.unauthorized("Invalid email or password.");
  }

  // Success resets the counters.
  accountLimiter.reset(user.id);
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const authed = await loadAuthedUser(user.id);
  const accessToken = await signAccessToken({
    sub: authed.id,
    roles: authed.roleNames,
    perms: authed.permissions,
    ver: authed.tokenVersion,
  });

  const { raw, hash } = generateRefreshToken();
  await RefreshToken.create({
    userId: authed.id,
    familyId: newFamilyId(),
    tokenHash: hash,
    expiresAt: refreshExpiry(),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });

  await recordAudit({
    ...meta,
    actorId: authed.id,
    actorEmail: authed.email,
    action: "auth.login.success",
    entityType: "user",
    entityId: authed.id,
  });

  return {
    user: authed,
    accessToken,
    accessTokenExpiresInSeconds: env.ACCESS_TOKEN_TTL_MIN * 60,
    refreshToken: raw,
    refreshExpiresAt: refreshExpiry(),
  };
}

/**
 * Rotates a refresh token.
 *
 * Throws 401 and revokes the whole family when the presented token has already
 * been used (replay), was revoked, or has expired.
 */
export async function rotateRefreshToken(
  rawToken: string,
  meta: RequestMeta,
): Promise<LoginResult> {
  const hash = hashRefreshToken(rawToken);
  const record = await RefreshToken.findOne({ tokenHash: hash });

  if (!record) throw AppError.unauthorized("Invalid session. Please sign in again.");

  // ---- Reuse detection -------------------------------------------------
  if (record.usedAt || record.revokedAt) {
    await revokeFamily(record.familyId, "refresh-token-reuse", meta);
    throw new AppError(
      401,
      "REFRESH_REUSE_DETECTED",
      "This session was already refreshed and has been revoked for safety. Please sign in again.",
    );
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    await record.updateOne({ revokedAt: new Date(), revokedReason: "expired" });
    throw AppError.unauthorized("Session expired. Please sign in again.");
  }

  const user = await User.findById(record.userId);
  if (!user) throw AppError.unauthorized("Account no longer exists.");
  if (!user.active) {
    await revokeFamily(record.familyId, "account-deactivated", meta);
    throw AppError.unauthorized("This account is deactivated.");
  }

  // ---- Rotate ----------------------------------------------------------
  record.usedAt = new Date();
  await record.save();

  const authed = await loadAuthedUser(user.id);
  const accessToken = await signAccessToken({
    sub: authed.id,
    roles: authed.roleNames,
    perms: authed.permissions,
    ver: authed.tokenVersion,
  });

  const { raw, hash: nextHash } = generateRefreshToken();
  await RefreshToken.create({
    userId: authed.id,
    familyId: record.familyId, // same chain — reuse of any link kills the family
    tokenHash: nextHash,
    expiresAt: refreshExpiry(),
    userAgent: meta.userAgent ?? null,
    ip: meta.ip ?? null,
  });

  await recordAudit({
    ...meta,
    actorId: authed.id,
    actorEmail: authed.email,
    action: "auth.refresh.rotated",
    entityType: "user",
    entityId: authed.id,
    before: { familyId: record.familyId },
    after: { rotatedAt: record.usedAt.toISOString() },
  });

  return {
    user: authed,
    accessToken,
    accessTokenExpiresInSeconds: env.ACCESS_TOKEN_TTL_MIN * 60,
    refreshToken: raw,
    refreshExpiresAt: refreshExpiry(),
  };
}

/** Revokes every live token in a rotation family. */
export async function revokeFamily(
  familyId: string,
  reason: string,
  meta: RequestMeta,
): Promise<void> {
  const result = await RefreshToken.updateMany(
    { familyId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  if (result.modifiedCount > 0) {
    await recordAudit({
      ...meta,
      action: "auth.session.family_revoked",
      entityType: "refresh_token_family",
      entityId: familyId,
      after: { reason, count: result.modifiedCount },
    });
  }
}

/** Logout: revokes only the presented token's family, and always clears the cookie. */
export async function logout(rawToken: string | null, meta: RequestMeta): Promise<void> {
  if (!rawToken) return;
  const record = await RefreshToken.findOne({ tokenHash: hashRefreshToken(rawToken) });
  if (!record) return;
  await revokeFamily(record.familyId, "logout", meta);
}

/** Logout everywhere — used when a password is changed or an admin force-locks an account. */
export async function revokeAllSessions(
  userId: string,
  reason: string,
  meta: RequestMeta,
): Promise<number> {
  const result = await RefreshToken.updateMany(
    { userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  await recordAudit({
    ...meta,
    actorId: userId,
    action: "auth.session.revoke_all",
    entityType: "user",
    entityId: userId,
    after: { reason, count: result.modifiedCount },
  });
  return result.modifiedCount;
}

/** Re-hashing check so hashes produced with weaker parameters get upgraded on login. */
export function needsRehash(hash: string): boolean {
  return !/m=19456,t=2,p=1/.test(hash);
}

export { digestsMatch };