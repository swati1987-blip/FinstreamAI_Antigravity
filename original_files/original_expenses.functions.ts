import { createServerFn } from "@tanstack/react-start";
import { generateText, type ModelMessage } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway";
import { SUPPORTED_CURRENCIES } from "./expense-shared";

const inputSchema = z
  .object({
    rawText: z.string().max(5000).optional().default(""),
    defaultCurrency: z.string().min(3).max(3).default("INR"),
    attachment: z
      .object({
        // data URL like "data:image/png;base64,...."
        dataUrl: z.string().startsWith("data:"),
        mimeType: z.string(),
        kind: z.enum(["image", "pdf", "audio"]),
      })
      .optional(),
  })
  .refine((d) => (d.rawText && d.rawText.trim().length > 0) || !!d.attachment, {
    message: "Provide text or an attachment",
  });

type ParsedExpense = {
  vendor: string;
  amount: number;
  category: "Business" | "Personal";
  currency: (typeof SUPPORTED_CURRENCIES)[number];
};

const currencyAliases: Record<string, (typeof SUPPORTED_CURRENCIES)[number]> = {
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

const expenseSchema = z.object({
  vendor: z.coerce.string().trim().min(1),
  amount: z.coerce
<truncated 4955 bytes>
additional context.

Respond with ONLY a single JSON object on one line, no markdown, no code fences, no commentary. Shape:
{"vendor": string, "amount": number, "category": "Business" | "Personal", "currency": "INR" | "USD" | "EUR" | "GBP" | "JPY" | "AUD" | "CAD" | "SGD" | "AED" | "CHF"}`;

    const userParts: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: URL }
      | { type: "file"; data: URL; mediaType: string }
    > = [];

    const text = data.rawText?.trim() ?? "";
    if (text) userParts.push({ type: "text", text: `Note from user: ${text}` });

    if (data.attachment) {
      const url = new URL(data.attachment.dataUrl);
      if (data.attachment.kind === "image") {
        userParts.push({ type: "image", image: url });
      } else {
        userParts.push({ type: "file", data: url, mediaType: data.attachment.mimeType });
      }
    }

    if (userParts.length === 0) {
      userParts.push({ type: "text", text: "(no input)" });
    }

    const messages: ModelMessage[] = [
      { role: "system", content: instructions },
      { role: "user", content: userParts as never },
    ];

    try {
      const { text: raw } = await generateText({ model, messages, maxOutputTokens: 500 });
      const parsed = extractJsonObject(raw);
      const object = expenseSchema.parse(parsed);

      return {
        ...object,
        currency: normalizeCurrency(object.currency, data.defaultCurrency),
      };
    } catch (error) {
      console.error("Expense AI parse failed", error);
      if (textFallback) return textFallback;
      throw new Error("Could not extract an expense from that attachment. Add a short note with the amount and vendor, then try again.");
    }
  });
