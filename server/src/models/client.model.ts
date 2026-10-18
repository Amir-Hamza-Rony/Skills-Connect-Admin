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

  /**
   * QuickBooks `Customer.Id` for this client.
   *
   * QuickBooks will not accept an invoice without a `CustomerRef`, and it
   * issues ids from its own database — there is no way to derive one. The id is
   * therefore stored once the client exists in both systems, and an invoice for
   * a client without one fails the sync with a named reason instead of creating
   * a broken record in QuickBooks. Populated by the B6 migration/import.
   */
  qbCustomerId: string | null;

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
    qbCustomerId: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

// Dedupe lookups and the client list both start from these fields.
//
// Email is deliberately NOT unique. `POST /clients` rejects a duplicate email
// in the application, but a unique index would make `GET /clients/duplicates`
// — which exists precisely to find and merge same-email clients — unreachable:
// the pre-existing rows it is meant to report could never be loaded in the first
// place, and the B6 migration would abort on the first duplicate. The report is
// the designed control for historical data; the index would remove the problem
// by making it unfixable.
clientSchema.index({ email: 1 });
clientSchema.index({ phone: 1 });
clientSchema.index({ legalName: 1 });
clientSchema.index({ status: 1, createdAt: -1 });

export type ClientDoc = HydratedDocument<ClientAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type ClientLean = ClientAttrs & { _id: Types.ObjectId };

export const Client: Model<ClientAttrs> = model<ClientAttrs>("Client", clientSchema);
