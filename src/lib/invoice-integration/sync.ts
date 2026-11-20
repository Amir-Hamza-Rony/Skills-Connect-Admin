/**
 * Provider-independent invoice sync orchestration.
 *
 * Responsibilities:
 *  - map an internal invoice document to a neutral request payload,
 *  - claim the invoice so concurrent syncs cannot double-send,
 *  - call the registered provider with a timeout,
 *  - persist external id / status / attempts / last error,
 *  - keep an append-only attempt log,
 *  - deduplicate: an already-synced invoice is never re-sent, and retries
 *    reuse the same idempotency key so the provider can dedupe too.
 */

import type { InvoiceExternalState } from "@/lib/types";
import { InvoiceIntegrationError } from "./types";
import type {
  ExternalInvoiceProvider,
  InvoiceSyncInput,
  InvoiceSyncResult,
} from "./types";

const DEFAULT_STALE_PENDING_MS = 5 * 60 * 1000;

export function defaultInvoiceExternalState(): InvoiceExternalState {
  return {
    status: "Not Synced",
    provider: null,
    externalInvoiceId: null,
    idempotencyKey: null,
    attempts: 0,
    lastAttemptAt: null,
    lastSyncedAt: null,
    lastError: null,
  };
}

function isoOrEmpty(value: unknown): string {
  if (!value) return "";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  return String(value);
}

/** Normalise a stored invoice's external state, tolerating legacy documents. */
export function externalStateOf(invoice: any): InvoiceExternalState {
  const base = defaultInvoiceExternalState();
  const stored = invoice?.external;
  if (!stored) {
    return { ...base, idempotencyKey: `invoice-sync:${String(invoice?._id ?? "")}` };
  }
  return {
    status: stored.status ?? base.status,
    provider: stored.provider ?? null,
    externalInvoiceId: stored.externalInvoiceId ?? null,
    idempotencyKey:
      stored.idempotencyKey ?? `invoice-sync:${String(invoice?._id ?? "")}`,
    attempts: Number(stored.attempts ?? 0),
    lastAttemptAt: stored.lastAttemptAt ?? null,
    lastSyncedAt: stored.lastSyncedAt ?? null,
    lastError: stored.lastError ?? null,
  };
}

