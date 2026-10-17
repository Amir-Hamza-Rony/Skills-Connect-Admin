import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * A supplier agent — one of three kinds (Spec §7): a sales/closing agent who
 * owns the client relationship, a certificate source, or an RTO contact.
 *
 * The `type` field is what lets the order form show the three selections
 * separately (UAT criterion 2) instead of one undifferentiated agent picker.
 */
export type AgentType = "sales_closing" | "certificate_source" | "rto_contact";

export interface AgentAttrs {
  name: string;
  type: AgentType;
  contact: string;
  commissionRule: string;
  active: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const agentSchema = new Schema<AgentAttrs>(
  {
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      required: true,
      enum: ["sales_closing", "certificate_source", "rto_contact"],
    },
    contact: { type: String, default: "", trim: true },
    commissionRule: { type: String, default: "", trim: true },
    active: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, versionKey: false },
);

agentSchema.index({ type: 1, active: 1 });

export type AgentDoc = HydratedDocument<AgentAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type AgentLean = AgentAttrs & { _id: Types.ObjectId };

export const Agent: Model<AgentAttrs> = model<AgentAttrs>("Agent", agentSchema);
