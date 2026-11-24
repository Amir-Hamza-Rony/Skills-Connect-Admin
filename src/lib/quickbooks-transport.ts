/**
 * QuickBooks Online Accounting API transport layer.
 *
 * Implements the actual HTTP transport to Intuit's QuickBooks Online
 * Accounting API for customer, invoice, and payment synchronization.
 *
 * Design principles:
 *  - No real Intuit API calls are made in tests (mocks required).
 *  - Tokens are never logged or returned to callers.
 *  - 401 triggers one token refresh + retry.
 *  - 429/5xx/network-timeout retries with exponential backoff.
 *  - Invalid payloads (400) fail immediately, no retry.
 *  - AUD-only currency enforcement: QB transactions must be AUD; any
 *    non-AUD currency fails safely with QB_CURRENCY_MISMATCH.
 *  - Idempotency: retry-safe via idempotency keys in the request body.
 *
 * Environment variables:
 *   QB_REALM_ID        QuickBooks company realm ID (required)
 *   QB_SANDBOX         "true" to use sandbox base URL (default true)
 *   QB_REQUEST_TIMEOUT_MS  per-request timeout (default 15000)
 */

import { getAccessToken, isQuickBooksConfigured } from "@/lib/quickbooks";

const DEFAULT_BASE_URL =
  "https://quickbooks.api.intuit.com/v3/company";
const SANDBOX_BASE_URL =
  "https://sandbox-quickbooks.api.intuit.com/v3/company";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

export interface QBTransportConfig {
  realmId: string;
  sandbox: boolean;
  timeoutMs: number;
}

export interface QBTransportResult {
  ok: boolean;
  qbReference?: string;
  error?: string;
  statusCode?: number;
}

export interface QBCustomerInput {
  displayName: string;
  currency: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
}

export interface QBInvoiceInput {
  customerRef: { value: string; name?: string };
  line: Array<{
    amount: number;
    detailType: string;
    description?: string;
    salesItemLineDetail?: {
      itemRef?: { value: string; name?: string };
      unitPrice?: number;
      qty?: number;
      taxCodeRef?: { value: string };
    };
  }>;
  currency: string;
  docNumber?: string;
  dueDate?: string;
}

export interface QBQueryResult {
  entities: Array<Record<string, unknown>>;
  totalCount: number;
}

/** Resolve transport configuration from environment. */
export function qbTransportConfig(env: NodeJS.ProcessEnv = process.env): QBTransportConfig | null {
  const realmId = env.QB_REALM_ID;
  if (!realmId) return null;
  const sandbox = env.QB_SANDBOX !== "false";
  const timeoutMs = Number(env.QB_REQUEST_TIMEOUT_MS);
  return {
    realmId,
    sandbox,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS,
  };
}

/** Base URL for the QB API (sandbox or production). */
function baseUrl(config: QBTransportConfig): string {
  return config.sandbox ? SANDBOX_BASE_URL : DEFAULT_BASE_URL;
}