/** Map only fields the internal invoice already owns. No provider guessing. */
export function mapInvoiceToSyncInput(
  invoice: any,
  idempotencyKey: string,
): InvoiceSyncInput {
  const currency = String(invoice?.currency ?? "AUD");
  const items = Array.isArray(invoice?.lineItems) ? invoice.lineItems : [];
  return {
    idempotencyKey,
    localInvoiceId: String(invoice?._id ?? ""),
    invoiceNumber: String(invoice?.invoiceNumber ?? ""),
    currency,
    total: Number(invoice?.total ?? 0),
    issueDate: isoOrEmpty(invoice?.issueDate),
    dueDate: isoOrEmpty(invoice?.dueDate),
    status: String(invoice?.status ?? "Draft"),
    orderId: String(invoice?.orderId ?? ""),
    lineItems: items.map((item: any) => ({
      id: String(item?.id ?? ""),
      description: String(item?.description ?? ""),
      amount: Number(item?.amount ?? 0),
      quantity: Number(item?.quantity ?? 0),
      taxAmount: Number(item?.taxAmount ?? 0),
      taxRate: Number(item?.taxRate ?? 0),
      currency: String(item?.currency ?? currency),
    })),
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  code: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new InvoiceIntegrationError(
            code,
            "External invoice provider request timed out.",
            504,
          ),
        ),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function toIntegrationError(err: unknown): InvoiceIntegrationError {
  if (err instanceof InvoiceIntegrationError) return err;
  const message =
    err && typeof (err as any).message === "string" && (err as any).message
      ? String((err as any).message).slice(0, 500)
      : "External invoice provider request failed.";
  return new InvoiceIntegrationError("PROVIDER_ERROR", message, 502);
}

async function logAttempt(
  attempts: any | undefined,
  doc: Record<string, unknown>,
): Promise<void> {
  if (!attempts) return;
  try {
    await attempts.insertOne({ ...doc, createdAt: new Date() });
  } catch {
    // Diagnostics must never break the primary sync flow.
  }
}

export interface SyncInvoiceArgs {
  invoice: any;
  provider: ExternalInvoiceProvider;
  /** `invoices` collection (any-typed to match the project's DB helper). */
  invoices: any;
  /** Optional `invoice_sync_attempts` collection. */
  attempts?: any;
  timeoutMs?: number;
  now?: Date;
  stalePendingMs?: number;
}

/**
 * Sync one invoice. Throws `InvoiceIntegrationError` on failure after the
 * failed state has been persisted, so callers can return a safe API error.
 */
export async function syncInvoiceWithProvider(
  args: SyncInvoiceArgs,
): Promise<InvoiceExternalState> {
  const {
    invoice,
    provider,
    invoices,
    attempts,
    timeoutMs = 15_000,
    now = new Date(),
    stalePendingMs = DEFAULT_STALE_PENDING_MS,
  } = args;

  const existing = externalStateOf(invoice);

  // Duplicate prevention: a successfully synced invoice is never re-sent.
  if (existing.status === "Synced" && existing.externalInvoiceId) {
    return existing;
  }

  const invoiceId = String(invoice?._id ?? "");
  const idempotencyKey = `invoice-sync:${invoiceId}`;
  const staleBefore = new Date(now.getTime() - stalePendingMs);

  // Claim atomically so two concurrent requests cannot both call the provider.
  const claimed = await invoices.findOneAndUpdate(
    {
      _id: invoice._id,
      $or: [
        { "external.status": { $ne: "Pending" } },
        { "external.lastAttemptAt": { $lt: staleBefore } },
      ],
    },
    {
      $set: {
        "external.status": "Pending",
        "external.provider": provider.name,
        "external.idempotencyKey": idempotencyKey,
        "external.lastAttemptAt": now,
        "external.lastError": null,
      },
      $inc: { "external.attempts": 1 },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    throw new InvoiceIntegrationError(
      "SYNC_IN_PROGRESS",
      "An invoice sync is already in progress.",
      409,
    );
  }

  const attempt = Number(claimed.external?.attempts ?? existing.attempts + 1);
  const startedAt = now.toISOString();
  const input = mapInvoiceToSyncInput(claimed, idempotencyKey);

  try {
    const result: InvoiceSyncResult = await withTimeout(
      provider.syncInvoice(input),
      timeoutMs,
      "PROVIDER_TIMEOUT",
    );
    if (!result || !result.externalInvoiceId) {
      throw new InvoiceIntegrationError(
        "INVALID_PROVIDER_RESPONSE",
        "The external invoice provider returned no invoice id.",
        502,
      );
    }

    const finishedAt = new Date();
    const externalInvoiceId = String(result.externalInvoiceId);
    await invoices.updateOne(
      { _id: invoice._id },
      {
        $set: {
          "external.status": "Synced",
          "external.externalInvoiceId": externalInvoiceId,
          "external.lastSyncedAt": finishedAt,
          "external.lastError": null,
          updatedAt: finishedAt,
        },
      },
    );

    await logAttempt(attempts, {
      invoiceId,
      provider: provider.name,
      attempt,
      status: "Synced",
      externalInvoiceId,
      error: null,
      startedAt,
      finishedAt: finishedAt.toISOString(),
    });

    return {
      status: "Synced",
      provider: provider.name,
      externalInvoiceId,
      idempotencyKey,
      attempts: attempt,
      lastAttemptAt: startedAt,
      lastSyncedAt: finishedAt.toISOString(),
      lastError: null,
    };
  } catch (err) {
    const error = toIntegrationError(err);
    const finishedAt = new Date();
    const lastError = { code: error.code, message: error.message };

    await invoices.updateOne(
      { _id: invoice._id },
      {
        $set: {
          "external.status": "Failed",
          "external.lastError": lastError,
          "external.lastAttemptAt": finishedAt,
          updatedAt: finishedAt,
        },
      },
    );

    await logAttempt(attempts, {
      invoiceId,
      provider: provider.name,
      attempt,
      status: "Failed",
      externalInvoiceId: null,
      error: lastError,
      startedAt,
      finishedAt: finishedAt.toISOString(),
    });

    throw error;
  }
}
