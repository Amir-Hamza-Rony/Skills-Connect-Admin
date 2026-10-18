import { Schema, model, type HydratedDocument, type Model } from "mongoose";

/**
 * OAuth token pair for the QuickBooks connection (BACKEND-PLAN B5).
 *
 * ## Why this exists
 *
 * The spec's 17 collections cover business entities. An OAuth token is neither:
 * it is credential material for one external integration, exactly like
 * `refresh_tokens` was in B2. It is documented here rather than silently
 * introduced, following the same precedent.
 *
 * ## One row per realm
 *
 * `_id` is the realm id, so re-authorising the same company overwrites the pair
 * instead of accumulating stale credentials. There is never more than one
 * active connection in this system, so no lookup query is needed.
 *
 * ## At-rest handling
 *
 * The access token is a bearer credential with the same blast radius as a
 * password. It is `select: false` by default so a stray `find()` cannot leak it
 * into an API response, and the refresh token — the long-lived half — is never
 * returned to any caller at all.
 */
export interface QBConnectionAttrs {
  /** QuickBooks company id. Also the `_id`. */
  realmId: string;
  accessToken: string;
  refreshToken: string;
  /** Unix ms. QuickBooks access tokens expire after one hour. */
  expiresAt: number;
  scope: string;
  createdAt: Date;
  updatedAt: Date;
}

const qbConnectionSchema = new Schema<QBConnectionAttrs>(
  {
    realmId: { type: String, required: true },
    accessToken: { type: String, required: true, select: false },
    refreshToken: { type: String, required: true, select: false },
    expiresAt: { type: Number, required: true },
    scope: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

export type QBConnectionDoc = HydratedDocument<QBConnectionAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type QBConnectionLean = QBConnectionAttrs & { _id: string };

export const QBConnection: Model<QBConnectionAttrs> = model<QBConnectionAttrs>(
  "QBConnection",
  qbConnectionSchema,
);

/**
 * The stored connection with its secrets attached.
 *
 * A distinct type from `QBConnectionLean` so that a bare `select: false` lean
 * — which omits the tokens and would be typed as lying about them — cannot be
 * passed where usable credentials are required.
 */
export interface QBTokens {
  realmId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

/** Reads the active connection, or `null` when the company is not authorised. */
export async function loadQBTokens(): Promise<QBTokens | null> {
  const doc = await QBConnection.findOne({}).select("+accessToken +refreshToken").lean<
    QBConnectionLean | null
  >();
  if (!doc) return null;
  return {
    realmId: doc.realmId,
    accessToken: doc.accessToken,
    refreshToken: doc.refreshToken,
    expiresAt: doc.expiresAt,
    scope: doc.scope,
  };
}

/** Inserts or replaces the token pair for a realm. */
export async function saveQBTokens(tokens: QBTokens): Promise<void> {
  await QBConnection.updateOne(
    { realmId: tokens.realmId },
    {
      $set: {
        realmId: tokens.realmId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        scope: tokens.scope,
      },
    },
    { upsert: true },
  );
}

/** True when the access token is past — or close to — expiry. */
export function isExpired(expiresAt: number, skewMs = 60_000): boolean {
  return Date.now() >= expiresAt - skewMs;
}