import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * A qualification that can be sold — e.g. AUR32120 Certificate III in
 * Individual Support.
 *
 * `licensingRefs` is embedded rather than a separate collection (Spec §7 lists
 * it as embedded): it is a small, fixed set of licensing references that only
 * ever makes sense in the context of one qualification.
 */
export interface LicensingRef {
  industry: string;
  authority: string;
  prerequisites: string;
  outcome: string;
}

export type QualificationStatus = "current" | "superseded";

export interface QualificationAttrs {
  code: string;
  title: string;
  trainingPackage: string;
  industry: string;
  status: QualificationStatus;
  licensingRefs: LicensingRef[];

  createdAt: Date;
  updatedAt: Date;
}

const licensingRefSchema = new Schema<LicensingRef>(
  {
    industry: { type: String, required: true, trim: true },
    authority: { type: String, required: true, trim: true },
    prerequisites: { type: String, default: "", trim: true },
    outcome: { type: String, default: "", trim: true },
  },
  { _id: false, versionKey: false },
);

const qualificationSchema = new Schema<QualificationAttrs>(
  {
    code: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    trainingPackage: { type: String, default: "", trim: true },
    industry: { type: String, default: "", trim: true },
    status: {
      type: String,
      required: true,
      enum: ["current", "superseded"],
      default: "current",
    },
    licensingRefs: { type: [licensingRefSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

export type QualificationDoc = HydratedDocument<QualificationAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type QualificationLean = QualificationAttrs & { _id: Types.ObjectId };

export const Qualification: Model<QualificationAttrs> = model<QualificationAttrs>(
  "Qualification",
  qualificationSchema,
);
