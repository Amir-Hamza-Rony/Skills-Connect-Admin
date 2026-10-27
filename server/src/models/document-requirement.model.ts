import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

import type { DocumentStatus } from "../types/workflow.js";

/**
 * A document that must be collected for an order, and where it currently is.
 *
 * Modelled as a collection rather than a checklist constant because the same
 * checklist produces different *state* per order: one client has their USI
 * transcript approved, another has not been asked yet. The template lives in
 * `DOCUMENT_CHECKLIST` below; rows are created from it when an order opens.
 */
export const DOCUMENT_CHECKLIST: readonly string[] = [
  "Identity (passport / licence)",
  "USI transcript",
  "Employment evidence",
  "Reference letter",
  "Photos / skills evidence",
  "RTO enrolment kit",
];

export interface DocumentRequirementAttrs {
  orderId: Types.ObjectId;
  type: string;
  required: boolean;
  status: DocumentStatus;
  /** Set once a file has been received for this requirement. */
  documentId: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

const documentRequirementSchema = new Schema<DocumentRequirementAttrs>(
  {
    orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true },
    type: { type: String, required: true, trim: true },
    required: { type: Boolean, required: true, default: true },
    status: {
      type: String,
      required: true,
      enum: [
        "Requested",
        "Not Received",
        "Received",
        "Under Review",
        "Approved",
        "Rejected",
        "Superseded",
      ],
      default: "Requested",
    },
    documentId: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true, versionKey: false },
);

// One row per (order, type) — a requirement is either present or it is not.
documentRequirementSchema.index({ orderId: 1, type: 1 }, { unique: true });
documentRequirementSchema.index({ status: 1 });

export type DocumentRequirementDoc = HydratedDocument<DocumentRequirementAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type DocumentRequirementLean = DocumentRequirementAttrs & { _id: Types.ObjectId };

export const DocumentRequirement: Model<DocumentRequirementAttrs> = model<DocumentRequirementAttrs>(
  "DocumentRequirement",
  documentRequirementSchema,
);
