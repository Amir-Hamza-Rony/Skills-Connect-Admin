import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import {
  Agent,
  type AgentAttrs,
  type AgentLean,
  type AgentType,
} from "../models/agent.model.js";
import {
  Qualification,
  type QualificationAttrs,
  type QualificationLean,
} from "../models/qualification.model.js";
import { Rto, type RtoAttrs, type RtoLean } from "../models/rto.model.js";
import {
  SupplierRoute,
  type SupplierRouteAttrs,
  type SupplierRouteLean,
} from "../models/supplier-route.model.js";
import { recordAudit } from "./audit.service.js";

/**
 * Master data services (BACKEND-PLAN §4, B3).
 *
 * ## Why this file exists at all
 *
 * The B3 commit created all four Mongoose schemas but shipped no service and no
 * routes for them, so the frontend kept serving agents, qualifications, RTOs
 * and supplier pricing from `src/mocks/seed.ts` in memory. That meant the
 * pricing matrix an order snapshots its cost from was not the same data the
 * pricing screen displayed — an operator could change a cost in one place and
 * the order form would still offer the old one.
 *
 * ## Nothing is hard-deleted
 *
 * These rows are referenced by orders. Agents and RTOs deactivate, supplier
 * routes expire, qualifications are superseded. A hard delete would orphan an
 * order's snapshot history or break a client profile that renders the name.
 */

export interface Actor {
  id: string;
  email: string;
  ip?: string | null;
  requestId?: string | null;
}

/** Strips `_id` into a string `id` so the DTO shape matches the rest of the API. */
function toDTO<T extends { _id: Types.ObjectId }>(doc: T): T & { id: string } {
  return { ...doc, id: String(doc._id) };
}

/* ------------------------------- agents ------------------------------- */

export type AgentDTO = Omit<AgentAttrs, never> & { id: string };

export async function listAgents(filter?: {
  type?: AgentType;
  active?: boolean;
  search?: string;
}): Promise<AgentDTO[]> {
  const query: Record<string, unknown> = {};
  if (filter?.type) query.type = filter.type;
  if (filter?.active !== undefined) query.active = filter.active;
  if (filter?.search) query.name = { $regex: escapeRegex(filter.search), $options: "i" };

  const docs = await Agent.find(query).sort({ name: 1 }).lean<AgentLean[]>();
  return docs.map((d) => toDTO(d));
}

export async function createAgent(input: Omit<AgentAttrs, "createdAt" | "updatedAt">, actor: Actor): Promise<AgentDTO> {
  const doc = await Agent.create(input);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "agent.create",
    entityType: "agent",
    entityId: String(doc._id),
    after: { name: input.name, type: input.type },
  });

  return toDTO(doc.toObject() as AgentLean);
}

export async function updateAgent(
  id: string,
  patch: Partial<Omit<AgentAttrs, "createdAt" | "updatedAt">>,
  actor: Actor,
): Promise<AgentDTO | null> {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest("INVALID_ID", "Invalid agent id.");

  const before = await Agent.findById(id).lean<AgentLean>();
  if (!before) return null;

  const doc = await Agent.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: "after" },
  ).lean<AgentLean>();
  if (!doc) return null;

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "agent.update",
    entityType: "agent",
    entityId: id,
    before: { name: before.name, type: before.type, active: before.active },
    after: { name: doc.name, type: doc.type, active: doc.active },
  });

  return toDTO(doc);
}

/* --------------------------- qualifications --------------------------- */

export type QualificationDTO = Omit<QualificationAttrs, never> & { id: string };

export async function listQualifications(filter?: {
  status?: QualificationAttrs["status"];
  search?: string;
}): Promise<QualificationDTO[]> {
  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.search) {
    const safe = escapeRegex(filter.search);
    query.$or = [{ code: { $regex: safe, $options: "i" } }, { title: { $regex: safe, $options: "i" } }];
  }

  const docs = await Qualification.find(query).sort({ code: 1 }).lean<QualificationLean[]>();
  return docs.map((d) => toDTO(d));
}

export async function createQualification(
  input: Omit<QualificationAttrs, "createdAt" | "updatedAt">,
  actor: Actor,
): Promise<QualificationDTO> {
  try {
    const doc = await Qualification.create(input);

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
      action: "qualification.create",
      entityType: "qualification",
      entityId: String(doc._id),
      after: { code: input.code, title: input.title },
    });

    return toDTO(doc.toObject() as QualificationLean);
  } catch (err) {
    // `code` is unique. Surface it as a conflict rather than a 500, so the
    // pricing screen can tell the operator what actually went wrong.
    if (isDuplicateKey(err)) {
      throw AppError.conflict(`Qualification code "${input.code}" already exists.`);
    }
    throw err;
  }
}

/* --------------------------------- RTOs -------------------------------- */

export type RtoDTO = Omit<RtoAttrs, never> & { id: string };

export async function listRtos(filter?: {
  status?: RtoAttrs["status"];
  search?: string;
}): Promise<RtoDTO[]> {
  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  if (filter?.search) {
    const safe = escapeRegex(filter.search);
    query.$or = [
      { legalName: { $regex: safe, $options: "i" } },
      { tradingName: { $regex: safe, $options: "i" } },
      { rtoCode: { $regex: safe, $options: "i" } },
    ];
  }

  const docs = await Rto.find(query).sort({ legalName: 1 }).lean<RtoLean[]>();
  return docs.map((d) => toDTO(d));
}

