import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

export type SavedViewScope = "orders" | "documents" | "finance" | "clients";

export interface SavedViewAttrs {
  userId: Types.ObjectId;
  name: string;
  scope: SavedViewScope;
  filters: Record<string, unknown>;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const savedViewSchema = new Schema<SavedViewAttrs>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true },
    scope: {
      type: String,
      required: true,
      enum: ["orders", "documents", "finance", "clients"],
    },
    filters: { type: Schema.Types.Mixed, required: true, default: {} },
    isDefault: { type: Boolean, required: true, default: false },
  },
  { timestamps: true, versionKey: false },
);

savedViewSchema.index({ userId: 1, scope: 1 });
savedViewSchema.index({ userId: 1, isDefault: 1 });

export type SavedViewDoc = HydratedDocument<SavedViewAttrs>;
export type SavedViewLean = SavedViewAttrs & { _id: Types.ObjectId };

export const SavedView: Model<SavedViewAttrs> = model<SavedViewAttrs>(
  "SavedView",
  savedViewSchema,
);
