import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * An invoice for an order.
 *
 * `status` is **derived**, never stored as a writable field in the normal
 * course: it is recomputed from the payments allocated against the invoice. The
 * only transitions written directly are to `Void` — and a void is terminal and
 * irreversible, which is why "void" is a status rather than a delete.
 */
export type InvoiceStatus = "Draft" | "Sent" | "Part Paid" | "Paid" | "Overdue" | "Void";

export interface InvoiceAttrs {
  orderId: Types.ObjectId;
  invoiceNumber: string;
  total: number;
  dueDate: Date;
  status: InvoiceStatus;

  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<InvoiceAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    invoiceNumber: { type: String, required: true, unique: true, trim: true },
    total: { type: Number, required: true, min: 0 },
    dueDate: { type: Date, required: true },
    status: {
      type: String,
      required: true,
      enum: ["Draft", "Sent", "Part Paid", "Paid", "Overdue", "Void"],
      default: "Draft",
    },
  },
  { timestamps: true, versionKey: false },
);

invoiceSchema.index({ orderId: 1, createdAt: -1 });
invoiceSchema.index({ status: 1 });

export type InvoiceDoc = HydratedDocument<InvoiceAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type InvoiceLean = InvoiceAttrs & { _id: Types.ObjectId };

export const Invoice: Model<InvoiceAttrs> = model<InvoiceAttrs>("Invoice", invoiceSchema);
