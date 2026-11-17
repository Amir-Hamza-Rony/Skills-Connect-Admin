/**
 * GET /api/clients/duplicates — possible and certain duplicate people
 * Mirrors Express `GET /clients/duplicates`. Requires clients.view.
 *
 * M1.3: scoping mirrors GET /api/clients — a non-admin can only see duplicate
 * groups built from clients linked to orders they own (S10). Phone values come
 * from the real `phone` field now persisted at create/update time, with the
 * legacy `contacts` array as a fallback for older records.
 */

import { NextResponse } from "next/server";
import { withAuth, checkClientAccess, getAccessibleClientIds, type AuthedRequest } from "@/middleware/auth";
import { collection } from "@/lib/db";

interface DuplicateClient {
  id: string;
  legalName: string;
  email: string;
  phone: string;
  createdAt: unknown;
}

function contactPhone(c: any): string {
  const contacts = c.contacts ?? [];
  const phoneContacts = contacts.filter(
    (ct: any) => ct.type === "phone" || ct.type === "whatsapp",
  );
  const primary = phoneContacts.find((ct: any) => ct.primary) ?? phoneContacts[0];
  return String(primary?.value ?? "");
}

function phoneOf(c: any): string {
  // Prefer the real top-level field; fall back to contacts for legacy docs.
  return String(c.phone ?? "").trim() || contactPhone(c);
}

export const GET = withAuth("clients.view",
  async (req) => {
    const auth = (req as AuthedRequest).auth!;
    const clients = await collection("clients");
    const docs = await clients.find().toArray();

    // --- Data scoping: same helper contract as every other client route ---
    const accessibleClientIds = await getAccessibleClientIds(auth);
    const scoped = accessibleClientIds === null
      ? docs
      : docs.filter((c: any) => checkClientAccess(auth, c, accessibleClientIds));

    const byEmail = new Map<string, any[]>();
    const byPhone = new Map<string, any[]>();

    for (const c of scoped) {
      const email = String(c.email ?? "").toLowerCase();
      if (email) {
        const list = byEmail.get(email) ?? [];
        list.push(c);
        byEmail.set(email, list);
      }

      const digits = phoneOf(c).replace(/\D/g, "");
      if (digits.length >= 6) {
        const list = byPhone.get(digits) ?? [];
        list.push(c);
        byPhone.set(digits, list);
      }
    }

    const mapClients = (group: any[]): DuplicateClient[] =>
      group
        .slice()
        .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .map((c: any) => ({
          id: String(c._id),
          legalName: c.legalName,
          email: c.email,
          phone: phoneOf(c),
          createdAt: c.createdAt,
        }));

    const certain: Array<{ key: string; reason: string; clients: DuplicateClient[] }> = [];
    const possible: Array<{ key: string; reason: string; clients: DuplicateClient[] }> = [];

    for (const [key, group] of byEmail) {
      if (group.length > 1) {
        certain.push({ key, reason: "email", clients: mapClients(group) });
      }
    }
    for (const [key, group] of byPhone) {
      if (group.length > 1) {
        possible.push({ key, reason: "phone", clients: mapClients(group) });
      }
    }

    certain.sort((a, b) => b.clients.length - a.clients.length);
    possible.sort((a, b) => b.clients.length - a.clients.length);

    return NextResponse.json({ certain, possible });
  },
);
