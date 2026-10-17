import mongoose, { type ClientSession } from "mongoose";

/**
 * Runs `fn` inside a MongoDB transaction when the deployment supports one, and
 * falls back to a plain sequential run when it does not.
 *
 * ## Why the fallback exists
 *
 * Multi-document transactions require a replica set. Atlas M0/M2/M5 are
 * single-node, and `mongodb-memory-server` defaults to a standalone too, so
 * `withTransaction` there throws code 20 ("Transaction numbers are only allowed
 * on a replica set member or mongos"). Rather than hard-fail B3 — or worse,
 * silently skip the second write — the helper detects that specific error and
 * runs the same callback without a session.
 *
 * The trade-off is real and worth stating: on a standalone, the two writes are
 * no longer atomic, so a crash between them can leave the order transitioned
 * without its task (or vice versa). On a replica set — which is what production
 * should be — they are atomic. A reconciliation job in B6 can repair the
 * standalone case; correctness is not surrendered, it is downgraded visibly.
 *
 * Pass `null` as the session to `fn` and the code must not use it.
 */
const TRANSACTION_NOT_SUPPORTED = 20;

function isTransactionUnsupported(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: number }).code;
  return (
    code === TRANSACTION_NOT_SUPPORTED ||
    /replica set member or mongos|transactions are not supported|retryable writes/i.test(
      err.message,
    )
  );
}

export async function withTransaction<T>(
  fn: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } catch (err) {
    if (isTransactionUnsupported(err)) {
      return fn(null);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
