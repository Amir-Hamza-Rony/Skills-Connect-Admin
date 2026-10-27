import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { SavedView, type SavedViewAttrs, type SavedViewLean } from "../models/saved-view.model.js";
import { recordAudit } from "./audit.service.js";

export interface SavedViewActor {
  id: string;
  email: string;
  ip?: string | null;
  requestId?: string | null;
}

export interface SavedViewDTO {
  id: string;
  userId: string;
  name: string;
  scope: SavedViewAttrs["scope"];
  filters: Record<string, unknown>;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toSavedViewDTO(doc: SavedViewLean): SavedViewDTO {
  return {
    id: String(doc._id),
    userId: String(doc.userId),
    name: doc.name,
    scope: doc.scope,
    filters: doc.filters,
    isDefault: doc.isDefault,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** `GET /saved-views` — list for a user, optionally scoped. */
export async function listSavedViews(
  userId: string,
  scope?: SavedViewAttrs["scope"],
): Promise<SavedViewDTO[]> {
  if (!Types.ObjectId.isValid(userId)) return [];

  const q: Record<string, unknown> = { userId: new Types.ObjectId(userId) };
  if (scope) q.scope = scope;

  const docs = await SavedView.find(q)
    .sort({ isDefault: -1, name: 1 })
    .lean<SavedViewLean[]>();
  return docs.map(toSavedViewDTO);
}

export interface CreateSavedViewInput {
  userId: string;
  name: string;
  scope: SavedViewAttrs["scope"];
  filters: Record<string, unknown>;
  isDefault?: boolean;
}

/** `POST /saved-views` — create. */
export async function createSavedView(
  input: CreateSavedViewInput,
  actor: SavedViewActor,
): Promise<SavedViewDTO> {
  if (!Types.ObjectId.isValid(input.userId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid userId.");
  }

  // If this is set as default, unset any existing default for this user + scope.
  if (input.isDefault) {
    await SavedView.updateMany(
      { userId: input.userId, scope: input.scope, isDefault: true },
      { $set: { isDefault: false } },
    );
  }

  const doc = await SavedView.create({
    userId: new Types.ObjectId(input.userId),
    name: input.name.trim(),
    scope: input.scope,
    filters: input.filters ?? {},
    isDefault: input.isDefault ?? false,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "saved-view.create",
    entityType: "saved-view",
    entityId: String(doc._id),
    after: { name: input.name, scope: input.scope, filters: input.filters },
  });

  return toSavedViewDTO(doc);
}

/** `PATCH /saved-views/:id` — update (owner only). */
export async function updateSavedView(
  id: string,
  userId: string,
  patch: Partial<Pick<SavedViewAttrs, "name" | "filters" | "isDefault">>,
  actor: SavedViewActor,
): Promise<SavedViewDTO | null> {
  if (!Types.ObjectId.isValid(id)) return null;

  const existing = await SavedView.findById(id).lean<SavedViewLean>();
  if (!existing) return null;
  if (String(existing.userId) !== userId) {
    throw new AppError(403, "NOT_OWNER", "You do not own this saved view.");
  }

  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.filters !== undefined) set.filters = patch.filters;
  if (patch.isDefault !== undefined && patch.isDefault) {
    await SavedView.updateMany(
      { userId, scope: existing.scope, isDefault: true },
      { $set: { isDefault: false } },
    );
    set.isDefault = true;
  } else if (patch.isDefault !== undefined && !patch.isDefault) {
    set.isDefault = false;
  }

  await SavedView.updateOne({ _id: id }, { $set: set });

  const updated = await SavedView.findById(id).lean<SavedViewLean>();
  if (!updated) return null;

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "saved-view.update",
    entityType: "saved-view",
    entityId: id,
    before: { name: existing.name, filters: existing.filters, isDefault: existing.isDefault },
    after: { name: updated.name, filters: updated.filters, isDefault: updated.isDefault },
  });

  return toSavedViewDTO(updated);
}

/** `DELETE /saved-views/:id` — delete (owner only). */
export async function deleteSavedView(id: string, userId: string): Promise<void> {
  if (!Types.ObjectId.isValid(id)) return;

  const existing = await SavedView.findById(id).lean<SavedViewLean>();
  if (!existing) return;
  if (String(existing.userId) !== userId) {
    throw new AppError(403, "NOT_OWNER", "You do not own this saved view.");
  }

  await SavedView.deleteOne({ _id: id });

  await recordAudit({
    actorId: userId,
    actorEmail: "",
    ip: null,
    requestId: null,
    action: "saved-view.delete",
    entityType: "saved-view",
    entityId: id,
    before: { name: existing.name, scope: existing.scope },
  });
}
