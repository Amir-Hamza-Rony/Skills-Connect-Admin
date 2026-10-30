/**
 * GET /api/orders — list orders (requires orders.view)
 * POST /api/orders — create order (requires orders.manage)
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("orders.view",
  async (req) => {
    const orders = await collection("orders");
    const { searchParams } = req.nextUrl;
    const filter: Record<string, unknown> = {};
    const status = searchParams.get("status");
    const clientId = searchParams.get("clientId");
    if (status) filter.status = status;
    if (clientId) filter.clientId = toObjectId(clientId);

    const docs = await orders.find(filter).sort({ createdAt: -1 }).toArray();
    return NextResponse.json({
      orders: docs.map((o: any) => ({
        id: String(o._id),
        clientId: String(o.clientId),
        qualificationId: String(o.qualificationId),
        salesAgentId: String(o.salesAgentId),
        sourceAgentId: String(o.sourceAgentId),
        rtoId: String(o.rtoId),
        status: o.status,
        sellingPrice: o.sellingPrice,
        supplierCostSnapshot: o.supplierCostSnapshot,
        otherCost: o.otherCost,
        certificateStatus: o.certificateStatus,
        createdAt: o.createdAt,
      })),
    });
  },
);

export const POST = withAuth("orders.manage",
  async (req) => {
    const { clientId, qualificationId, salesAgentId, sourceAgentId, rtoId, sellingPrice, otherCost = 0 } = await req.json();
    if (!clientId || !qualificationId || !salesAgentId || !sourceAgentId || !rtoId || sellingPrice === undefined) {
      return NextResponse.json({ error: { code: "BAD_REQUEST", message: "Missing required fields." } }, { status: 400 });
    }

    const clients = await collection("clients");
    const client = await clients.findOne({ _id: toObjectId(clientId) });
    if (!client) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Client not found." } }, { status: 404 });

    const now = new Date();
    const orders = await collection("orders");
    const result = await orders.insertOne({
      clientId: toObjectId(clientId),
      qualificationId: toObjectId(qualificationId),
      salesAgentId: toObjectId(salesAgentId),
      sourceAgentId: toObjectId(sourceAgentId),
      rtoId: toObjectId(rtoId),
      status: "New",
      evidenceStatus: "Not Started",
      rtoSubmissionStatus: "Not Ready",
      certificateStatus: "Not Issued",
      sellingPrice: Number(sellingPrice),
      supplierCostSnapshot: 0,
      otherCost: Number(otherCost),
      currency: "AUD",
      completedAt: null,
      history: [{ timestamp: now, field: "status", before: "—", after: "New" }],
      createdAt: now,
      updatedAt: now,
    });

    const docReqs = await collection("document_requirements");
    await docReqs.insertMany([
      "Identity (passport / licence)", "USI transcript", "Employment evidence", "Reference letter", "Photos / skills evidence", "RTO enrolment kit"
    ].map((t) => ({ orderId: result.insertedId, type: t, status: "Not Received", createdAt: now })));

    const certs = await collection("certificates");
    await certs.insertOne({ orderId: result.insertedId, status: "Not Issued", createdAt: now });

    return NextResponse.json({ order: { id: String(result.insertedId) } }, { status: 201 });
  },
);