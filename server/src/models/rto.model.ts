import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * A Registered Training Organisation — the body that assesses and issues the
 * certificate.
 *
 * `contacts` is embedded for the same reason as licensing refs on a
 * qualification: a contact only exists in the context of its RTO.
 */
export type RtoStatus = "active" | "suspended" | "at-risk" | "inactive";

export interface RtoContact {
  name: string;
  role: string;
  email: string;
  phone: string;
}

export interface RtoAttrs {
  legalName: string;
  tradingName: string;
  rtoCode: string;
  cricosCode: string | null;
  contacts: RtoContact[];
  status: RtoStatus;
  complianceNote: string;
  website: string;

  createdAt: Date;
  updatedAt: Date;
}

const rtoContactSchema = new Schema<RtoContact>(
  {
    name: { type: String, required: true, trim: true },
    role: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
  },
  { _id: false, versionKey: false },
);

const rtoSchema = new Schema<RtoAttrs>(
  {
    legalName: { type: String, required: true, trim: true },
    tradingName: { type: String, default: "", trim: true },
    rtoCode: { type: String, required: true, unique: true, trim: true },
    cricosCode: { type: String, default: null },
    contacts: { type: [rtoContactSchema], default: [] },
    status: {
      type: String,
      required: true,
      enum: ["active", "suspended", "at-risk", "inactive"],
      default: "active",
    },
    complianceNote: { type: String, default: "" },
    website: { type: String, default: "", trim: true },
  },
  { timestamps: true, versionKey: false },
);

rtoSchema.index({ status: 1 });

export type RtoDoc = HydratedDocument<RtoAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type RtoLean = RtoAttrs & { _id: Types.ObjectId };

export const Rto: Model<RtoAttrs> = model<RtoAttrs>("Rto", rtoSchema);
