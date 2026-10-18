import { Schema, model, type HydratedDocument, type Model } from "mongoose";

/**
 * Atomic sequence counters.
 *
 * Used for invoice numbers, where two concurrent creates must never be issued
 * the same value. A `findOneAndUpdate` with `$inc` is atomic in MongoDB, so the
 * sequence is gap-free under concurrency in a way that "count the rows and add
 * one" is not.
 *
 * Gaps are possible (a transaction can roll back after incrementing), which is
 * fine — an invoice number must be unique, not contiguous.
 */
export interface CounterAttrs {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterAttrs>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export type CounterDoc = HydratedDocument<CounterAttrs>;

export const Counter: Model<CounterAttrs> = model<CounterAttrs>("Counter", counterSchema);
