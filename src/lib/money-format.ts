/**
 * Currency-aware money formatting for the UI.
 *
 * Every amount carries its own currency in the API responses. Formatting it
 * with a hardcoded prefix (previously "AUD") mislabels BDT/USD/etc. amounts.
 * `null` is deliberately rendered as "Unavailable": mixed-currency totals are
 * null rather than a cross-currency sum.
 */

const ISO_CURRENCY = /^[A-Z]{3}$/;

/** Normalise a currency code, defaulting to AUD only when none is supplied. */
export function normalizeCurrency(currency?: string | null): string {
  const code = String(currency ?? "").trim().toUpperCase();
  return ISO_CURRENCY.test(code) ? code : "AUD";
}

export function formatMoney(
  amount: number | null | undefined,
  currency?: string | null,
  locale = "en-AU",
): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "Unavailable";
  const code = normalizeCurrency(currency);
  const value = Number(amount);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Unknown/invalid ISO code for this runtime: keep the code visible rather
    // than silently labelling the amount as another currency.
    return `${code} ${value.toLocaleString(locale)}`;
  }
}
