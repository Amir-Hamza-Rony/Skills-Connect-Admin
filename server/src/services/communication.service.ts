import { Types } from "mongoose";

import { AppError } from "../lib/app-error.js";
import { Communication, type CommunicationAttrs, type CommunicationLean } from "../models/communications.model.js";
import { recordAudit } from "./audit.service.js";

export interface CommunicationActor {
  id: string;
  email: string;
  ip?: string | null;
  requestId?: string | null;
}

export interface CommunicationDTO {
  id: string;
  clientId: string;
  orderId: string | null;
  channel: CommunicationAttrs["channel"];
  direction: CommunicationAttrs["direction"];
  message: string;
  status: CommunicationAttrs["status"];
  sentAt: string | null;
  externalReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toCommDTO(doc: CommunicationLean): CommunicationDTO {
  return {
    id: String(doc._id),
    clientId: String(doc.clientId),
    orderId: doc.orderId ? String(doc.orderId) : null,
    channel: doc.channel,
    direction: doc.direction,
    message: doc.message,
    status: doc.status,
    sentAt: doc.sentAt ? doc.sentAt.toISOString() : null,
    externalReference: doc.externalReference,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export interface CommunicationListFilter {
  clientId?: string;
  orderId?: string;
  channel?: CommunicationAttrs["channel"];
  direction?: CommunicationAttrs["direction"];
  status?: CommunicationAttrs["status"];
}

/** `GET /communications` — list with filters. */
export async function listCommunications(filter: CommunicationListFilter = {}): Promise<CommunicationDTO[]> {
  const q: Record<string, unknown> = {};

  if (filter.clientId && Types.ObjectId.isValid(filter.clientId)) {
    q.clientId = new Types.ObjectId(filter.clientId);
  }
  if (filter.orderId && Types.ObjectId.isValid(filter.orderId)) {
    q.orderId = new Types.ObjectId(filter.orderId);
  }
  if (filter.channel) q.channel = filter.channel;
  if (filter.direction) q.direction = filter.direction;
  if (filter.status) q.status = filter.status;

  const docs = await Communication.find(q)
    .sort({ createdAt: -1 })
    .lean<CommunicationLean[]>();
  return docs.map(toCommDTO);
}

export interface CreateCommunicationInput {
  clientId: string;
  orderId?: string | null;
  channel: CommunicationAttrs["channel"];
  direction: CommunicationAttrs["direction"];
  message: string;
  status?: CommunicationAttrs["status"];
  sentAt?: Date | null;
  externalReference?: string | null;
}

/** `POST /communications` — create a communication log entry. */
export async function createCommunication(
  input: CreateCommunicationInput,
  actor: CommunicationActor,
): Promise<CommunicationDTO> {
  if (!Types.ObjectId.isValid(input.clientId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid clientId.");
  }
  if (input.orderId && !Types.ObjectId.isValid(input.orderId)) {
    throw AppError.badRequest("INVALID_ID", "Invalid orderId.");
  }

  const doc = await Communication.create({
    clientId: new Types.ObjectId(input.clientId),
    orderId: input.orderId ? new Types.ObjectId(input.orderId) : null,
    channel: input.channel,
    direction: input.direction,
    message: input.message.trim(),
    status: input.status ?? "sent",
    sentAt: input.sentAt ?? null,
    externalReference: input.externalReference ?? null,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    ip: actor.ip ?? null,
    requestId: actor.requestId ?? null,
    action: "communication.create",
    entityType: "communication",
    entityId: String(doc._id),
    after: {
      clientId: input.clientId,
      orderId: input.orderId ?? null,
      channel: input.channel,
      direction: input.direction,
      status: input.status,
    },
  });

  return toCommDTO(doc);
}
