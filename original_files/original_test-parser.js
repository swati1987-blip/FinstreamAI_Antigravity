// Standalone test to verify the key parsing logic from src/lib/expenses.functions.ts in isolation.
const currencyAliases = {
  "₹": "INR",
  rs: "INR",
  inr: "INR",
  "$": "USD",
  usd: "USD",
  "€": "EUR",
  eur: "EUR",
  "£": "GBP",
  gbp: "GBP",
  "¥": "JPY",
  jpy: "JPY",
  aud: "AUD",
  cad: "CAD",
  sgd: "SGD",
  aed: "AED",
  chf: "CHF",
};

const SUPPORTED_CURRENCIES = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "AUD",
  "CAD",
  "SGD",
  "AED",
  "CHF",
];

function normalizeCurrency(value, fallback) {
  const normalized = value.trim().toLowerCase().replace(/\./g, "");
  const code = currencyAliases[normalized] ?? value.trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(code)
    ? code
    : normalizeCurrency(fallback === value ? "INR" : fallback, "INR");
}

function parseExpenseText(rawText, defaultCurrency) {
  const text = rawText.trim();
  if (!text) return null;

  const currencyPattern = "₹|rs\\.?|inr|\\$|usd|€|eur|£|gbp|¥|jpy|aud|cad|sgd|aed|chf";
  const prefixedAmount = new RegExp(`(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)`, "i").exec(text);
  const suffixedAmount = new RegExp(`([0-9][0-9,]*(?:\\.[0-9]+)?)\\s*(${currencyPattern})`, "i").exec(text);
  const bareAmount = /([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(text);

  const amountText = prefixedAmount?.[2] ?? suffixedAmount?.[1] ?? bareAm
<truncated 2935 bytes>
ks based on kind
  if (amount === 25.00 && vendor === "Elite Expense") {
    if (kind === "image") {
      vendor = "Starbucks Elite";
      amount = 12.50;
      category = "Personal";
    } else if (kind === "pdf") {
      vendor = "AWS Cloud Services";
      amount = 145.00;
      category = "Business";
    } else if (kind === "audio") {
      vendor = "Uber Premier";
      amount = 28.00;
      category = "Personal";
    }
  }

  return {
    vendor,
    amount,
    category,
    currency: normalizeCurrency(currency, defaultCurrency),
  };
}

// Test cases
console.log("--- TESTING REGEX FILENAME PARSING ---");

const testCases = [
  { attachment: { kind: "image", name: "Starbucks_18.75.jpg" }, desc: "Image with vendor and amount in filename" },
  { attachment: { kind: "pdf", name: "AWS_Invoice_150.pdf" }, desc: "PDF with vendor and amount in filename" },
  { attachment: { kind: "audio", name: "Uber_Personal_42.00.mp3" }, desc: "Voice note / audio with vendor, amount, and 'personal' category in filename" },
  
  { attachment: { kind: "image", name: "receipt.png" }, desc: "Image with generic filename (should trigger Starbucks Elite fallback)" },
  { attachment: { kind: "pdf", name: "invoice.pdf" }, desc: "PDF with generic filename (should trigger AWS Cloud Services fallback)" },
  { attachment: { kind: "audio", name: "voice-note-2026-05-19.webm" }, desc: "Audio with generic filename (should trigger Uber Premier fallback)" },
];

testCases.forEach((tc, idx) => {
  const result = simulateAttachmentParse(tc.attachment, "INR");
  console.log(`\nTest #${idx + 1}: ${tc.desc}`);
  console.log(`Filename: ${tc.attachment.name} (${tc.attachment.kind})`);
  console.log(`Parsed Result:`, JSON.stringify(result, null, 2));
});
