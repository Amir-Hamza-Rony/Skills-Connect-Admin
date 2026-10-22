import { Router } from "express";
import { z } from "zod";

import { requireAuth } from "../middleware/require-auth.js";
import { requirePermission } from "../middleware/require-permission.js";
import { auditContextFrom } from "../services/audit.service.js";
import {
  createCommunication,
  listCommunications,
  type CommunicationActor,
} from "../services/communication.service.js";

export const communicationsRouter: Router = Router();

communicationsRouter.use(requireAuth);

/** `GET /communications` — list, filterable by client, order, channel, direction, status. */
communicationsRouter.get(
  "/",
  requirePermission("clients.view"),
  async (req, res) => {
    const q = req.query;
    const clientId = typeof q.clientId === "string" ? q.clientId : undefined;
    const orderId = typeof q.orderId === "string" ? q.orderId : undefined;
    const channel =
      q.channel === "email" || q.channel === "sms" || q.channel === "whatsapp" ||
      q.channel === "phone" || q.channel === "letter"
        ? q.channel
        : undefined;
    const direction =
      q.direction === "inbound" || q.direction === "outbound" ? q.direction : undefined;
    const status =
      q.status === "sent" || q.status === "delivered" || q.status === "read" ||
      q.status === "failed" || q.status === "bounced"
        ? q.status
        : undefined;

    res.json({
      communications: await listCommunications({
        clientId,
        orderId,
        channel,
        direction,
        status,
      }),
    });
  },
);

const commBody = z.object({
  clientId: z.string().min(1),
  orderId: z.string().min(1).optional().nullable(),
  channel: z.enum(["email", "sms", "whatsapp", "phone", "letter"]),
  direction: z.enum(["inbound", "outbound"]),
  message: z.string().trim().min(1).max(5000),
  status: z.enum(["sent", "delivered", "read", "failed", "bounced"]).optional(),
  sentAt: z.string().max(10).optional(),
  externalReference: z.string().trim().max(200).optional().nullable(),
});

/** `POST /communications` — log a client communication. */
communicationsRouter.post(
  "/",
  requirePermission("clients.manage"),
  async (req, res) => {
    const body = commBody.parse(req.body);
    const comm = await createCommunication(
      {
        clientId: body.clientId,
        orderId: body.orderId ?? null,
        channel: body.channel,
        direction: body.direction,
        message: body.message,
        status: body.status ?? "sent",
        sentAt: body.sentAt ? new Date(`${body.sentAt}T00:00:00.000Z`) : null,
        externalReference: body.externalReference ?? null,
      },
      {
        ...auditContextFrom(req),
        id: req.auth!.userId,
        email: req.auth!.email,
      },
    );
    res.status(201).json({ communication: comm });
  },
);

export type { CommunicationActor };
