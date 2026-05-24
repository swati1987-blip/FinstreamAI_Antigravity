import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const EXPENSE_CATEGORIES = [
  "Admin Costs",
  "Advertisement",
  "Business Promotion",
  "Courier/Transportation",
  "Fuel",
  "Insurance",
  "Investment",
  "Legal",
  "Marketing expense",
  "Other expenses",
  "Raw material",
  "Rent",
  "Repairs and maintenance",
  "Salary/Wages",
  "Staff Welfare",
  "Taxes",
  "Telecommunication",
  "Travel",
  "Website",
] as const;

export function cleanVendorName(vendor: string | null | undefined): string {
  if (!vendor) return "—";
  let name = vendor.trim();

  // 1. Remove trailing parenthesis containing categories or entities, e.g. "Zomato (Dining)" or "Facebook (Business)"
  name = name.replace(/\s*\([^)]*\)\s*$/, "");

  // 2. Remove trailing hyphens, colons, middots, or slashes followed by category keywords
  name = name.replace(/\s*[-:·•/]\s*(?:Business|Personal|Investments|Business Promotion|Telecommunication|Travel|Staff Welfare|Admin Costs|Raw material|Insurance|Repairs and maintenance|Fuel|Advertisement|Courier\/Transportation|Website|Legal|Marketing expense|Other expenses|KS|TI|CPM|AAS|Swati|Others|None)\b/i, "");

  // 3. Remove trailing category/entity keywords directly at the end of the word
  const categoriesPattern = /\b(?:Business|Personal|Investments|Business Promotion|Telecommunication|Travel|Staff Welfare|Admin Costs|Raw material|Insurance|Repairs and maintenance|Fuel|Advertisement|Courier\/Transportation|Website|Legal|Marketing expense|Other expenses|KS|TI|CPM|AAS|Swati|Others|None)$/i;
  name = name.replace(categoriesPattern, "").trim();

  // Clean up any trailing punctuation
  name = name.replace(/[-:·•/]+$/, "").trim();

  return name || vendor;
}

export function parseExpenseCategoryAndDescription(rawText: string | null | undefined): {
  expenseCategory: string;
  description: string;
} {
  const fallbackCategory = "Other expenses";
  if (!rawText) return { expenseCategory: fallbackCategory, description: "" };

  const text = rawText.trim();

  // Split by common delimiters
  const parts = text.split(/\s*[-·•/]\s*/);
  if (parts.length > 0) {
    const firstPart = parts[0].trim();
    const matched = EXPENSE_CATEGORIES.find(
      (c) => c.toLowerCase() === firstPart.toLowerCase()
    );
    if (matched) {
      const description = parts.slice(1).join(" · ").trim();
      return { expenseCategory: matched, description };
    }
  }

  if (parts.length > 1) {
    const lastPart = parts[parts.length - 1].trim();
    const matched = EXPENSE_CATEGORIES.find(
      (c) => c.toLowerCase() === lastPart.toLowerCase()
    );
    if (matched) {
      const description = parts.slice(0, -1).join(" · ").trim();
      return { expenseCategory: matched, description };
    }
  }

  // Exact match search
  const exactMatch = EXPENSE_CATEGORIES.find(
    (c) => c.toLowerCase() === text.toLowerCase()
  );
  if (exactMatch) {
    return { expenseCategory: exactMatch, description: "" };
  }

  // Check if any part is an exact match for one of our categories
  for (const part of parts) {
    const match = EXPENSE_CATEGORIES.find(
      (c) => c.toLowerCase() === part.trim().toLowerCase()
    );
    if (match) {
      const description = parts
        .filter((p) => p.trim().toLowerCase() !== part.trim().toLowerCase())
        .join(" · ")
        .trim();
      return { expenseCategory: match, description };
    }
  }

  return { expenseCategory: fallbackCategory, description: text };
}

