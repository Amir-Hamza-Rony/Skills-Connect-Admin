/**
 * Provider registry.
 *
 * The application ships with NO registered provider. A real integration is
 * added later, after the provider contract and credentials are supplied, by
 * calling `registerInvoiceProvider`. Until then the sync endpoint fails
 * closed with a clear configuration error and the internal invoice system is
 * unaffected.
 */

import { InvoiceIntegrationError } from "./types";
import type { ExternalInvoiceProvider } from "./types";
import { readInvoiceProviderEnv } from "./config";
import type { InvoiceIntegrationConfig, InvoiceProviderEnv } from "./config";

export type InvoiceProviderFactory = (
  env: InvoiceProviderEnv,
) => ExternalInvoiceProvider;

const factories = new Map<string, InvoiceProviderFactory>();

export function registerInvoiceProvider(
  name: string,
  factory: InvoiceProviderFactory,
): void {
  const key = name.trim();
  if (!key) throw new Error("Invoice provider name must not be empty.");
  factories.set(key, factory);
}

export function hasInvoiceProvider(name: string): boolean {
  return factories.has(name);
}

/**
 * Resolve the configured provider. Fails closed (never falls back to a guessed
 * or hardcoded provider) when the feature is disabled, unnamed, or the name is
 * not registered.
 */
export function resolveInvoiceProvider(
  config: InvoiceIntegrationConfig,
  env: NodeJS.ProcessEnv = process.env,
): ExternalInvoiceProvider {
  if (!config.enabled) {
    throw new InvoiceIntegrationError(
      "INTEGRATION_DISABLED",
      "External invoice integration is disabled.",
      503,
    );
  }
  if (!config.provider) {
    throw new InvoiceIntegrationError(
      "PROVIDER_NOT_CONFIGURED",
      "No external invoice provider is configured.",
      503,
    );
  }
  const factory = factories.get(config.provider);
  if (!factory) {
    throw new InvoiceIntegrationError(
      "PROVIDER_NOT_REGISTERED",
      "The configured external invoice provider is not registered.",
      503,
    );
  }
  return factory(readInvoiceProviderEnv(config, env));
}

/** Test-only helper; production code must not rely on clearing the registry. */
export function resetInvoiceProvidersForTests(): void {
  factories.clear();
}
