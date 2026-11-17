/**
 * GET /api/clients/[id] — single client
 * PATCH /api/clients/[id] — update client
 */

import { NextResponse } from "next/server";
import { withAuth, checkClientAccess, getAccessibleClientIds, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
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

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

type Ctx = { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined };

async function resolveId(ctx: Ctx): Promise<string> {
  const params = await (ctx?.params ?? {});
  return String(params.id ?? "");
}

export const GET = withAuth("clients.view",
  async (req, ctx: Ctx) => {
    const auth = (req as AuthedRequest).auth!;
    const oid = safeObjectId(await resolveId(ctx));
    if (!oid) return invalidId();

    const clients = await collection("clients");
    const client = await clients.findOne({ _id: oid });
    if (!client) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Client not found." } }, { status: 404 });

    const accessibleClientIds = await getAccessibleClientIds(auth);
    if (!checkClientAccess(auth, client, accessibleClientIds)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this client." } }, { status: 403 });
    }
    // {client} envelope matches createClient / ops-store.getClient (F2).
    return NextResponse.json({ client: toPublicClient(client) });
  },
);

export const PATCH = withAuth("clients.manage",
  async (req, ctx: Ctx) => {
    const auth = (req as AuthedRequest).auth!;
    const oid = safeObjectId(await resolveId(ctx));
    if (!oid) return invalidId();

    let patch: Record<string, unknown>;
    try {
      patch = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid request body." } }, { status: 400 });
    }

    const clients = await collection("clients");
    const client = await clients.findOne({ _id: oid });
    if (!client) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Client not found." } }, { status: 404 });

    const accessibleClientIds = await getAccessibleClientIds(auth);
    if (!checkClientAccess(auth, client, accessibleClientIds)) {
      return NextResponse.json({ error: { code: "FORBIDDEN", message: "Not authorized to access this client." } }, { status: 403 });
    }

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (patch.legalName !== undefined) {
      const value = typeof patch.legalName === "string" ? patch.legalName.trim() : "";
      if (!value) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "legalName may not be empty." } }, { status: 400 });
      }
      update.legalName = value;
    }
    if (patch.preferredName !== undefined) update.preferredName = normalizeOptionalString(patch.preferredName) ?? "";
    if (patch.email !== undefined) {
      const email = normalizeEmail(patch.email);
      if (!isValidEmail(email)) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid email format." } }, { status: 400 });
      }
      if (!(await isClientEmailUnique(email, String(client._id)))) {
        return NextResponse.json({ error: { code: "CONFLICT", message: "Client with this email already exists." } }, { status: 409 });
      }
      update.email = email;
    }
    if (patch.phone !== undefined) update.phone = normalizeOptionalString(patch.phone) ?? "";
    if (patch.status !== undefined) update.status = normalizeOptionalString(patch.status) ?? "Prospect";
    if (patch.sourceAgentId !== undefined) update.sourceAgentId = normalizeOptionalString(patch.sourceAgentId);
    if (patch.notes !== undefined) update.notes = typeof patch.notes === "string" ? patch.notes : "";

    if (patch.dob !== undefined) {
      const value = normalizeOptionalString(patch.dob);
      if (value !== null && !isValidDateString(value)) {
        return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid dob." } }, { status: 400 });
      }
      update.dob = value;
    }
    if (patch.usiNumber !== undefined) update.usiNumber = normalizeOptionalString(patch.usiNumber);
    if (patch.visaStatus !== undefined) update.visaStatus = normalizeOptionalString(patch.visaStatus);
    if (patch.externalReferrerName !== undefined) update.externalReferrerName = normalizeOptionalString(patch.externalReferrerName);
    if (patch.referredByStudentId !== undefined) {
      const value = normalizeOptionalString(patch.referredByStudentId);
      if (value !== null) {
        if (!isValidObjectIdString(value) || !(await referencedClientExists(value))) {
          return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Invalid referredByStudentId." } }, { status: 400 });
        }
      }
      update.referredByStudentId = value;
    }
    if (patch.contacts !== undefined) update.contacts = normalizeContacts(patch.contacts);
    if (patch.addresses !== undefined) update.addresses = normalizeAddresses(patch.addresses);

    // Body-supplied owner / agent-space fields are never copied (D5 / M0).
    try {
      await clients.updateOne({ _id: oid }, { $set: update });
    } catch (err: any) {
      if (err?.code === 11000) {
        return NextResponse.json({ error: { code: "CONFLICT", message: "A client with this USI already exists." } }, { status: 409 });
      }
      throw err;
    }

    const updated = await clients.findOne({ _id: oid });
    const result = toPublicClient(updated ?? { _id: oid, ...client, ...update });

    await writeAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      entityType: "client",
      entityId: String(oid),
      action: "update",
      before: toPublicClient(client),
      after: result,
    });

    return NextResponse.json({ client: result });
  },
);
