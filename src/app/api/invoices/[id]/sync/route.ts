/**
 * POST /api/invoices/[id]/sync — push one invoice to the configured external
 * provider (provider-independent adapter).
 * GET  /api/invoices/[id]/sync — read the current external sync state.
 *
 * The endpoint fails closed when no provider is configured/registered. The
 * internal invoice, payment, allocation and void flows do not depend on it.
 *
 * No provider is hardcoded and no credential or provider response is returned
 * to the caller. Configuration comes only from environment variables.
 */

import { NextResponse } from "next/server";
import { withAuth, type AuthedRequest } from "@/middleware/auth";
import { collection, safeObjectId } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import {
  InvoiceIntegrationError,
  externalStateOf,
  readInvoiceIntegrationConfig,
  resolveInvoiceProvider,
  syncInvoiceWithProvider,
} from "@/lib/invoice-integration";

function invalidId() {
  return NextResponse.json(
    { error: { code: "INVALID_ID", message: "Invalid invoice id." } },
    { status: 400 },
  );
}

function errorResponse(err: unknown) {
  if (err instanceof InvoiceIntegrationError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message } },
      { status: err.status },
    );
  }
  return NextResponse.json(
    { error: { code: "SERVER_ERROR", message: "Invoice sync failed." } },
    { status: 500 },
  );
}

function invoiceView(invoice: any) {
  return {
    id: String(invoice._id),
    orderId: String(invoice.orderId),
    invoiceNumber: invoice.invoiceNumber,
    total: invoice.total,
    currency: invoice.currency,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    status: invoice.status,
    external: externalStateOf(invoice),
  };
}

export const GET = withAuth("finance.view",
  async (
    _req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const { id } = await (params ?? {});
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    const invoice = await (await collection("invoices")).findOne({ _id: oid });
    if (!invoice) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Invoice not found." } },
        { status: 404 },
      );
    }
    return NextResponse.json({ external: externalStateOf(invoice) });
  },
);

export const POST = withAuth("finance.manage",
  async (
    req: AuthedRequest,
    { params }: { params?: Promise<{ id?: string }> | { id?: string } | undefined },
  ) => {
    const { id } = await (params ?? {});
    const oid = safeObjectId(id);
    if (!oid) return invalidId();

    const actor = req.auth!;
    const invoices = await collection("invoices");
    const invoice = await invoices.findOne({ _id: oid });
    if (!invoice) {
      return NextResponse.json(
        { error: { code: "NOT_FOUND", message: "Invoice not found." } },
        { status: 404 },
      );
    }
    if (invoice.status === "Void") {
      return NextResponse.json(
        { error: { code: "INVOICE_VOID", message: "A void invoice cannot be synced." } },
        { status: 400 },
      );
    }

    const config = readInvoiceIntegrationConfig();

    try {
      const provider = resolveInvoiceProvider(config);
      const external = await syncInvoiceWithProvider({
        invoice,
        provider,
        invoices,
        attempts: await collection("invoice_sync_attempts"),
        timeoutMs: config.timeoutMs,
      });

      const updated = await invoices.findOne({ _id: oid });
      await writeAudit({
        actorId: actor.userId,
        actorEmail: actor.email,
        entityType: "invoice",
        entityId: String(id),
        action: "sync",
        before: invoice.external ?? null,
        after: external,
      });

      return NextResponse.json({
        invoice: invoiceView(updated ?? { ...invoice, external }),
      });
    } catch (err) {
      return errorResponse(err);
    }
  },
);
