/**
 * Environment-only configuration for the external invoice integration.
 *
 * Nothing is enabled or assumed by default. The layer stays disabled until a
 * real provider name is configured and a provider factory is registered. No
 * provider URL, credential or behaviour is hardcoded.
 *
 * Supported variables:
 *   INVOICE_INTEGRATION_ENABLED   "true" | "1" | "yes" | "on" (default off)
 *   INVOICE_INTEGRATION_PROVIDER  registered provider name
 *   INVOICE_INTEGRATION_BASE_URL  provider base URL (optional)
 *   INVOICE_INTEGRATION_API_KEY   provider credential (optional, never logged)
 *   INVOICE_INTEGRATION_TIMEOUT_MS  request timeout (default 15000)
 */

export interface InvoiceIntegrationConfig {
  enabled: boolean;
  provider: string | null;
  /** True only when the feature is enabled and a provider name is configured. */
  configured: boolean;
  timeoutMs: number;
}

/** Provider-facing environment passed to a registered factory. */
export interface InvoiceProviderEnv {
  baseUrl: string | null;
  apiKey: string | null;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 120_000;

function truthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function nonEmpty(value: string | undefined): string | null {
  const v = String(value ?? "").trim();
  return v || null;
}

function parseTimeout(value: string | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(n)));
}

export function readInvoiceIntegrationConfig(
  env: NodeJS.ProcessEnv = process.env,
): InvoiceIntegrationConfig {
  const enabled = truthy(env.INVOICE_INTEGRATION_ENABLED);
  const provider = nonEmpty(env.INVOICE_INTEGRATION_PROVIDER);
  return {
    enabled,
    provider,
    configured: enabled && provider !== null,
    timeoutMs: parseTimeout(env.INVOICE_INTEGRATION_TIMEOUT_MS),
  };
}

export function readInvoiceProviderEnv(
  config: InvoiceIntegrationConfig,
  env: NodeJS.ProcessEnv = process.env,
): InvoiceProviderEnv {
  return {
    baseUrl: nonEmpty(env.INVOICE_INTEGRATION_BASE_URL),
    apiKey: nonEmpty(env.INVOICE_INTEGRATION_API_KEY),
    timeoutMs: config.timeoutMs,
  };
}
