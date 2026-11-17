/**
 * Server-side enrollment code generation.
 *
 * Format (D2): SC-YYYY-NNNN. Codes are never accepted from a request body.
 *
 * Concurrency: a single-document `$inc` on the `enrollment_sequences` counter
 * collection is atomic in MongoDB, so simultaneous creators receive distinct
 * sequence numbers. `enrollment_sequences` is a metadata/counter collection,
 * not an `enrollments` business collection (D1).
 *
 * The unique partial index on `orders.enrollmentCode` is the final integrity
 * guard. Retrying an order insert on duplicate key (E11000) belongs to the
 * route that performs the insert (M1.4), not to this foundation module.
 *
 * B4 (start value 0001 vs 1042) is deliberately NOT encoded here: incrementing
 * a fresh counter from zero mechanically yields 0001. A different business
 * start value would require an explicitly authorized counter seeding/migration.
 */

import { collection } from "@/lib/db";

export const ENROLLMENT_CODE_PATTERN = /^SC-\d{4}-\d{4,}$/;

/** Format a year + sequence as SC-YYYY-NNNN (zero-padded to at least 4 digits). */
export function formatEnrollmentCode(year: number, seq: number): string {
  return `SC-${year}-${String(seq).padStart(4, "0")}`;
}

/** UTC calendar year used in the code prefix. */
export function enrollmentYear(date: Date = new Date()): number {
  return date.getUTCFullYear();
}

/** Atomically allocate and return the next enrollment code for a year. */
export async function nextEnrollmentCode(year: number = enrollmentYear()): Promise<string> {
  const counters = await collection("enrollment_sequences");
  const now = new Date();

  // findOneAndUpdate returns the post-update document in driver v6; tolerate
  // the older { value } wrapper defensively so callers always see a seq.
  const result: any = await counters.findOneAndUpdate(
    { _id: `SC-${year}` },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );

  const seq = result?.seq ?? result?.value?.seq;
  if (typeof seq !== "number" || !Number.isFinite(seq)) {
    throw new Error(`Failed to allocate an enrollment code for ${year}.`);
  }

  return formatEnrollmentCode(year, seq);
}
