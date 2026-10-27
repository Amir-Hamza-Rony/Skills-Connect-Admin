import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * A payment received against an order.
 *
 * ## Allocation is server-authoritative
 *
 * The client sends an amount; the server decides how it is distributed across
 * the order's plan instalments (oldest-due-first) and records that decision in
 * `allocations`. The client cannot say "put this against instalment 3" — that
 * would let a payment be steered away from an overdue instalment.
 *
 * ## Nothing is deleted
 *
 * A refund flips `status` to `Refunded` and writes a reversing allocation; the
 * row and its audit trail stay. The same reasoning as voiding an invoice.
 */
export type PaymentMethod = "Bank Transfer" | "Card" | "Cash" | "Other";

export type PaymentStatus =
  | "Allocated"
  | "Partially Allocated"
  | "Unallocated"
  | "Refunded"
  | "Void";

export interface Allocation {
  instalmentId: string;
  amount: number;
}

export interface PaymentAttrs {
  orderId: Types.ObjectId;
  invoiceId: Types.ObjectId | null;
  amount: number;
  date: Date;
  method: PaymentMethod;
  reference: string;

  /** Per-instalment breakdown of where the money went. */
  allocations: Allocation[];
  /** Sum of `allocations` — how much of the payment found a target. */
  allocatedAmount: number;
  status: PaymentStatus;

  createdAt: Date;
  updatedAt: Date;
}

const allocationSchema = new Schema<Allocation>(
  {
    instalmentId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { _id: false, versionKey: false },
);

const paymentSchema = new Schema<PaymentAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice", default: null },
    amount: { type: Number, required: true, min: 0 },
    date: { type: Date, required: true },
    method: {
      type: String,
      required: true,
      enum: ["Bank Transfer", "Card", "Cash", "Other"],
    },
    reference: { type: String, default: "", trim: true },
    allocations: { type: [allocationSchema], default: [] },
    allocatedAmount: { type: Number, required: true, min: 0, default: 0 },
    status: {
      type: String,
      required: true,
      enum: ["Allocated", "Partially Allocated", "Unallocated", "Refunded", "Void"],
      default: "Unallocated",
    },
  },
  { timestamps: true, versionKey: false },
);

paymentSchema.index({ orderId: 1, createdAt: -1 });
paymentSchema.index({ invoiceId: 1 });
paymentSchema.index({ status: 1 });

export type PaymentDoc = HydratedDocument<PaymentAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type PaymentLean = PaymentAttrs & { _id: Types.ObjectId };

export const Payment: Model<PaymentAttrs> = model<PaymentAttrs>("Payment", paymentSchema);
