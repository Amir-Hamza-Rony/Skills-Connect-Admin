import type { RequestHandler } from "express";

import { AppError } from "../lib/app-error.js";
import { verifyAccessToken } from "../lib/tokens.js";
import { User } from "../models/user.model.js";
import { resolvePermissions } from "../services/permissions.js";

/**
 * Requires a valid, non-expired access token (D1).
 *
 * The token is only trusted after the user is re-read from the database. That
 * matters because a stateless JWT cannot otherwise be revoked: without this
 * lookup, deactivating an account or changing its password would leave up to a
 * 15-minute window where the old token still worked.
 *
 * Permissions are recomputed from the database roles on every request rather
 * than read out of the token, so a permission change takes effect immediately
 * instead of at the next token refresh.
 */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.get("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw AppError.unauthorized("Missing Authorization: Bearer <token> header.");
    }

    const payload = await verifyAccessToken(header.slice("Bearer ".length).trim());

    // `passwordHash`, lockout counters and `tokenVersion` are `select: false`,
    // so select the version explicitly — and nothing else, so no credential
    // material is read on the hot auth path.
    const user = await User.findById(payload.sub).select("+tokenVersion");
    if (!user) throw AppError.unauthorized("Account no longer exists.");
    if (!user.active) throw AppError.unauthorized("This account is deactivated.");

    // Exact invalidation: the token carries the user's `tokenVersion` from when it
// was minted, and any reset/deactivation increments it. No timestamp
// comparison, so no sub-second race.
if (payload.ver !== user.tokenVersion) {
  throw AppError.unauthorized("Credentials changed — sign in again.");
}

    const roles = (await user.populate<{
      roleIds: Array<{ _id: unknown; name: string; permissions: never[] }>;
    }>("roleIds")).roleIds as unknown as Array<{ _id: unknown; name: string; permissions: never[] }>;

    req.auth = {
      userId: user.id,
      email: user.email,
      name: user.name,
      roleNames: roles.map((r) => r.name),
      roleIds: roles.map((r) => String(r._id)),
      permissions: resolvePermissions(roles.map((r) => r.permissions)),
      tokenIssuedAt: payload.issuedAt,
    };

    next();
  } catch (err) {
    next(err instanceof AppError ? err : AppError.unauthorized("Access token is invalid or expired."));
  }
};