export async function createRto(
  input: Omit<RtoAttrs, "createdAt" | "updatedAt">,
  actor: Actor,
): Promise<RtoDTO> {
  try {
    const doc = await Rto.create(input);

    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      ip: actor.ip ?? null,
      requestId: actor.requestId ?? null,
      action: "rto.create",
      entityType: "rto",
      entityId: String(doc._id),
      after: { legalName: input.legalName, rtoCode: input.rtoCode },
    });

    return toDTO(doc.toObject() as RtoLean);
  } catch (err) {
    if (isDuplicateKey(err)) {
      throw AppError.conflict(`RTO code "${input.rtoCode}" already exists.`);
    }
    throw err;
  }
}

/* ---------------------------- supplier routes ---------------------------- */

export type SupplierRouteDTO = Omit<SupplierRouteAttrs, never> & { id: string };

export async function listSupplierRoutes(filter?: {
  status?: SupplierRouteAttrs["status"];
  qualificationId?: string;
  sourceAgentId?: string;
  rtoId?: string;
}): Promise<SupplierRouteDTO[]> {
  const query: Record<string, unknown> = {};
  if (filter?.status) query.status = filter.status;
  for (const key of ["qualificationId", "sourceAgentId", "rtoId"] as const) {
    const value = filter?.[key];
    if (value) {
      if (!Types.ObjectId.isValid(value)) return [];
      query[key] = new Types.ObjectId(value);
    }
  }

  const docs = await SupplierRoute.find(query).sort({ createdAt: -1 }).lean<SupplierRouteLean[]>();
  return docs.map((d) => toDTO(d));
}

export async function createSupplierRoute(
  input: {
    qualificationId: string;
    sourceAgentId: string;
    rtoId: string;
    wholesaleCost: number;
    effectiveFrom?: string;
  },
  actor: Actor,
): Promise<SupplierRouteDTO> {
  for (const key of ["qualificationId", "sourceAgentId", "rtoId"] as const) {
    if (!Types.ObjectId.isValid(input[key])) {
      throw AppError.badRequest("INVALID_ID", `Invalid ${key}.`);
    }
  }

  // A second active route for the same triple would make "what does this cost
  // today?" ambiguous, and order creation picks whichever the index returns
  // first. Expiring the old one is the operator's job, via /expire.
  const clash = await SupplierRoute.findOne({
    qualificationId: new Types.ObjectId(input.qualificationId),
    sourceAgentId: new Types.ObjectId(input.sourceAgentId),
    rtoId: new Types.ObjectId(input.rtoId),
    status: "active",
  }).lean();

  if (clash) {
    throw AppError.conflict(
      "An active route already exists for that qualification, agent and RTO. Expire it first.",
    );
  }

  const doc = await SupplierRoute.create({
    qualificationId: new Types.ObjectId(input.qualificationId),
    sourceAgentId: new Types.ObjectId(input.sourceAgentId),
    rtoId: new Types.ObjectId(input.rtoId),
    wholesaleCost: input.wholesaleCost,
    currency: "AUD",
    effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
    effectiveTo: null,
    status: "active",
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "supplier_route.create",
    entityType: "supplier_route",
    entityId: String(doc._id),
    after: { wholesaleCost: input.wholesaleCost },
  });

  return toDTO(doc.toObject() as SupplierRouteLean);
}

/**
 * Expires a route.
 *
 * Soft expiry, never a delete: orders already created hold their own snapshot,
 * so expiring changes nothing about them — which is the point. An order created
 * afterwards is refused until a new route is added.
 */
export async function expireSupplierRoute(
  id: string,
  effectiveTo: string | undefined,
  actor: Actor,
): Promise<SupplierRouteDTO | null> {
  if (!Types.ObjectId.isValid(id)) {
    throw AppError.badRequest("INVALID_ID", "Invalid supplier route id.");
  }

  const before = await SupplierRoute.findById(id).lean<SupplierRouteLean>();
  if (!before) return null;
  if (before.status === "expired") {
    throw AppError.unprocessable("ALREADY_EXPIRED", "This route is already expired.");
  }

  const when = effectiveTo ? new Date(effectiveTo) : new Date();
  const doc = await SupplierRoute.findByIdAndUpdate(
    id,
    { $set: { status: "expired", effectiveTo: when } },
    { returnDocument: "after" },
  ).lean<SupplierRouteLean>();
  if (!doc) return null;

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "supplier_route.expire",
    entityType: "supplier_route",
    entityId: id,
    before: { status: before.status, wholesaleCost: before.wholesaleCost },
    after: { status: "expired", effectiveTo: when.toISOString() },
  });

  return toDTO(doc);
}

/* ------------------------------- helpers ------------------------------- */

/**
 * Escapes a user-supplied search term before it reaches a `$regex`.
 *
 * Without this, a query of `.*` matches everything and `(` throws — and a term
 * containing `$` can reference a capture group. This is the shared helper the
 * route-level ad-hoc copies should all be using (§6 "filter sanitization").
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").slice(0, 100);
}

function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === 11000
  );
}
