/**
 * GET /api/clients — list clients (requires clients.view)
 * POST /api/clients — create client (requires clients.manage)
 */

import { NextResponse } from "next/server";
import { withAuth, checkClientAccess, getAccessibleClientIds, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("clients.view",
  async (req) => {
    const auth = (req as AuthedRequest).auth!;
    const clientsColl = await collection("clients");
    const search = req.nextUrl.searchParams.get("search") ?? "";
    const filter: Record<string, unknown> = {};
    if (search) {
      filter.$or = [
        { legalName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { preferredName: { $regex: search, $options: "i" } },
      ];
    }
    const docs = await clientsColl.find(filter).sort({ createdAt: -1 }).toArray();

    // Client access is derived from orders the user actually owns, never from
    // a client field compared against the user id (different id spaces).
    const accessibleClientIds = await getAccessibleClientIds(auth);
    const scoped = accessibleClientIds === null
      ? docs
      : docs.filter((c: any) => checkClientAccess(auth, c, accessibleClientIds));

    return NextResponse.json({
      clients: scoped.map((c: any) => ({
        id: String(c._id),
        legalName: c.legalName,
        preferredName: c.preferredName,
        email: c.email,
        phone: c.phone,
        status: c.status,
        sourceAgentId: c.sourceAgentId ?? null,
        notes: c.notes,
        createdAt: c.createdAt,
      })),
    });
  },
);

export const POST = withAuth("clients.manage",
  async (req) => {
    const { legalName, preferredName, email, phone, status, sourceAgentId, notes } = await req.json();
    if (!legalName || !email) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "legalName and email required." } }, { status: 400 });
    }

    const clients = await collection("clients");
    if (await clients.findOne({ email: email.toLowerCase() })) {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Client with this email already exists." } }, { status: 409 });
    }

    const result = await clients.insertOne({
      legalName,
      preferredName: preferredName ?? "",
      email: email.toLowerCase(),
      phone: phone ?? "",
      contacts: [],
      addresses: [],
      status: status ?? "Prospect",
      sourceAgentId: sourceAgentId ?? null,
      notes: notes ?? "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return NextResponse.json({
      client: { id: String(result.insertedId), legalName, preferredName: preferredName ?? "", email: email.toLowerCase() },
    }, { status: 201 });
  },
);
