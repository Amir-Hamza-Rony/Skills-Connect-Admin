/**
 * GET /api/clients — list clients (requires clients.view)
 * POST /api/clients — create client (requires clients.manage)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { checkClientAccess } from "@/middleware/auth";

export const GET = withAuth("clients.view",
  async (req) => {
    const auth = (req as AuthedRequest).auth!;
    const clients = await collection("users"); // placeholder removed below
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

    const role = auth.role ?? (auth.roleNames?.[0] as string | undefined);
    const userId = auth.userId;
    if (role !== "SUPER_ADMIN" && role !== "ADMIN") {
      // BDC / B2B_AGENT: only see clients linked to their own agent id
      const filtered = docs.filter((c: any) => checkClientAccess(auth, c));
      return NextResponse.json({
        clients: filtered.map((c: any) => ({
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
    }

    return NextResponse.json({
      clients: docs.map((c: any) => ({
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
