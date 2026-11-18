/**
 * GET /api/certificate-deliveries — list certificate deliveries with filter/pagination
 * POST /api/certificate-deliveries — create a certificate delivery record
 *
 * Requires `rplPartners.view` (list) or `rplPartners.manage` (create).
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

const LIST_PERM = "rplPartners.view";
const WRITE_PERM = "rplPartners.manage";

const VALID_STATUSES = new Set(["pending", "dispatched", "delivered", "failed"]);

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
    const orderId = (searchParams.get("orderId") ?? "").trim();
    const status = (searchParams.get("status") ?? "").trim();

    const coll = await collection("certificate_deliveries");
    const filter: Record<string, unknown> = {};
    if (orderId) {
      const oid = safeObjectId(orderId);
      if (oid) filter.orderId = oid;
    }
    if (status) filter.deliveryStatus = status;

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

    const orderId = body.orderId;
    if (!orderId) {
      return NextResponse.json(
        { error: { code: "BAD_REQUEST", message: "orderId is required." } },
        { status: 400 },
      );
    }
    const orderOid = safeObjectId(String(orderId));
    if (!orderOid) return invalidId();

    // Validate order exists.
    const order = await (await collection("orders")).findOne({ _id: orderOid });
    if (!order) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Order not found." } },
        { status: 404 },
      );
    }

    const coll = await collection("certificate_deliveries");
    const status = VALID_STATUSES.has(String(body.deliveryStatus ?? "pending"))
      ? String(body.deliveryStatus)
      : "pending";
    const now = new Date();

    const result = await coll.insertOne({
      orderId: orderOid,
      certificateReference: body.certificateReference ? String(body.certificateReference).trim() || null : null,
      deliveryStatus: status,
      deliveryDate: body.deliveryDate ? String(body.deliveryDate) : null,
      recipient: body.recipient ? String(body.recipient).trim() || null : null,
      deliveryMethod: body.deliveryMethod ? String(body.deliveryMethod).trim() || null : null,
      trackingNumber: body.trackingNumber ? String(body.trackingNumber).trim() || null : null,
      confirmationDetails: body.confirmationDetails ? String(body.confirmationDetails).trim() || null : null,
      deliveryNotes: body.deliveryNotes ? String(body.deliveryNotes).trim() || null : null,
      updatedBy: auth.userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit({
      actorId: auth.userId,
      actorEmail: auth.email,
      entityType: "certificate_delivery",
      entityId: String(result.insertedId),
      action: "create",
      before: null,
      after: { orderId: String(orderId), deliveryStatus: status },
    });

    return NextResponse.json(
      { certificateDelivery: { id: String(result.insertedId), orderId: String(orderId), deliveryStatus: status } },
      { status: 201 },
    );
  },
);
