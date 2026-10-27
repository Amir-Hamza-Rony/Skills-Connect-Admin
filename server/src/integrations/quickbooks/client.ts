import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import {
  isExpired,
  loadQBTokens,
  saveQBTokens,
  type QBTokens,
} from "../../models/qb-connection.model.js";

/**
 * QuickBooks Online API client (BACKEND-PLAN B5, `integrations/quickbooks/`).
 *
 * ## Why a hand-rolled client rather than the official SDK
 *
 * The SDK pulls in a large dependency tree and version-pins the endpoints. The
 * surface actually needed here is two POSTs and a token refresh, so this is
 * plain `fetch` against the documented v3 API. Keeping it dependency-free also
 * means the integration can be reviewed without reading someone else's code.
 *
 * ## Nothing here throws
 *
 * Every function returns a `QBApiResult`. A transport failure must be recorded
 * on the sync record as a retryable `Failed` state, not propagate as an
 * exception that would fail the user's `POST /invoices` after the invoice was
 * already written.
 */

/** QB rejects an unspecified minor version; 75 is the minimum currently accepted. */
const MINOR_VERSION = "75";

/** QuickBooks access tokens live one hour. */
const TOKEN_LIFETIME_MS = 60 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 15_000;

export interface QBApiResult<T> {
  ok: boolean;
  data?: T;
  /** Present on failure; safe to persist (it is shown in the sync queue UI). */
  error?: string;
  /** True when the failure was auth-related and a token refresh may fix it. */
  authError?: boolean;
}

function apiBase(): string {
  return env.QB_API_BASE_URL;
}

/** True when the static app credentials needed to talk to QB are present. */
export function isQuickBooksConfigured(): boolean {
  return Boolean(env.QB_REALM_ID && env.QB_CLIENT_ID && env.QB_CLIENT_SECRET);
}

/**
 * The URL an admin visits to authorise the company.
 *
 * Exposed so the settings screen can link to it rather than hardcoding the
 * Intuit consent page somewhere in the frontend.
 */
export function authorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env.QB_CLIENT_ID ?? "",
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting",
    redirect_uri: "http://localhost:4000/integrations/quickbooks/callback",
    state,
  });
  return `${env.QB_AUTH_URL}?${params.toString()}`;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  x_refresh_token_expires_in?: number;
  scope?: string;
}

/** Reads the token response and turns any QB error shape into one message. */
async function readTokenResponse(res: Response): Promise<QBApiResult<TokenResponse>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: `QuickBooks token endpoint returned HTTP ${res.status}.` };
  }

  if (!res.ok) {
    const record = (body ?? {}) as { error?: string; error_description?: string };
    return {
      ok: false,
      error: record.error_description ?? record.error ?? `Token request failed (${res.status}).`,
      authError: true,
    };
  }

  const token = body as TokenResponse;
  if (!token.access_token || !token.refresh_token) {
    return { ok: false, error: "QuickBooks token response was missing credentials." };
  }
  return { ok: true, data: token };
}

/**
 * Exchanges an OAuth authorization code for a token pair and stores it.
 *
 * Called from the callback route after an admin authorises the company.
 */
export async function exchangeCodeForTokens(
  code: string,
  realmId: string,
): Promise<QBApiResult<QBTokens>> {
  if (!env.QB_CLIENT_ID || !env.QB_CLIENT_SECRET) {
    return { ok: false, error: "QuickBooks is not configured (client id/secret not set)." };
  }

  try {
    const res = await fetchWithTimeout(env.QB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code, realmId }).toString(),
    });

    const result = await readTokenResponse(res);
    if (!result.ok || !result.data) return { ok: false, error: result.error, authError: true };

    const tokens: QBTokens = {
      realmId,
      accessToken: result.data.access_token,
      refreshToken: result.data.refresh_token,
      expiresAt: Date.now() + (result.data.expires_in || TOKEN_LIFETIME_MS / 1000) * 1000,
      scope: result.data.scope ?? "",
    };
    await saveQBTokens(tokens);
    return { ok: true, data: tokens };
  } catch (err) {
    return { ok: false, error: `Could not reach QuickBooks: ${(err as Error).message}` };
  }
}

/** Refreshes an expiring access token using the stored refresh token. */
async function refreshTokens(tokens: QBTokens): Promise<QBApiResult<QBTokens>> {
  if (!env.QB_CLIENT_ID || !env.QB_CLIENT_SECRET) {
    return { ok: false, error: "QuickBooks is not configured (client id/secret not set)." };
  }

  try {
    const res = await fetchWithTimeout(env.QB_TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${env.QB_CLIENT_ID}:${env.QB_CLIENT_SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
      }).toString(),
    });

    const result = await readTokenResponse(res);
    if (!result.ok || !result.data) return { ok: false, error: result.error, authError: true };

    const next: QBTokens = {
      realmId: tokens.realmId,
      accessToken: result.data.access_token,
      // QB rotates refresh tokens; the new one must replace the old or the
      // connection dies on the next refresh.
      refreshToken: result.data.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + (result.data.expires_in || TOKEN_LIFETIME_MS / 1000) * 1000,
      scope: result.data.scope ?? tokens.scope,
    };
    await saveQBTokens(next);
    return { ok: true, data: next };
  } catch (err) {
    return { ok: false, error: `Could not reach QuickBooks: ${(err as Error).message}` };
  }
}

