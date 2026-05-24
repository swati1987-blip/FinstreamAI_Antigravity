import { SUPPORTED_CURRENCIES } from "./expense-shared";

export const CURRENCY_OPTIONS = SUPPORTED_CURRENCIES.map((code) => ({
  code,
  label: code,
}));

export function formatCurrency(amount: number, currency = "INR"): string {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}
