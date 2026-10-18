import { Schema, model, type HydratedDocument, type InferSchemaType } from "mongoose";

/**
 * Server-side state for the rotating refresh token (BACKEND-PLAN §6 "server
 * revocation table"). This collection is intentionally NOT part of the 17
 * spec §7 business collections: it is auth infrastructure that D1 requires and
 * the spec does not enumerate.
 *
 * Design:
 * - The raw token never touches the database. Only its SHA-256 hash does, so a
 *   database leak cannot be replayed as a session.
 * - Tokens form a `familyId` chain. Each refresh mints a successor and marks
 *   its predecessor used. Presenting an already-used token means the token was
 *   stolen, so the ENTIRE family is revoked (spec §2.4-style reuse detection).
 */
const refreshTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    familyId: { type: String, required: true },

    /** SHA-256 hex of the opaque token. Unique — replay of a live token is rejected at the index. */
    tokenHash: { type: String, required: true, unique: true },

    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },

    userAgent: { type: String, default: null },
    ip: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// Lookups needed on every refresh request.
refreshTokenSchema.index({ userId: 1, revokedAt: 1 });
refreshTokenSchema.index({ familyId: 1 });
// Mongo removes the document once expired; this is housekeeping, not auth logic.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type RefreshTokenAttrs = InferSchemaType<typeof refreshTokenSchema>;
export type RefreshTokenDoc = HydratedDocument<RefreshTokenAttrs>;

export const RefreshToken = model("RefreshToken", refreshTokenSchema);