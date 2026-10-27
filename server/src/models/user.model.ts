import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * A person who can sign in. Passwords are stored only as argon2id hashes and the
 * field is `select: false`, so it cannot leak through an accidental projection
 * elsewhere in the codebase.
 *
 * Interfaces are declared explicitly rather than inferred — `InferSchemaType`
 * over the narrow unions in this schema fights every `.lean()` call site.
 *
 * There is deliberately no `user.verifyPassword()` instance method: schema
 * methods are typed by Mongoose in a way that is painful to consume, and
 * `verifyPassword(hash, plain)` from `lib/password.ts` called directly on
 * `user.passwordHash` is clearer at every site.
 */
export interface UserAttrs {
  email: string;
  name: string;
  phone: string;

  passwordHash: string;
  /** Audit trail only — see `tokenVersion` for token invalidation. */
  passwordChangedAt: Date;
  /** Incremented to invalidate every previously issued access token. */
  tokenVersion: number;

  roleIds: Types.ObjectId[];

  active: boolean;

  // ---- Brute-force lockout (never returned by an API response) ----
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserAttrs>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },

    passwordHash: { type: String, required: true, select: false },
    passwordChangedAt: { type: Date, required: true, default: () => new Date() },

    /**
     * Bumped whenever an existing token must stop working (password reset,
     * deactivation). Embedded in the access token as `ver` and compared on
     * every request.
     *
     * A `passwordChangedAt` timestamp is kept for audit display but is NOT
     * used for enforcement: a JWT `iat` only has one-second resolution, so a
     * password reset in the same second a token was minted would not
     * invalidate it. A monotonic counter has no such ambiguity.
     *
     * NOT `select: false` — it is not credential material, and requiring an
     * explicit select at every increment site is an easy way to write
     * `undefined += 1`.
     */
    tokenVersion: { type: Number, required: true, default: 0 },

    roleIds: [{ type: Schema.Types.ObjectId, ref: "Role", required: true }],

    active: { type: Boolean, required: true, default: true },

    failedLoginCount: { type: Number, required: true, default: 0, select: false },
    lockedUntil: { type: Date, default: null, select: false },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

userSchema.index({ roleIds: 1 });

export type UserDoc = HydratedDocument<UserAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type UserLean = UserAttrs & { _id: Types.ObjectId };

/** Role reference after `populate("roleIds", "name")`. */
export interface PopulatedRole {
  _id: Types.ObjectId;
  name: string;
}

export type UserWithRolesLean = Omit<UserLean, "roleIds"> & { roleIds: PopulatedRole[] };

export const User: Model<UserAttrs> = model<UserAttrs>("User", userSchema);