import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

import { PERMISSIONS, ROLE_NAMES, type Permission, type RoleName } from "../services/permissions.js";

/**
 * Roles are seeded from `services/permissions.ts` and are system-owned: the API
 * never creates, renames or deletes them. A user holds role *references*, so a
 * permission change takes effect on the next request without touching user rows.
 *
 * Interfaces are declared explicitly rather than inferred — `InferSchemaType`
 * over an `enum` field produces a narrowed literal union that fights every
 * `.lean()` call site.
 */
export interface RoleAttrs {
  name: RoleName;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<RoleAttrs>(
  {
    name: { type: String, required: true, unique: true, enum: [...ROLE_NAMES], immutable: true },
    description: { type: String, required: true },
    permissions: { type: [String], required: true, enum: [...PERMISSIONS], default: [] },
    isSystem: { type: Boolean, required: true, default: true },
  },
  { timestamps: true, versionKey: false },
);

export type RoleDoc = HydratedDocument<RoleAttrs>;

/** `.lean()` result shape — `_id` is added by Mongo, so it is declared here. */
export type RoleLean = RoleAttrs & { _id: Types.ObjectId };

export const Role: Model<RoleAttrs> = model<RoleAttrs>("Role", roleSchema);