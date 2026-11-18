/**
 * GET /api/rpl-partners — list RPL partners with search/filter/pagination
 * POST /api/rpl-partners — create RPL partner with duplicate code prevention
 *
 * Requires `rplPartners.view` (list) or `rplPartners.manage` (create).
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { normalizeCode } from "@/lib/master-validation";

const LIST_PERM = "rplPartners.view";
const WRITE_PERM = "rplPartners.manage";

const VALID_STATUSES = new Set(["active", "inactive"]);

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid id format." } },
    { status: 400 },
  );
}

export const GET = withAuth(LIST_PERM,
  async (req: AuthedRequest) => {
    const { searchParams } = req.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const pageSize = Math.min(Math.max(1, Number(searchParams.get("pageSize") ?? 50)), 200);
    const search = (searchParams.get("search") ?? "").trim();
    const status = (searchParams.get("status") ?? "").trim();

    const coll = await collection("rpl_partners");
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (search) {
      const regex = new RegExp(String(search), "i");
      filter.$or = [
        { partnerCode: regex },
        { legalName: regex },
        { tradingName: regex },
        { email: regex },
        { contactPerson: regex },
      ];
    }

    const [docs, total] = await Promise.all([
      coll
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .toArray(),
      coll.countDocuments(filter),
    ]);

    return NextResponse.json({
      items: docs.map((d: any) => ({ id: String(d._id), ...d })),
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    });
  },
);

export const POST = withAuth(WRITE_PERM,
  async (req: AuthedRequest) => {
    const auth = req.auth!;
    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "Invalid request body." } },
        { status: 400 },
      );
    }

    const partnerCode = normalizeCode(body.partnerCode);
    const legalName = String(body.legalName ?? "").trim();
    if (!partnerCode || !legalName) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "partnerCode and legalName are required." } },
        { status: 400 },
      );
    }

    const coll = await collection("rpl_partners");
    const existing = await coll.findOne({ partnerCode });
    if (existing) {
      return NextResponse.json(
        { error: { code: "CONFLICT", message: `Partner code ${partnerCode} already exists.` } },
        { status: 409 },
      );
    }

    const status = VALID_STATUSES.has(String(body.status ?? "active"))
      ? String(body.status)
      : "active";
    const now = new Date();

    const result = await coll.insertOne({
      partnerCode,
      legalName,
      tradingName: body.tradingName ? String(body.tradingName).trim() || null : null,
      contactPerson: body.contactPerson ? String(body.contactPerson).trim() || null : null,
      email: body.email ? String(body.email).trim() || null : null,
      phone: body.phone ? String(body.phone).trim() || null : null,
      address: body.address ? String(body.address).trim() || null : null,
      status,
      notes: body.notes ? String(body.notes).trim() || null : null,
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      entityType: "rpl_partner",
      entityId: String(result.insertedId),
      action: "create",
      before: null,
      after: { partnerCode, legalName, status },
    });

    return NextResponse.json(
      { rplPartner: { id: String(result.insertedId), partnerCode, legalName, status } },
      { status: 201 },
    );
  },
);
