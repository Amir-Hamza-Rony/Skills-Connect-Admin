/**
 * POST /api/invoices/[id]/void — void an invoice (requires finance.manage)
 * Mirrors Express `POST /invoices/:id/void`.
 */

import { NextRequest, NextResponse } from "next/server";
import { withAuth, requirePermission } from "@/middleware/auth";
import type { AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

export const POST = withAuth("finance.manage",
  async (req: NextRequest, { params }: { params?: Promise<Record<string, unknown>> | Record<string, unknown> | undefined }) => {
    const resolvedParams = await (params ?? {});
    const { id } = resolvedParams;

    const invoiceOid = safeObjectId(id);
    if (!invoiceOid) {
      return NextResponse.json(
        { error: { code: "INVALID_ID", message: "Invalid invoice id." } },
        { status: 400 },
      );
    }

    const actor = (req as AuthedRequest).auth!;

    const invoices = await collection("invoices");
    const invoice = await invoices.findOne({ _id: invoiceOid });
    if (!invoice) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Invoice not found." } },
        { status: 404 },
      );
    }

    const before = invoice.status;

    await invoices.updateOne(
      { _id: invoiceOid },
      { $set: { status: "Void", updatedAt: new Date() } },
    );

    await writeAudit({
      actorId: actor.userId,
      actorEmail: actor.email,
      entityType: "invoice",
      entityId: String(id),
      action: "void",
      before: { status: before },
      after: { status: "Void" },
    });

    return NextResponse.json({ invoice: { id: String(invoiceOid), status: "Void" } });
  },
);
