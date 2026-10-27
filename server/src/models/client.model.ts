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
export interface ClientContact {
  label: string; // e.g. "Mobile", "Work", "Emergency"
  type: "phone" | "email" | "whatsapp";
  value: string;
  primary: boolean;
}

export interface ClientAddress {
  label: string; // e.g. "Home", "Mailing", "Billing"
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  primary: boolean;
}

export interface ClientAttrs {
  legalName: string;
  preferredName: string;
  /**
   * Primary email — the dedupe key. Kept at the top level (rather than only
   * inside `contacts`) because `POST /clients` rejects a duplicate email and
   * the duplicates report groups on it. The richer set of contact methods
   * lives in `contacts`; this is the one used for identity.
   */
  email: string;
  contacts: ClientContact[]; // multiple contact methods (phone, email, whatsapp)
  addresses: ClientAddress[]; // multiple addresses (home, mailing, billing)
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

const clientContactSchema = new Schema<ClientContact>(
  {
    label: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["phone", "email", "whatsapp"],
    },
    value: { type: String, required: true, trim: true },
    primary: { type: Boolean, required: true, default: false },
  },
  { _id: false, versionKey: false },
);

const clientAddressSchema = new Schema<ClientAddress>(
  {
    label: { type: String, required: true, trim: true },
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, default: "", trim: true },
    postalCode: { type: String, default: "", trim: true },
    country: { type: String, default: "Australia", trim: true },
    primary: { type: Boolean, required: true, default: false },
  },
  { _id: false, versionKey: false },
);

const clientSchema = new Schema<ClientAttrs>(
  {
    legalName: { type: String, required: true, trim: true },
    preferredName: { type: String, default: "", trim: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    contacts: { type: [clientContactSchema], required: true, default: [] },
    addresses: { type: [clientAddressSchema], required: true, default: [] },
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
clientSchema.index({ "contacts.value": 1 });
clientSchema.index({ legalName: 1 });
clientSchema.index({ status: 1, createdAt: -1 });

export type ClientDoc = HydratedDocument<ClientAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type ClientLean = ClientAttrs & { _id: Types.ObjectId };

export const Client: Model<ClientAttrs> = model<ClientAttrs>("Client", clientSchema);