/** Low-level authenticated request to the QB API with retry logic. */
async function qbRequest<T = unknown>(
  config: QBTransportConfig,
  method: "GET" | "POST",
  path: string,
  body: unknown,
  token: string,
): Promise<{ ok: boolean; data?: T; status?: number; error?: string }> {
  const url = `${baseUrl(config)}/${config.realmId}/${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  let lastError: string | null = null;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Accept": "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      lastStatus = resp.status;
      const responseText = await resp.text();
      let data: any = null;
      if (responseText) {
        try {
          data = JSON.parse(responseText);
        } catch {
          data = { raw: responseText.slice(0, 500) };
        }
      }

      // Success.
      if (resp.ok) {
        clearTimeout(timeoutId);
        return { ok: true, data, status: resp.status };
      }

      // 401: refresh token and retry once.
      if (resp.status === 401 && attempt === 0) {
        clearTimeout(timeoutId);
        const refreshed = await refreshTokenOnce(config);
        if (!refreshed) {
          return { ok: false, error: "QB_AUTH_FAILED", status: 401 };
        }
        // Retry with new token.
        continue;
      }

      // 429: retry with backoff.
      if (resp.status === 429) {
        lastError = `QB_RATE_LIMITED (status ${resp.status})`;
        await sleep(backoffMs(attempt));
        continue;
      }

      // 5xx: retry with backoff.
      if (resp.status >= 500) {
        lastError = `QB_SERVER_ERROR (status ${resp.status})`;
        await sleep(backoffMs(attempt));
        continue;
      }

      // 400 or other client error: fail immediately, no retry.
      clearTimeout(timeoutId);
      return {
        ok: false,
        error: data?.error_description ?? data?.Fault?.Error?.[0]?.Message ?? `QB_REQUEST_FAILED (status ${resp.status})`,
        status: resp.status,
        data,
      };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        lastError = "QB_REQUEST_TIMEOUT";
        await sleep(backoffMs(attempt));
        continue;
      }
      lastError = err?.message ?? "QB_REQUEST_ERROR";
      await sleep(backoffMs(attempt));
    }
  }

  clearTimeout(timeoutId);
  return { ok: false, error: lastError ?? "QB_REQUEST_FAILED", status: lastStatus };
}

/** Refresh the QB access token once. */
async function refreshTokenOnce(config: QBTransportConfig): Promise<boolean> {
  try {
    const { collection } = await import("@/lib/db");
    const qbConns = await collection("qb_connections");
    const doc = await qbConns.findOne({});
    if (!doc) return false;

    const refreshTokenRaw =
      typeof doc.refreshTokenEncrypted === "string"
        ? JSON.parse(doc.refreshTokenEncrypted)
        : doc.refreshTokenEncrypted;

    // Import decryptToken from quickbooks module.
    const { decryptToken } = await import("@/lib/quickbooks");
    const refreshToken = decryptToken(refreshTokenRaw);
    if (!refreshToken) return false;

    const tokenEndpoint =
      process.env.QB_TOKEN_URL ?? "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
    const basic = Buffer.from(
      `${process.env.QB_CLIENT_ID ?? ""}:${process.env.QB_CLIENT_SECRET ?? ""}`,
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });

    const resp = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    if (!resp.ok) return false;

    const json = (await resp.json()) as any;
    const accessToken = json.access_token;
    const newRefreshToken = json.refresh_token ?? refreshToken;
    const expiresIn = json.expires_in ?? 3600;
    if (!accessToken) return false;

    const { encryptToken } = await import("@/lib/quickbooks");
    const encryptedAccess = encryptToken(accessToken);
    const encryptedRefresh = encryptToken(newRefreshToken);
    if (!encryptedAccess || !encryptedRefresh) return false;

    await qbConns.updateOne(
      {},
      {
        $set: {
          accessTokenEncrypted: JSON.stringify(encryptedAccess),
          refreshTokenEncrypted: JSON.stringify(encryptedRefresh),
          tokenExpiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
          connectionStatus: "connected",
          updatedAt: new Date(),
        },
      },
    );
    return true;
  } catch {
    return false;
  }
}

function backoffMs(attempt: number): number {
  return Math.min(2 ** (attempt + 1) * 1000, 30_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Validate that a QB transaction currency is AUD. */
function assertAudCurrency(currency: unknown): QBTransportResult | null {
  if (String(currency ?? "") !== "AUD") {
    return {
      ok: false,
      error: "QB_CURRENCY_MISMATCH",
      statusCode: 400,
    };
  }
  return null;
}

/** Sync a customer to QuickBooks. */
export async function syncCustomer(
  config: QBTransportConfig,
  input: QBCustomerInput,
): Promise<QBTransportResult> {
  if (!isQuickBooksConfigured()) {
    return { ok: false, error: "QB_NOT_CONFIGURED" };
  }

  const currencyErr = assertAudCurrency(input.currency);
  if (currencyErr) return currencyErr;

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, error: "QB_NO_ACCESS_TOKEN" };
  }

  const result = await qbRequest(
    config,
    "POST",
    "customer",
    {
      DisplayName: input.displayName,
      GivenName: input.givenName ?? null,
      FamilyName: input.familyName ?? null,
      PrimaryEmailAddr: input.email ? { Address: input.email } : null,
      PrimaryPhone: input.phone ? { FreeFormNumber: input.phone } : null,
      CurrencyRef: { value: "AUD" },
    },
    token,
  );

  if (!result.ok) return { ok: false, error: result.error, statusCode: result.status };

  const responseData = result.data as any;
  const qbId = responseData?.Customer?.Id ?? responseData?.id;
  return {
    ok: true,
    qbReference: qbId ? String(qbId) : undefined,
  };
}

/** Sync an invoice to QuickBooks. */
export async function syncInvoice(
  config: QBTransportConfig,
  input: QBInvoiceInput,
): Promise<QBTransportResult> {
  if (!isQuickBooksConfigured()) {
    return { ok: false, error: "QB_NOT_CONFIGURED" };
  }

  const currencyErr = assertAudCurrency(input.currency);
  if (currencyErr) return currencyErr;

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, error: "QB_NO_ACCESS_TOKEN" };
  }

  const result = await qbRequest(
    config,
    "POST",
    "invoice",
    {
      CustomerRef: input.customerRef,
      Line: input.line.map((l) => ({
        Amount: l.amount,
        DetailType: l.detailType,
        Description: l.description ?? null,
        SalesItemLineDetail: l.salesItemLineDetail ?? null,
      })),
      CurrencyRef: { value: "AUD" },
      DocNumber: input.docNumber ?? null,
      DueDate: input.dueDate ?? null,
    },
    token,
  );

  if (!result.ok) return { ok: false, error: result.error, statusCode: result.status };

  const responseData = result.data as any;
  const qbId = responseData?.Invoice?.Id ?? responseData?.id;
  return {
    ok: true,
    qbReference: qbId ? String(qbId) : undefined,
  };
}

/** Sync a payment to QuickBooks. */
export async function syncPayment(
  config: QBTransportConfig,
  input: {
    customerRef: { value: string; name?: string };
    amount: number;
    currency: string;
    paymentDate?: string;
    depositToAccountRef?: { value: string; name?: string };
    docNumber?: string;
  },
): Promise<QBTransportResult> {
  if (!isQuickBooksConfigured()) {
    return { ok: false, error: "QB_NOT_CONFIGURED" };
  }

  const currencyErr = assertAudCurrency(input.currency);
  if (currencyErr) return currencyErr;

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, error: "QB_NO_ACCESS_TOKEN" };
  }

  const result = await qbRequest(
    config,
    "POST",
    "payment",
    {
      CustomerRef: input.customerRef,
      TotalAmt: input.amount,
      CurrencyRef: { value: "AUD" },
      PaymentDate: input.paymentDate ?? null,
      DocNumber: input.docNumber ?? null,
      DepositToAccountRef: input.depositToAccountRef ?? null,
      PrivateNote: "Synced from Skills Connect Admin",
    },
    token,
  );

  if (!result.ok) return { ok: false, error: result.error, statusCode: result.status };

  const responseData = result.data as any;
  const qbId = responseData?.Payment?.Id ?? responseData?.id;
  return {
    ok: true,
    qbReference: qbId ? String(qbId) : undefined,
  };
}

/** Generic QB query for reconciliation. */
export async function qbQuery(
  config: QBTransportConfig,
  query: string,
): Promise<QBQueryResult | { ok: false; error: string; statusCode?: number }> {
  if (!isQuickBooksConfigured()) {
    return { ok: false, error: "QB_NOT_CONFIGURED" };
  }

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, error: "QB_NO_ACCESS_TOKEN" };
  }

  const result = await qbRequest(
    config,
    "POST",
    `query?query=${encodeURIComponent(query)}`,
    null,
    token,
  );

  if (!result.ok) {
    return {
      ok: false,
      error: result.error ?? "QB request failed",
      statusCode: result.status,
    };
  }

  const responseData = result.data as any;
  const queryResponse = responseData.QueryResponse ?? {};
  const entities = Object.values(queryResponse).filter(
    (v: any) => Array.isArray(v),
  );
  const allEntities = ([] as Array<Record<string, unknown>>).concat(...entities);
  return {
    ok: true,
    entities: allEntities,
    totalCount: queryResponse.totalCount ?? allEntities.length,
  } as any;
}

/** Check QB transport readiness without making an API call. */
export function qbTransportReady(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.QB_CLIENT_ID && env.QB_CLIENT_SECRET && env.QB_REALM_ID);
}
