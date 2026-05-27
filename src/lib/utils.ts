import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const EXPENSE_CATEGORIES = [
  // New Direct Categories
  "Raw Material",
  "Labour & Wages",
  "Electricity & Power",
  "Water",
  "Repairs & Maintenance",
  "Goods Carriage & Transport",
  "Factory-Related Expenses",
  
  // New Indirect Categories
  "Travel & Logistics",
  "Salaries & Admin",
  "Marketing & Ads",
  "Software & Tech",
  "General Overhead",
  "Professional & Legal",
  "Rent & Facilities",
  "Taxes & Compliance",
  "Other Indirect",
  
  // Legacy Fallbacks
  "Raw material",
  "Salary/Wages",
  "Fuel",
  "Repairs and maintenance",
  "Courier/Transportation",
  "Travel",
  "Marketing expense",
  "Advertisement",
  "Business Promotion",
  "Website",
  "Admin Costs",
  "Staff Welfare",
  "Telecommunication",
  "Insurance",
  "Legal",
  "Taxes",
  "Rent",
  "Other expenses",
  "Investment"
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

export interface ClassifiedExpense {
  type: "Direct" | "Indirect" | "Personal" | "Unclassified";
  category: string;
  subcategory: string;
}

export function classifyExpense(item: {
  category: string;
  main_category?: string;
  expense_category?: string;
  raw_text?: string | null;
  vendor?: string | null;
}): ClassifiedExpense {
  const isPersonal = 
    item.main_category?.toLowerCase() === "personal" ||
    item.category?.toLowerCase() === "personal" ||
    item.category?.toLowerCase() === "investments";
  
  if (isPersonal) {
    return { type: "Personal", category: "Personal", subcategory: "Personal" };
  }

  const rawCat = (item.expense_category || item.category || "").trim();
  const desc = (item.raw_text || "").toLowerCase();
  const vendor = (item.vendor || "").toLowerCase();

  const hasDesc = (...words: string[]) => words.some(w => desc.includes(w));
  const hasVendor = (...words: string[]) => words.some(w => vendor.includes(w));

  // DIRECT COSTS RE-MAPPING
  
  // 1. Raw material
  if (rawCat.toLowerCase() === "raw material" || rawCat.toLowerCase() === "raw_material") {
    let sub = "Goods";
    if (hasDesc("packaging", "box", "carton", "bag")) {
      sub = "Packaging";
    } else if (hasDesc("consumable", "consumables")) {
      sub = "Consumables";
    }
    return { type: "Direct", category: "Raw Material", subcategory: sub };
  }

  // 2. Electricity / Electricity & Power (Direct only, no subcategory below that)
  if (rawCat.toLowerCase() === "electricity" || rawCat.toLowerCase() === "electricity & power") {
    return { type: "Direct", category: "Electricity & Power", subcategory: "Electricity & Power" };
  }

  // 3. Water (Direct only, no subcategory below that)
  if (rawCat.toLowerCase() === "water") {
    return { type: "Direct", category: "Water", subcategory: "Water" };
  }

  // 4. Labour / Labour & Wages (Direct only, no subcategory below that)
  if (rawCat.toLowerCase() === "labour" || rawCat.toLowerCase() === "labour & wages") {
    return { type: "Direct", category: "Labour & Wages", subcategory: "Labour & Wages" };
  }

  // 5. Repairs and maintenance -> Direct / Repairs & Maintenance
  if (rawCat.toLowerCase() === "repairs and maintenance" || rawCat.toLowerCase() === "repairs & maintenance") {
    let sub = "Equipment Servicing";
    if (hasDesc("machine", "lathe", "furnace", "factory", "boiler")) {
      sub = "Machine Repair";
    } else if (hasDesc("tool", "drill", "cutter", "blade", "replacement")) {
      sub = "Tool Replacement";
    }
    return { type: "Direct", category: "Repairs & Maintenance", subcategory: sub };
  }

  // 6. Courier/Transportation or Goods Carriage
  if (rawCat.toLowerCase() === "courier/transportation" || rawCat.toLowerCase() === "goods carriage & transport") {
    const isSupplier = hasVendor("supplier", "logistics", "cargo", "freight", "transport", "carrier", "raw") || hasDesc("inbound", "raw", "factory", "dispatch", "delivery");
    if (isSupplier) {
      let sub = "Inbound Freight";
      if (hasDesc("courier", "sample")) sub = "Raw Material Courier";
      else if (hasDesc("dispatch", "outbound", "client")) sub = "Factory Dispatch";
      return { type: "Direct", category: "Goods Carriage & Transport", subcategory: sub };
    }
    return { type: "Indirect", category: "Travel & Logistics", subcategory: "Employee Commute" };
  }

  // 7. Factory-Related Expenses
  if (rawCat.toLowerCase() === "factory-related expenses" || rawCat.toLowerCase() === "factory") {
    let sub = "Factory Consumables";
    if (hasDesc("safety", "helmet", "glove", "boot")) sub = "Safety Equipment";
    else if (hasDesc("packaging", "box", "tape")) sub = "Packaging Materials";
    return { type: "Direct", category: "Factory-Related Expenses", subcategory: sub };
  }

  // Legacy mappings for Salary/Wages -> Direct / Labour & Wages if factory mentioned
  if (rawCat.toLowerCase() === "salary/wages" && hasDesc("factory", "production", "floor", "worker", "contract", "daily", "machinery", "operator")) {
    return { type: "Direct", category: "Labour & Wages", subcategory: "Labour & Wages" };
  }


  // INDIRECT COSTS RE-MAPPING
  
  // 1. Travel & Logistics
  if (rawCat.toLowerCase() === "travel" || rawCat.toLowerCase() === "travel & logistics") {
    let sub = "Business Travel";
    if (hasDesc("commute", "cab", "auto", "metro")) sub = "Employee Commute";
    else if (hasDesc("fuel", "petrol", "diesel", "car")) sub = "Car Fuel";
    return { type: "Indirect", category: "Travel & Logistics", subcategory: sub };
  }

  // 2. Fuel -> Indirect / Travel & Logistics / Car Fuel (unless matched as generator/machinery Electricity)
  if (rawCat.toLowerCase() === "fuel") {
    if (hasDesc("generator", "machinery", "machine", "factory", "plant", "power")) {
      return { type: "Direct", category: "Electricity & Power", subcategory: "Electricity & Power" };
    }
    return { type: "Indirect", category: "Travel & Logistics", subcategory: "Car Fuel" };
  }

  // 3. Salaries & Admin
  if (rawCat.toLowerCase() === "salary/wages" || rawCat.toLowerCase() === "salaries & admin") {
    let sub = "Head Office Staff";
    if (hasDesc("management", "manager", "ceo", "director")) sub = "Management Salary";
    else if (hasDesc("admin", "payroll", "hr", "finance")) sub = "Admin Payroll";
    return { type: "Indirect", category: "Salaries & Admin", subcategory: sub };
  }

  // 4. Marketing & Ads
  if (["marketing expense", "advertisement", "business promotion", "marketing & ads"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Business Promotion";
    if (hasDesc("digital", "google", "fb", "ad", "meta", "online")) sub = "Digital Ads";
    else if (hasDesc("event", "exhibition", "fair", "expo")) sub = "Events";
    return { type: "Indirect", category: "Marketing & Ads", subcategory: sub };
  }

  // 5. Software & Tech
  if (["website", "admin costs", "software & tech"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Admin Software";
    if (hasDesc("website", "domain", "host", "server")) sub = "Website";
    else if (hasDesc("saas", "saas subscription", "software", "aws", "adobe", "figma")) sub = "SaaS Subscriptions";
    return { type: "Indirect", category: "Software & Tech", subcategory: sub };
  }

  // 6. General Overhead
  if (["staff welfare", "telecommunication", "telecom", "general overhead"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Office Expenses";
    if (hasDesc("welfare", "staff", "tea", "snack", "dining", "lunch")) sub = "Staff Welfare";
    else if (hasDesc("telecom", "phone", "internet", "mobile", "wifi")) sub = "Telecommunication";
    else if (hasDesc("dining", "food", "restaurant")) sub = "Dining";
    return { type: "Indirect", category: "General Overhead", subcategory: sub };
  }

  // 7. Professional & Legal
  if (["insurance", "legal", "professional & legal"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Legal Fees";
    if (hasDesc("insurance")) sub = "Insurance";
    else if (hasDesc("compliance", "audit", "tax")) sub = "Compliance";
    else if (hasDesc("professional", "consultant")) sub = "Professional Services";
    return { type: "Indirect", category: "Professional & Legal", subcategory: sub };
  }

  // 8. Rent & Facilities
  if (rawCat.toLowerCase() === "rent" || rawCat.toLowerCase() === "rent & facilities") {
    let sub = "Office Rent";
    if (hasDesc("cowork", "co-working", "wework", "shared")) sub = "Co-working Space";
    return { type: "Indirect", category: "Rent & Facilities", subcategory: sub };
  }

  // 9. Taxes & Compliance
  if (rawCat.toLowerCase() === "taxes" || rawCat.toLowerCase() === "taxes & compliance") {
    let sub = "GST Payments";
    if (hasDesc("tds", "withholding")) sub = "TDS";
    else if (hasDesc("fee", "govt", "government", "registration")) sub = "Government Fees";
    return { type: "Indirect", category: "Taxes & Compliance", subcategory: sub };
  }

  // 10. Other Indirect
  if (["other expenses", "investment", "other indirect"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Miscellaneous";
    if (hasDesc("investment", "shares", "mutual", "fd")) sub = "Investment";
    else if (hasDesc("unclassified", "unknown")) sub = "Unclassified";
    return { type: "Indirect", category: "Other Indirect", subcategory: sub };
  }

  // Default fallback
  return { type: "Indirect", category: "Other Indirect", subcategory: "Miscellaneous" };
}

export interface ParsedDescription {
  materialType: string;
  rateStr: string;
  rateNum: number | null;
  qtyStr: string;
  qtyNum: number | null;
  gstStr: string;
  gstNum: number | null;
}

export function parseDescriptionDetails(description: string | null | undefined, amount: number): ParsedDescription {
  if (!description) {
    return {
      materialType: "",
      rateStr: "—",
      rateNum: null,
      qtyStr: "—",
      qtyNum: null,
      gstStr: "—",
      gstNum: null,
    };
  }

  // 1. Split category prefix like "Raw material · Precipitated Calcium Carbonate" -> "Precipitated Calcium Carbonate"
  const parts = description.split(/\s*[-·•/]\s*/);
  let detailText = description;
  if (parts.length > 1 && /raw material|repairs|labour|electricity|water|fuel/i.test(parts[0])) {
    detailText = parts.slice(1).join(" · ").trim();
  }

  // 2. Parse Rate
  // Look for "@ ₹12/kg" or similar
  let rateStr = "—";
  let rateNum: number | null = null;
  let unit = "";
  
  const rateMatch = /@\s*[₹$€£]?\s*([\d,]+(?:\.\d+)?)\s*\/?\s*(\w+)?/i.exec(description);
  if (rateMatch) {
    const rawNum = rateMatch[1].replace(/,/g, "");
    rateNum = parseFloat(rawNum);
    unit = rateMatch[2] || "unit";
    rateStr = `₹${rateNum.toLocaleString("en-IN")}/${unit}`;
  }

  // 3. Parse Qty
  // Look for "Qty: 100 kg" or "Qty: 100" or similar
  let qtyStr = "—";
  let qtyNum: number | null = null;
  
  const qtyExplicitMatch = /Qty:\s*([\d,]+(?:\.\d+)?)\s*(\w+)?/i.exec(description);
  if (qtyExplicitMatch) {
    const rawQtyNum = qtyExplicitMatch[1].replace(/,/g, "");
    qtyNum = parseFloat(rawQtyNum);
    const qtyUnit = qtyExplicitMatch[2] || unit || "";
    qtyStr = `${qtyNum.toLocaleString("en-IN")} ${qtyUnit}`.trim();
  } else {
    // Look for numbers before units like "20550 kg" or "100 bags" as fallback
    const qtyUnitMatch = /\b([\d,]+(?:\.\d+)?)\s*(kg|bags|bag|units|pcs|ton|tons|ltr|ltrs|liters|litres|boxes|box|drums|drum)\b/i.exec(description);
    if (qtyUnitMatch) {
      const rawQtyNum = qtyUnitMatch[1].replace(/,/g, "");
      qtyNum = parseFloat(rawQtyNum);
      const qtyUnit = qtyUnitMatch[2];
      qtyStr = `${qtyNum.toLocaleString("en-IN")} ${qtyUnit}`;
    } else if (rateNum && rateNum > 0) {
      // Calculate quantity: amount / rate
      qtyNum = Math.round(amount / rateNum);
      qtyStr = `${qtyNum.toLocaleString("en-IN")} ${unit}`.trim();
    }
  }

  // 4. Parse GST
  // Look for "GST: ₹12,300" or "GST: 18%" or similar
  let gstStr = "—";
  let gstNum: number | null = null;
  const gstMatch = /GST:\s*[₹$€£]?\s*([\d,]+(?:\.\d+)?)/i.exec(description);
  if (gstMatch) {
    const rawGstNum = gstMatch[1].replace(/,/g, "");
    gstNum = parseFloat(rawGstNum);
    gstStr = `₹${gstNum.toLocaleString("en-IN")}`;
  }

  // 5. Extract Material/Service name (portion before @ or Qty or GST)
  let materialType = detailText.split("@")[0].split(/Qty:/i)[0].split(/GST:/i)[0].trim();
  // Clean up any trailing dots, dashes, or separators
  materialType = materialType.replace(/[-·•/,\s]+$/, "").trim();

  return {
    materialType,
    rateStr,
    rateNum,
    qtyStr,
    qtyNum,
    gstStr,
    gstNum,
  };
}

export function resolveEntityFromVendor(vendor: string | null | undefined, rawText?: string | null): string {
  const textToCheck = `${vendor || ""} ${rawText || ""}`.toUpperCase();
  
  // AAS - All About Sports (Bhandari, Kumaram) has highest priority if it explicitly appears as buyer/billed to
  if (/\bAAS\b|BHANDARI|KUMARAM/i.test(textToCheck)) {
    return "AAS";
  }
  // TI - Tech Industries (Valor, Mech)
  if (/\bTI\b|VALOR|MECH/i.test(textToCheck)) {
    return "TI";
  }
  // CPM
  if (/\bCPM\b/i.test(textToCheck)) {
    return "CPM";
  }
  // KS - Kismat Sales (Sutri, Anjali, Saurashtra, Sunshine, A B Brother, Dattani etc)
  if (/\bKS\b|SUTRI|ANJALI|SAURASHTRA|SUNSHINE|SUN\s+SHINE|A\s*B\s*BROTHER|DATTANI/i.test(textToCheck)) {
    return "KS";
  }
  return "None";
}


