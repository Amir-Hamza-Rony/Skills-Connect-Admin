/**
 * GET /api/communications — list communications with filters (requires clients.view)
 * POST /api/communications — log a client communication (requires clients.manage)
 * Mirrors Express `GET/POST /communications`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

const VALID_CHANNELS = ["email", "sms", "whatsapp", "phone", "letter"];
const VALID_DIRECTIONS = ["inbound", "outbound"];
const VALID_STATUSES = ["sent", "delivered", "read", "failed", "bounced"];

/** `GET /api/communications` — list with filters. */
export const GET = withAuth("clients.view",
  async (req: NextRequest) => {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get("clientId");
    const orderId = searchParams.get("orderId");
    const channel = searchParams.get("channel");
    const direction = searchParams.get("direction");
    const status = searchParams.get("status");

    const filter: Record<string, unknown> = {};
    if (clientId) {
      try { filter.clientId = toObjectId(clientId); } catch {}
    }
    if (orderId) {
      try { filter.orderId = toObjectId(orderId); } catch {}
    }
    if (channel && VALID_CHANNELS.includes(channel)) filter.channel = channel;
    if (direction && VALID_DIRECTIONS.includes(direction)) filter.direction = direction;
    if (status && VALID_STATUSES.includes(status)) filter.status = status;

    const comms = await collection("communications");
    const docs = await comms.find(filter).sort({ createdAt: -1 }).toArray();

    return NextResponse.json({
      communications: docs.map((d: any) => ({
        id: String(d._id),
        clientId: String(d.clientId),
        orderId: d.orderId ? String(d.orderId) : null,
        channel: d.channel,
        direction: d.direction,
        message: d.message,
        status: d.status,
        sentAt: d.sentAt,
        externalReference: d.externalReference ?? null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      })),
    });
  },
);

/** `POST /api/communications` — log a client communication. */
export const POST = withAuth("clients.manage",
  async (req: NextRequest) => {
    const { clientId, orderId, channel, direction, message, status, sentAt, externalReference } = await req.json();

    if (!clientId) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "clientId is required." } }, { status: 400 });
    }
    if (!channel || !VALID_CHANNELS.includes(channel)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid channel." } }, { status: 400 });
    }
    if (!direction || !VALID_DIRECTIONS.includes(direction)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid direction." } }, { status: 400 });
    }
    if (!message || typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "message is required." } }, { status: 400 });
    }

    try { toObjectId(clientId); } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid clientId." } }, { status: 400 });
    }
    if (orderId) {
      try { toObjectId(orderId); } catch {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid orderId." } }, { status: 400 });
      }
    }

    const userId = (req as any)?.auth?.userId;
    const now = new Date();
    const comms = await collection("communications");
    const result = await comms.insertOne({
      clientId: toObjectId(clientId),
      orderId: orderId ? toObjectId(orderId) : null,
      channel,
      direction,
      message: message.trim(),
      status: status ?? "sent",
      sentAt: sentAt ? new Date(sentAt) : null,
      externalReference: externalReference ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return NextResponse.json({
      communication: {
        id: String(result.insertedId),
        clientId,
        orderId: orderId ?? null,
        channel,
        direction,
        message: message.trim(),
        status: status ?? "sent",
        sentAt: sentAt ?? null,
        externalReference: externalReference ?? null,
        createdAt: now,
        updatedAt: now,
      },
    }, { status: 201 });
  },
);
