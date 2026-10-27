import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

import type { CertificateStatus } from "../types/workflow.js";

/**
 * Certificate lifecycle for an order (Spec §7 — `certificates` is the one
 * collection the spec does not enumerate but the workflow requires).
 *
 * The order also carries a denormalised `certificateStatus` so the order list
 * and the client profile can render a badge without a join. The two are written
 * in the same transaction, so they cannot disagree for long; the order field is
 * the read model, this collection is the record.
 */
export interface CertificateAttrs {
  orderId: Types.ObjectId;
  status: CertificateStatus;
  certificateNumber: string | null;
  issuedAt: Date | null;
  fileReceivedAt: Date | null;
  deliveredToClientAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const certificateSchema = new Schema<CertificateAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
    status: {
      type: String,
      required: true,
      enum: ["Not Issued", "Pending", "Issued", "Certificate File Received", "Delivered to Client"],
      default: "Not Issued",
    },
    certificateNumber: { type: String, default: null },
    issuedAt: { type: Date, default: null },
    fileReceivedAt: { type: Date, default: null },
    deliveredToClientAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export type CertificateDoc = HydratedDocument<CertificateAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type CertificateLean = CertificateAttrs & { _id: Types.ObjectId };

export const Certificate: Model<CertificateAttrs> = model<CertificateAttrs>(
  "Certificate",
  certificateSchema,
);
