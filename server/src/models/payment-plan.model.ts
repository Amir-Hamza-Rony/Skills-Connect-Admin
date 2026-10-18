import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * A payment plan: how an order's cost is split into dated instalments.
 *
 * Instalments are embedded rather than a separate collection because they are
 * only ever read and written as part of their plan — there is no "all
 * instalments across all orders" query that would justify the join.
 *
 * There is deliberately no four-column limit (UAT criterion 4): the schema
 * accepts any number, and the plan total is the sum of its instalments.
 */
export type InstalmentStatus =
  | "Pending"
  | "Due"
  | "Paid"
  | "Part Paid"
  | "Overdue"
  | "Waived"
  | "Cancelled";

export interface InstalmentAttrs {
  id: string;
  dueDate: Date;
  amount: number;
  paidAmount: number;
  status: InstalmentStatus;
}

export interface PaymentPlanAttrs {
  orderId: Types.ObjectId;
  total: number;
  instalments: InstalmentAttrs[];

  createdAt: Date;
  updatedAt: Date;
}

const instalmentSchema = new Schema<InstalmentAttrs>(
  {
    id: { type: String, required: true },
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    status: {
      type: String,
      required: true,
      enum: ["Pending", "Due", "Paid", "Part Paid", "Overdue", "Waived", "Cancelled"],
      default: "Pending",
    },
  },
  { _id: false, versionKey: false },
);

const paymentPlanSchema = new Schema<PaymentPlanAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
    total: { type: Number, required: true, min: 0 },
    instalments: { type: [instalmentSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

// `orderId` is already indexed by its `unique: true` declaration above; a
// second `schema.index({ orderId: 1 })` would be a duplicate.

export type PaymentPlanDoc = HydratedDocument<PaymentPlanAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type PaymentPlanLean = PaymentPlanAttrs & { _id: Types.ObjectId };

export const PaymentPlan: Model<PaymentPlanAttrs> = model<PaymentPlanAttrs>(
  "PaymentPlan",
  paymentPlanSchema,
);
