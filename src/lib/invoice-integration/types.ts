/**
 * Provider-independent external invoice integration contract.
 *
 * No provider is implemented or assumed here. A provider is registered by the
 * eventual integration (once real documentation and credentials are supplied)
 * and must implement this interface. The internal invoice/payment system works
 * without any provider registered.
 */

export type { InvoiceExternalState } from "@/lib/types";

export interface InvoiceSyncLineItem {
  id: string;
  description: string;
  amount: number;
  quantity: number;
  taxAmount: number;
  taxRate: number;
  currency: string;
}

/**
 * Request/response-neutral invoice payload. Fields are intentionally limited
 * to what the internal invoice already stores; provider-specific customer or
 * tax-code mapping is deliberately absent until the provider contract is known.
 */
export interface InvoiceSyncInput {
  /** Stable deduplication key; retries must reuse the same value. */
  idempotencyKey: string;
  localInvoiceId: string;
  invoiceNumber: string;
  currency: string;
  total: number;
  issueDate: string;
  dueDate: string;
  status: string;
  orderId: string;
  lineItems: InvoiceSyncLineItem[];
}

export interface InvoiceSyncResult {
  externalInvoiceId: string;
  /**
   * Optional raw provider payload for diagnostics. Never include secrets,
   * tokens or credentials here; it is stored in an internal attempt log.
   */
  raw?: unknown;
}

export interface ExternalInvoiceProvider {
  readonly name: string;
  syncInvoice(input: InvoiceSyncInput): Promise<InvoiceSyncResult>;
}

/** A typed failure raised by the integration layer or a provider. */
export class InvoiceIntegrationError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 502) {
    super(message);
    this.name = "InvoiceIntegrationError";
    this.code = code;
    this.status = status;
  }
}
