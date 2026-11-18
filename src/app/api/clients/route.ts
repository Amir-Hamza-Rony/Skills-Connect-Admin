/**
 * GET /api/clients — list clients (requires clients.view)
 * POST /api/clients — create client (requires clients.manage)
 */

import { NextResponse } from "next/server";
import { withAuth, checkClientAccess, getAccessibleClientIds, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  isClientEmailUnique,
  isValidDateString,
  isValidEmail,
  isValidObjectIdString,
  normalizeAddresses,
  normalizeContacts,
  normalizeEmail,
  normalizeOptionalString,
  referencedClientExists,
  toPublicClient,
} from "@/lib/client-validation";

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
    const auth = (req as AuthedRequest).auth!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const legalName = typeof body.legalName === "string" ? body.legalName.trim() : "";
    const email = normalizeEmail(body.email);
    if (!legalName || !email) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "legalName and email required." } }, { status: 400 });
    }
    if (!isValidEmail(email)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid email format." } }, { status: 400 });
    }

    // Objective validation only. No enum for status/visa (B6/B7), no USI regex,
    // and no DB-level email uniqueness — app-level dedupe matches B11.
    const dob = normalizeOptionalString(body.dob);
    if (dob !== null && !isValidDateString(dob)) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid dob." } }, { status: 400 });
    }
    const referredByStudentId = normalizeOptionalString(body.referredByStudentId);
    if (referredByStudentId !== null) {
      if (!isValidObjectIdString(referredByStudentId) || !(await referencedClientExists(referredByStudentId))) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid referredByStudentId." } }, { status: 400 });
      }
    }

    const clients = await collection("clients");
    if (!(await isClientEmailUnique(email))) {
      return NextResponse.json({ error: { code: "CONFLICT", message: "Client with this email already exists." } }, { status: 409 });
    }

    const now = new Date();
    const doc: Record<string, unknown> = {
      legalName,
      preferredName: normalizeOptionalString(body.preferredName) ?? "",
      email,
      phone: normalizeOptionalString(body.phone) ?? "",
      contacts: normalizeContacts(body.contacts),
      addresses: normalizeAddresses(body.addresses),
      status: normalizeOptionalString(body.status) ?? "Prospect",
      sourceAgentId: normalizeOptionalString(body.sourceAgentId),
      notes: typeof body.notes === "string" ? body.notes : "",
      // PII persisted; not returned until B8 decides role visibility.
      dob,
      usiNumber: normalizeOptionalString(body.usiNumber),
      visaStatus: normalizeOptionalString(body.visaStatus),
      referredByStudentId,
      externalReferrerName: normalizeOptionalString(body.externalReferrerName),
      createdAt: now,
      updatedAt: now,
    };

    let insertedId;
    try {
      const result = await clients.insertOne(doc);
      insertedId = result.insertedId;
    } catch (err: any) {
      // The M1.2 unique partial index on usiNumber can reject a duplicate value.
      if (err?.code === 11000) {
        return NextResponse.json({ error: { code: "CONFLICT", message: "A client with this email or USI already exists." } }, { status: 409 });
      }
      throw err;
    }

    const client = toPublicClient({ _id: insertedId, ...doc });
    await writeAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      entityType: "client",
      entityId: String(insertedId),
      action: "create",
      after: client,
    });

    return NextResponse.json({ client }, { status: 201 });
  },
);
