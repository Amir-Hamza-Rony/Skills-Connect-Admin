import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

import type { ClientStatus } from "../types/workflow.js";

/**
 * A client — the person being enrolled. One client may hold many orders
 * (Spec §7 "multi-order client"), which is why orders reference `clientId`
 * rather than embedding.
 *
 * `legalName` + `phone` + `email` are the dedupe keys: `GET /clients/duplicates`
 * reports rows that look like the same person so an operator can merge them
 * before two agents unknowingly work the same lead.
 */
export interface ClientAttrs {
  legalName: string;
  preferredName: string;
  phone: string;
  email: string;
  address: string;
  status: ClientStatus;
  /** Sales / Closing Agent who owns this client. */
  sourceAgentId: Types.ObjectId | null;
  notes: string;

  createdAt: Date;
  updatedAt: Date;
}

const clientSchema = new Schema<ClientAttrs>(
  {
    legalName: { type: String, required: true, trim: true },
    preferredName: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    address: { type: String, default: "", trim: true },
    status: {
      type: String,
      required: true,
      enum: ["Prospect", "Active", "On Hold", "Inactive"],
      default: "Prospect",
    },
    sourceAgentId: { type: Schema.Types.ObjectId, ref: "Agent", default: null },
    notes: { type: String, default: "" },
  },
  { timestamps: true, versionKey: false },
);

// Dedupe lookups and the client list both start from these fields.
clientSchema.index({ email: 1 });
clientSchema.index({ phone: 1 });
clientSchema.index({ legalName: 1 });
clientSchema.index({ status: 1, createdAt: -1 });

export type ClientDoc = HydratedDocument<ClientAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type ClientLean = ClientAttrs & { _id: Types.ObjectId };

export const Client: Model<ClientAttrs> = model<ClientAttrs>("Client", clientSchema);
