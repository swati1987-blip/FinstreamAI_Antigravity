// Historical FX utility. Mock rates relative to INR (1 unit of CUR = X INR).
// Replace with a live API later if needed.
import { SUPPORTED_CURRENCIES } from "./expense-shared";

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

// Approximate base rates (INR per 1 unit of currency) — used when a date-specific
// rate isn't available. Deterministic small variation by date keeps audit stable.
const BASE_RATES_TO_INR: Record<CurrencyCode, number> = {
  INR: 1,
  USD: 83.2,
  EUR: 90.1,
  GBP: 105.4,
  JPY: 0.55,
  AUD: 54.6,
  CAD: 61.2,
  SGD: 62.0,
  AED: 22.65,
  CHF: 94.7,
};

function dateSeed(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  // small deterministic wobble in [-1.5%, +1.5%]
  const v = Math.sin(y * 12.9898 + m * 78.233 + d * 37.719);
  return 1 + (v - Math.floor(v) - 0.5) * 0.03;
}

/** Returns INR per 1 unit of `currency` on the given date. */
export function getRateToINR(currency: string, date: Date | string): number {
  const code = (currency || "INR").toUpperCase() as CurrencyCode;
  const base = BASE_RATES_TO_INR[code] ?? 1;
  const d = typeof date === "string" ? new Date(date) : date;
  if (code === "INR") return 1;
  return Number((base * dateSeed(d)).toFixed(6));
}

/** Convert `amount` from one currency to another using historical rates. */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  date: Date | string,
): number {
  if (!Number.isFinite(amount)) return 0;
  const fromInr = getRateToINR(from, date);
  const toInr = getRateToINR(to, date);
  if (toInr === 0) return amount;
  return (amount * fromInr) / toInr;
}
