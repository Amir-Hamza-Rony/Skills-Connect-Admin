import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { Client, type ClientAttrs, type ClientLean } from "../models/client.model.js";
import { recordAudit } from "./audit.service.js";

/** Shape the API returns — `_id` stringified, dates as ISO. */
export type ClientDTO = Omit<ClientAttrs, "sourceAgentId"> & {
  id: string;
  sourceAgentId: string | null;
};

export function toClientDTO(doc: ClientLean | ClientAttrs & { _id: Types.ObjectId }): ClientDTO {
  const obj = doc instanceof Client ? doc.toObject() : doc;
  const { _id, ...rest } = obj as ClientLean;
  return {
    ...rest,
    id: String(_id),
    sourceAgentId: rest.sourceAgentId ? String(rest.sourceAgentId) : null,
  };
}

export interface ClientListQuery {
  search?: string;
  status?: string;
  sourceAgentId?: string;
}

/**
 * `GET /clients` — list with optional search, status and owning-agent filters.
 *
 * Search matches legal name, preferred name, email and phone so a partial phone
 * number is enough to find a client at the front desk.
 */
export async function listClients(query: ClientListQuery = {}): Promise<ClientDTO[]> {
  const filter: Record<string, unknown> = {};

  if (query.status) filter.status = query.status;
  if (query.sourceAgentId && Types.ObjectId.isValid(query.sourceAgentId)) {
    filter.sourceAgentId = new Types.ObjectId(query.sourceAgentId);
  }
  if (query.search && query.search.trim()) {
    const term = query.search.trim();
    const or: Record<string, unknown>[] = [
      { legalName: new RegExp(escapeRegex(term), "i") },
      { preferredName: new RegExp(escapeRegex(term), "i") },
      { email: new RegExp(escapeRegex(term), "i") },
    ];
    // Phones are stored formatted ("0411 222 333") but people search for digits
    // ("222333"), so build a pattern that tolerates spaces between each digit
    // rather than looking for a literal substring.
    const digits = term.replace(/\D/g, "");
    if (digits.length >= 3) {
      or.push({ phone: new RegExp(digits.split("").join("\\s*")) });
    }
    filter.$or = or;
  }

  const docs = await Client.find(filter).sort({ createdAt: -1 }).lean<ClientLean[]>();
  return docs.map(toClientDTO);
}

export async function getClient(id: string): Promise<ClientDTO | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await Client.findById(id).lean<ClientLean>();
  return doc ? toClientDTO(doc) : null;
}

export interface CreateClientInput {
  legalName: string;
  preferredName?: string;
  phone?: string;
  email: string;
  address?: string;
  status?: string;
  sourceAgentId?: string | null;
  notes?: string;
}

/**
 * `POST /clients`.
 *
 * A duplicate email is rejected rather than silently merged: two client rows
 * for the same email break order attribution and the dedupe report exists
 * precisely so a human can decide which record survives. Auto-merging would
 * make that decision invisible.
 */
export async function createClient(
  input: CreateClientInput,
  actor: { id: string; email: string; ip?: string | null; requestId?: string | null },
): Promise<ClientDTO> {
  const email = input.email.trim().toLowerCase();
  if (await Client.exists({ email })) {
    // A specific code, not the generic CONFLICT: the dedupe report exists so a
    // human can merge these, and the client needs to know this is that case
    // rather than any other 409.
    //
    // Note there is no unique index behind this check, deliberately — see the
    // comment on `clientSchema` in the model. Two simultaneous creates of the
    // same new email can therefore both succeed, and the duplicate report picks
    // the result up. Making it airtight here would mean an index, and the index
    // would stop the report from ever having anything to find.
    throw new AppError(409, "DUPLICATE_CLIENT", `A client with email ${email} already exists.`);
  }

  const doc = await Client.create({
    legalName: input.legalName.trim(),
    preferredName: input.preferredName?.trim() ?? "",
    phone: input.phone?.trim() ?? "",
    email,
    address: input.address?.trim() ?? "",
    status: (input.status as ClientAttrs["status"]) ?? "Prospect",
    sourceAgentId: input.sourceAgentId ? new Types.ObjectId(input.sourceAgentId) : null,
    notes: input.notes ?? "",
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "client.create",
    entityType: "client",
    entityId: String(doc._id),
    after: { legalName: doc.legalName, email: doc.email, status: doc.status },
  });

  return toClientDTO(doc.toObject() as ClientLean);
}