/**
 * Returns a usable access token, refreshing it first when it is about to expire.
 *
 * A 60-second skew means a sync that starts just before expiry does not send a
 * request that is guaranteed to come back 401 mid-flight.
 */
export async function getAccessToken(): Promise<QBApiResult<QBTokens>> {
  if (!isQuickBooksConfigured()) {
    return {
      ok: false,
      error: "QuickBooks is not configured (QB_REALM_ID / QB_CLIENT_ID not set).",
    };
  }

  const tokens = await loadQBTokens();
  if (!tokens) {
    return {
      ok: false,
      error:
        "QuickBooks is not authorised yet — complete the OAuth connect for this company first.",
    };
  }

  if (!isExpired(tokens.expiresAt)) return { ok: true, data: tokens };

  logger.info({ realmId: tokens.realmId }, "QuickBooks access token expiring — refreshing");
  return refreshTokens(tokens);
}

/** The identifying fields QuickBooks returns on every created entity. */
export interface QBEntityRef {
  Id: string;
  SyncToken?: string;
  domain?: string;
}

export interface QBCreatedEntity {
  Invoice?: QBEntityRef;
  Payment?: QBEntityRef;
}

interface QBErrorBody {
  Fault?: {
    Error?: Array<{ Message?: string; Detail?: string; code?: string }>;
  };
}

/** Flattens QB's `Fault.Error[]` into one persistable line. */
function describeFault(body: unknown, status: number): string {
  const fault = (body as QBErrorBody)?.Fault?.Error;
  if (Array.isArray(fault) && fault.length > 0) {
    return fault
      .map((e) => [e.Message, e.Detail].filter(Boolean).join(": "))
      .join("; ")
      .slice(0, 500);
  }
  return `QuickBooks returned HTTP ${status}.`;
}

/**
 * POSTs a body to the company-scoped v3 API.
 *
 * `retried` guards against a refresh loop: a request that fails with 401 *after*
 * a refresh has already been attempted is reported as failed rather than
 * refreshing again forever.
 */
async function qbPost(
  entityPath: string,
  body: unknown,
  retried = false,
): Promise<QBApiResult<QBCreatedEntity>> {
  const auth = await getAccessToken();
  if (!auth.ok || !auth.data) {
    return { ok: false, error: auth.error ?? "QuickBooks authorisation failed." };
  }

  const url = `${apiBase()}/v3/company/${encodeURIComponent(auth.data.realmId)}/${entityPath}?minorversion=${MINOR_VERSION}`;

  let res: Response;
  try {
    res = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.data.accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: `Could not reach QuickBooks: ${(err as Error).message}` };
  }

  if (res.status === 401 && !retried) {
    // The token expired between our check and the call. Force a refresh once.
    await refreshTokens(auth.data);
    return qbPost(entityPath, body, true);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      error: describeFault(parsed, res.status),
      authError: res.status === 401 || res.status === 403,
    };
  }

  return { ok: true, data: (parsed ?? {}) as QBCreatedEntity };
}

/** `POST /v3/company/{realmId}/invoice` */
export function createInvoiceInQuickBooks(
  payload: Record<string, unknown>,
): Promise<QBApiResult<QBCreatedEntity>> {
  return qbPost("invoice", payload);
}

/** `POST /v3/company/{realmId}/payment` */
export function createPaymentInQuickBooks(
  payload: Record<string, unknown>,
): Promise<QBApiResult<QBCreatedEntity>> {
  return qbPost("payment", payload);
}

/* ------------------------------------------------------------------ *
 * Test seam
 * ------------------------------------------------------------------ */

/** The two functions that actually reach the network. */
export interface QBTransport {
  createInvoice(payload: Record<string, unknown>): Promise<QBApiResult<QBCreatedEntity>>;
  createPayment(payload: Record<string, unknown>): Promise<QBApiResult<QBCreatedEntity>>;
}

let transportOverride: QBTransport | null = null;

/**
 * Replaces the HTTP transport for the duration of a test.
 *
 * Without this the QuickBooks calls are unreachable in CI — there are no
 * credentials — so the one criterion that actually matters, "a retry creates
 * exactly one QuickBooks record", could not be tested at all. Storage has the
 * same seam (`setStorageOverride`); this brings the two into line.
 *
 * Passing `null` restores the real client.
 */
export function setQuickBooksTransportOverride(override: QBTransport | null): void {
  transportOverride = override;
}

function transport(): QBTransport {
  return (
    transportOverride ?? {
      createInvoice: createInvoiceInQuickBooks,
      createPayment: createPaymentInQuickBooks,
    }
  );
}

/** Exposed for the sync service so a retry goes through the same seam. */
export function quickBooksTransport(): QBTransport {
  return transport();
}

/** True when a test is standing in for QuickBooks. */
export function hasTransportOverride(): boolean {
  return transportOverride !== null;
}

/** Non-secret connection state, for the settings/sync screen. */
export interface QBStatus {
  configured: boolean;
  authorised: boolean;
  realmId: string | null;
  sandbox: boolean;
}

export async function quickBooksStatus(): Promise<QBStatus> {
  const tokens = await loadQBTokens();
  return {
    configured: isQuickBooksConfigured(),
    authorised: tokens !== null,
    realmId: env.QB_REALM_ID ?? null,
    sandbox: env.QB_SANDBOX,
  };
}
