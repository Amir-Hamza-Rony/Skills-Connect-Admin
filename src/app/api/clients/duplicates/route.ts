/**
 * GET /api/clients/duplicates — possible and certain duplicate people
 * Mirrors Express `GET /clients/duplicates`. Requires clients.view.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection } from "@/lib/db";

export const GET = withAuth("clients.view",
  async (req: NextRequest) => {
    const clients = await collection("clients");
    const docs = await clients.find().toArray();

    const byEmail = new Map<string, any[]>();
    const byPhone = new Map<string, any[]>();

    for (const c of docs) {
      const email = String(c.email ?? "").toLowerCase();
      if (email) {
        const list = byEmail.get(email) ?? [];
        list.push(c);
        byEmail.set(email, list);
      }

      const contacts = c.contacts ?? [];
      const phoneContacts = contacts.filter(
        (ct: any) => ct.type === "phone" || ct.type === "whatsapp",
      );
      const primary = phoneContacts.find((ct: any) => ct.primary) ?? phoneContacts[0];
      const digits = String(primary?.value ?? "").replace(/\D/g, "");
      if (digits.length >= 6) {
        const list = byPhone.get(digits) ?? [];
        list.push(c);
        byPhone.set(digits, list);
      }
    }

    const certain: Array<{ key: string; reason: string; clients: Array<{ id: string; legalName: string; email: string; phone: string; createdAt: string }> }> = [];
    const possible: Array<{ key: string; reason: string; clients: Array<{ id: string; legalName: string; email: string; phone: string; createdAt: string }> }> = [];

    for (const [key, group] of byEmail) {
      if (group.length > 1) {
        certain.push({
          key,
          reason: "email",
          clients: group
            .slice()
            .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((c: any) => ({
              id: String(c._id),
              legalName: c.legalName,
              email: c.email,
              phone: "",
              createdAt: c.createdAt,
            })),
        });
      }
    }
    for (const [key, group] of byPhone) {
      if (group.length > 1) {
        possible.push({
          key,
          reason: "phone",
          clients: group
            .slice()
            .sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
            .map((c: any) => ({
              id: String(c._id),
              legalName: c.legalName,
              email: c.email,
              phone: "",
              createdAt: c.createdAt,
            })),
        });
      }
    }

    certain.sort((a, b) => b.clients.length - a.clients.length);
    possible.sort((a, b) => b.clients.length - a.clients.length);

    return NextResponse.json({ certain, possible });
  },
);
