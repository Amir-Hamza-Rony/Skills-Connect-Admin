/**
 * GET /api/orders/[id]/checklist — document requirements for an order
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const GET = withAuth("documents.view",
  async (req, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;
    const docReqs = await collection("document_requirements");
    const docs = await docReqs.find({ orderId: toObjectId(id) }).toArray();
    const requirements = docs.map((d: any) => ({ id: String(d._id), type: d.type, status: d.status }));
    return NextResponse.json({ requirements });
  },
);