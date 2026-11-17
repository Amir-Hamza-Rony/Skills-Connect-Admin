/**
 * GET /api/clients/[id] — single client
 * PATCH /api/clients/[id] — update client
 */

import { NextResponse } from "next/server";
import { withAuth, checkClientAccess, getAccessibleClientIds, type AuthedRequest } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("clients.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const auth = (req as AuthedRequest).auth!;
    const clients = await collection("clients");
    const client = await clients.findOne({ _id: toObjectId(id) });
    if (!client) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Client not found." } }, { status: 404 });

    const accessibleClientIds = await getAccessibleClientIds(auth);
    if (!checkClientAccess(auth, client, accessibleClientIds)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this client." } }, { status: 403 });
    }
    return NextResponse.json({ id: String(client._id), legalName: client.legalName, email: client.email, phone: client.phone, status: client.status });
  },
);

export const PATCH = withAuth("clients.manage",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const auth = (req as AuthedRequest).auth!;
    const patch = await req.json();
    const clients = await collection("clients");
    const client = await clients.findOne({ _id: toObjectId(id) });
    if (!client) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Client not found." } }, { status: 404 });

    const accessibleClientIds = await getAccessibleClientIds(auth);
    if (!checkClientAccess(auth, client, accessibleClientIds)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this client." } }, { status: 403 });
    }
    const update: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of ["legalName", "preferredName", "email", "phone", "status", "sourceAgentId", "notes"]) {
      if (patch[k] !== undefined) update[k] = patch[k];
    }
    await clients.updateOne({ _id: toObjectId(id) }, { $set: update });
    return NextResponse.json({ ok: true });
  },
);
