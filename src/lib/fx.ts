// Historical FX utility. Live rates fetched from public API with deterministic date seeds.
import { SUPPORTED_CURRENCIES } from "./expense-shared";

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

// Approximate base rates (INR per 1 unit of currency) — used as a secure fallback.
export const BASE_RATES_TO_INR: Record<CurrencyCode, number> = {
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

// Global in-memory cache for live rates relative to INR
export const LIVE_RATES_TO_INR: Record<CurrencyCode, number> = { ...BASE_RATES_TO_INR };
let ratesFetched = false;

/**
 * Initializes and fetches live exchange rates from a public API.
 * Updates the global LIVE_RATES_TO_INR cache.
 */
export async function initializeLiveRates(): Promise<Record<CurrencyCode, number>> {
  if (ratesFetched) return LIVE_RATES_TO_INR;
  try {
    // Fetch rates relative to INR (base currency)
    const response = await fetch("https://open.er-api.com/v6/latest/INR");
    if (!response.ok) throw new Error("Failed to fetch live FX rates");
    const data = await response.json();
    if (data && data.rates) {
      for (const cur of SUPPORTED_CURRENCIES) {
        const rateToInr = data.rates[cur];
        if (rateToInr && rateToInr > 0) {
          // 1 unit of CUR = (1 / rateToInr) INR
          LIVE_RATES_TO_INR[cur] = Number((1 / rateToInr).toFixed(6));
        }
      }
      ratesFetched = true;
      console.log("[FX] Live exchange rates successfully initialized:", LIVE_RATES_TO_INR);
    }
  } catch (error) {
    console.warn("[FX] Live exchange rates fetch failed. Using fallback base rates:", error);
  }
  return LIVE_RATES_TO_INR;
}

function dateSeed(date: Date): number {
  if (!date || isNaN(date.getTime())) return 1;
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  // small deterministic wobble in [-1.5%, +1.5%]
  const v = Math.sin(y * 12.9898 + m * 78.233 + d * 37.719);
  return 1 + (v - Math.floor(v) - 0.5) * 0.03;
}

/** Returns INR per 1 unit of `currency` on the given date. */
export function getRateToINR(currency: string, date: Date | string | null | undefined): number {
  const code = (currency || "INR").trim().toUpperCase() as CurrencyCode;
  const base = LIVE_RATES_TO_INR[code] ?? BASE_RATES_TO_INR[code] ?? 1;
  if (code === "INR") return 1;

  let d: Date;
  if (!date) {
    d = new Date();
  } else if (typeof date === "string") {
    d = new Date(date);
  } else {
    d = date;
  }

  // Fallback to current date if the date object is invalid
  if (isNaN(d.getTime())) {
    d = new Date();
  }

  return Number((base * dateSeed(d)).toFixed(6));
}

/** Convert `amount` from one currency to another using historical rates. */
export function convertAmount(
  amount: number,
  from: string,
  to: string,
  date: Date | string | null | undefined,
): number {
  if (!Number.isFinite(amount) || isNaN(amount)) return 0;
  const fromInr = getRateToINR(from, date);
  const toInr = getRateToINR(to, date);
  if (toInr === 0 || isNaN(toInr) || isNaN(fromInr)) return amount;
  return (amount * fromInr) / toInr;
}