export interface UpdateClientInput {
  legalName?: string;
  preferredName?: string;
  phone?: string;
  email?: string;
  address?: string;
  status?: string;
  sourceAgentId?: string | null;
  notes?: string;
}

/** `PATCH /clients/:id` — records before -> after in the audit trail. */
export async function updateClient(
  id: string,
  patch: UpdateClientInput,
  actor: { id: string; email: string; ip?: string | null; requestId?: string | null },
): Promise<ClientDTO | null> {
  if (!Types.ObjectId.isValid(id)) return null;
  const doc = await Client.findById(id).lean<ClientLean>();
  if (!doc) return null;

  const before: Record<string, unknown> = {
    legalName: doc.legalName,
    preferredName: doc.preferredName,
    phone: doc.phone,
    email: doc.email,
    address: doc.address,
    status: doc.status,
    sourceAgentId: doc.sourceAgentId ? String(doc.sourceAgentId) : null,
    notes: doc.notes,
  };

  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value !== undefined) set[key] = value;
  }
  if (set.email) set.email = String(set.email).trim().toLowerCase();
  if (set.sourceAgentId === null) {
    set.sourceAgentId = null;
  } else if (typeof set.sourceAgentId === "string" && Types.ObjectId.isValid(set.sourceAgentId)) {
    set.sourceAgentId = new Types.ObjectId(set.sourceAgentId);
  }

  await Client.updateOne({ _id: id }, { $set: set });

  const updated = await Client.findById(id).lean<ClientLean>();
  if (!updated) return null;

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "client.update",
    entityType: "client",
    entityId: id,
    before,
    after: {
      legalName: updated.legalName,
      preferredName: updated.preferredName,
      phone: updated.phone,
      email: updated.email,
      address: updated.address,
      status: updated.status,
      sourceAgentId: updated.sourceAgentId ? String(updated.sourceAgentId) : null,
      notes: updated.notes,
    },
  });

  return toClientDTO(updated);
}

/* ---------------- dedupe report ---------------- */

export interface DuplicateGroup {
  key: string;
  reason: string;
  clients: Array<{ id: string; legalName: string; email: string; phone: string; createdAt: string }>;
}

/**
 * `GET /clients/duplicates` — rows that look like the same person.
 *
 * Grouped by email and by normalised phone. Two different people can share a
 * phone (a parent and child), so a phone match is reported as a *possible*
 * duplicate rather than a certain one; an email match is reported as certain,
 * because the onboarding form uses email as the account identifier.
 */
export async function duplicateReport(): Promise<{ certain: DuplicateGroup[]; possible: DuplicateGroup[] }> {
  const clients = await Client.find().lean<ClientLean[]>();

  const byEmail = new Map<string, ClientLean[]>();
  const byPhone = new Map<string, ClientLean[]>();

  for (const c of clients) {
    const email = c.email.toLowerCase();
    push(byEmail, email, c);
    const digits = c.phone.replace(/\D/g, "");
    if (digits.length >= 6) push(byPhone, digits, c);
  }

  const certain: DuplicateGroup[] = [];
  const possible: DuplicateGroup[] = [];

  for (const [key, group] of byEmail) {
    if (group.length > 1) certain.push(toGroup(key, "email", group));
  }
  for (const [key, group] of byPhone) {
    if (group.length > 1) possible.push(toGroup(key, "phone", group));
  }

  certain.sort((a, b) => b.clients.length - a.clients.length);
  possible.sort((a, b) => b.clients.length - a.clients.length);

  return { certain, possible };
}

function push(map: Map<string, ClientLean[]>, key: string, client: ClientLean): void {
  const list = map.get(key);
  if (list) list.push(client);
  else map.set(key, [client]);
}

function toGroup(
  key: string,
  reason: "email" | "phone",
  group: ClientLean[],
): DuplicateGroup {
  return {
    key,
    reason,
    clients: group
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((c) => ({
        id: String(c._id),
        legalName: c.legalName,
        email: c.email,
        phone: c.phone,
        createdAt: c.createdAt.toISOString(),
      })),
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
