import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

/**
 * A supplier route: what one source agent charges one RTO to deliver one
 * qualification. This is the **pricing matrix** — the wholesale cost that gets
 * snapshotted onto an order when it is created.
 *
 * Routes are soft-expired, never deleted (BACKEND-PLAN §5). An order created
 * against a route keeps its snapshot even after the route expires or is
 * repriced, which is exactly why the order stores its own copy of the cost.
 */
export interface SupplierRouteAttrs {
  qualificationId: Types.ObjectId;
  sourceAgentId: Types.ObjectId;
  rtoId: Types.ObjectId;
  wholesaleCost: number;
  currency: "AUD";
  effectiveFrom: Date;
  /** Null means "currently in force". Set on expiry, never deleted. */
  effectiveTo: Date | null;
  status: "active" | "expired";

  createdAt: Date;
  updatedAt: Date;
}

const supplierRouteSchema = new Schema<SupplierRouteAttrs>(
  {
    qualificationId: { type: Schema.Types.ObjectId, ref: "Qualification", required: true },
    sourceAgentId: { type: Schema.Types.ObjectId, ref: "Agent", required: true },
    rtoId: { type: Schema.Types.ObjectId, ref: "Rto", required: true },
    wholesaleCost: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, enum: ["AUD"], default: "AUD" },
    effectiveFrom: { type: Date, required: true, default: () => new Date() },
    effectiveTo: { type: Date, default: null },
    status: { type: String, required: true, enum: ["active", "expired"], default: "active" },
  },
  { timestamps: true, versionKey: false },
);

// The lookup createOrder() makes: "what does this combination cost today?"
supplierRouteSchema.index({ qualificationId: 1, sourceAgentId: 1, rtoId: 1, status: 1 });

export type SupplierRouteDoc = HydratedDocument<SupplierRouteAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type SupplierRouteLean = SupplierRouteAttrs & { _id: Types.ObjectId };

export const SupplierRoute: Model<SupplierRouteAttrs> = model<SupplierRouteAttrs>(
  "SupplierRoute",
  supplierRouteSchema,
);
