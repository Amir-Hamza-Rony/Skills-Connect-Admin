/**
 * POST /api/invoices/[id]/void — void an invoice (requires finance.manage)
 * Mirrors Express `POST /invoices/:id/void`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import { collection, toObjectId } from "@/lib/db";

export const POST = withAuth("finance.manage",
  async (req: NextRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    let invoiceId;
    try {
      invoiceId = toObjectId(id);
    } catch {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid invoice id." } },
        { status: 400 },
      );
    }

    const invoices = await collection("invoices");
    const invoice = await invoices.findOne({ _id: invoiceId });
    if (!invoice) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Invoice not found." } },
        { status: 404 },
      );
    }

    await invoices.updateOne(
      { _id: invoiceId },
      { $set: { status: "Void", updatedAt: new Date() } },
    );

    return NextResponse.json({ invoice: { id: String(invoiceId), status: "Void" } });
  },
);
