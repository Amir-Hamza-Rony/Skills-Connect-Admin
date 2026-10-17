import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

import type {
  CertificateStatus,
  EvidenceStatus,
  OrderStatus,
  RtoSubmissionStatus,
} from "../types/workflow.js";

/**
 * One order: a client enrolling in one qualification through one source agent
 * and one RTO.
 *
 * ## The price snapshot is the point of this model
 *
 * `supplierCostSnapshot` is copied from the active supplier route at the moment
 * the order is created and must never change afterwards. The whole commercial
 * case for the order — margin, commission, what the client was quoted — is
 * computed from that number. If a route's wholesale cost is later corrected or
 * repriced, historical orders must still show what they were actually sold on.
 *
 * Enforced three ways, because "we just don't write to it" is not a guarantee:
 *  1. `immutable: true` on the path — Mongoose rejects a change to an existing doc.
 *  2. A pre-update hook that strips the field from the update, so a raw
 *     `updateOne({ $set: { supplierCostSnapshot } })` is a no-op rather than a
 *     silent corruption.
 *  3. `createOrder()` in the service layer never accepts a snapshot from the
 *     client — it always reads the route itself.
 *
 * ## History is embedded
 *
 * Status changes are appended to `order.history` rather than stored in a
 * separate collection. They are a property of the order, they are read with it,
 * and embedding keeps "write the transition and its history" a single-document
 * write — which is what makes the transactional transition cheap.
 */
export interface StatusChange {
  timestamp: Date;
  actorId: Types.ObjectId | null;
  field: string;
  before: string;
  after: string;
}

export interface OrderAttrs {
  clientId: Types.ObjectId;
  qualificationId: Types.ObjectId;
  salesAgentId: Types.ObjectId;
  sourceAgentId: Types.ObjectId;
  rtoId: Types.ObjectId;

  status: OrderStatus;
  evidenceStatus: EvidenceStatus;
  rtoSubmissionStatus: RtoSubmissionStatus;
  certificateStatus: CertificateStatus;

  sellingPrice: number;
  /** Frozen at creation from the active supplier route. See above. */
  supplierCostSnapshot: number;
  otherCost: number;
  currency: "AUD";

  completedAt: Date | null;
  history: StatusChange[];

  createdAt: Date;
  updatedAt: Date;
}

const statusChangeSchema = new Schema<StatusChange>(
  {
    timestamp: { type: Date, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    field: { type: String, required: true },
    before: { type: String, required: true },
    after: { type: String, required: true },
  },
  { _id: false, versionKey: false },
);

const orderSchema = new Schema<OrderAttrs>(
  {
    clientId: { type: Schema.Types.ObjectId, ref: "Client", required: true },
    qualificationId: { type: Schema.Types.ObjectId, ref: "Qualification", required: true },
    salesAgentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    sourceAgentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    rtoId: { type: Schema.Types.ObjectId, ref: "Rto", required: true },

    status: {
      type: String,
      required: true,
      enum: [
        "Lead",
        "Qualified",
        "Won",
        "Lost",
        "New",
        "Awaiting Payment",
        "Awaiting Documents",
        "Documents Under Review",
        "Ready for Submission",
        "Submitted to Source Agent",
        "Submitted to RTO",
        "RTO Acknowledged",
        "Under Assessment",
        "Additional Evidence Required",
        "Rework Required",
        "Approved",
        "Certificate Issued",
        "Completed",
        "On Hold",
        "Cancelled",
        "Refunded",
      ],
      default: "New",
    },
    evidenceStatus: {
      type: String,
      required: true,
      enum: ["Not Started", "In Progress", "Complete", "Additional Evidence Required"],
      default: "Not Started",
    },
    rtoSubmissionStatus: {
      type: String,
      required: true,
      enum: [
        "Not Ready",
        "Ready",
        "Submitted",
        "Acknowledged",
        "Under Assessment",
        "Additional Evidence Required",
        "Issued",
      ],
      default: "Not Ready",
    },
    certificateStatus: {
      type: String,
      required: true,
      enum: ["Not Issued", "Pending", "Issued", "Certificate File Received", "Delivered to Client"],
      default: "Not Issued",
    },

    sellingPrice: { type: Number, required: true, min: 0 },
    supplierCostSnapshot: { type: Number, required: true, min: 0, immutable: true },
    otherCost: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, required: true, enum: ["AUD"], default: "AUD" },

    completedAt: { type: Date, default: null },
    history: { type: [statusChangeSchema], required: true, default: [] },
  },
  { timestamps: true, versionKey: false },
);

orderSchema.index({ clientId: 1, createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ rtoId: 1 });
orderSchema.index({ salesAgentId: 1 });

/**
 * Second layer of snapshot protection. `immutable: true` covers the Mongoose
 * document API; this covers every raw update verb, so a hand-written
 * `updateOne({ $set: { supplierCostSnapshot: 0 } })` cannot rewrite history.
 */
for (const verb of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne"] as const) {
  orderSchema.pre(verb, function (this: { getUpdate(): Record<string, unknown> }) {
    const update = this.getUpdate() as Record<string, unknown>;
    if (update && "supplierCostSnapshot" in update) delete update.supplierCostSnapshot;
    if (update.$set && typeof update.$set === "object" && "supplierCostSnapshot" in update.$set) {
      delete (update.$set as Record<string, unknown>).supplierCostSnapshot;
    }
  });
}

export type OrderDoc = HydratedDocument<OrderAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type OrderLean = OrderAttrs & { _id: Types.ObjectId };

export const Order: Model<OrderAttrs> = model<OrderAttrs>("Order", orderSchema);
