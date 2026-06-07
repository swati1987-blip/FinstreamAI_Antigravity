import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const EXPENSE_CATEGORIES = [
  "Admin Costs",
  "Advertising & Marketing",
  "Auditors Remuneration",
  "Business Promotion",
  "Carriage outwards",
  "Electricity & Power",
  "Electricity Charges - office",
  "Factory-Related Expenses",
  "Goods Carriage & Transport",
  "Insurance",
  "Investment & Other Assets",
  "Labour & Wages",
  "Legal and Professional Expenses",
  "Motor Car expenses",
  "Other expenses",
  "Other repairs",
  "Printing and Stationery",
  "Raw Material",
  "Rent",
  "Repairs & Maintenance",
  "Royalty",
  "Salary",
  "Staff Welfare",
  "Taxes",
  "Telecommunication",
  "Travel",
  "Water",
  "Website"
] as const;

export function cleanVendorName(vendor: string | null | undefined): string {
  if (!vendor) return "—";
  let name = vendor.trim();

  // 1. Remove trailing parenthesis containing categories or entities, e.g. "Zomato (Dining)" or "Facebook (Business)"
  name = name.replace(/\s*\([^)]*\)\s*$/, "");

  // 2. Remove trailing hyphens, colons, middots, or slashes followed by category keywords
  name = name.replace(/\s*[-:·•/]\s*(?:Business|Personal|Investments|Business Promotion|Telecommunication|Travel|Staff Welfare|Admin Costs|Raw material|Insurance|Repairs and maintenance|Fuel|Advertisement|Advertising & Marketing|Courier\/Transportation|Website|Legal|Legal and Professional Expenses|Marketing expense|Auditors Remuneration|Carriage outwards|Royalty|Motor Car expenses|Electricity Charges - office|Printing and Stationery|Other repairs|Other expenses|KS|TI|CPM|AAS|Swati|Others|None)\b/i, "");

  // 3. Remove trailing category/entity keywords directly at the end of the word
  const categoriesPattern = /\b(?:Business|Personal|Investments|Business Promotion|Telecommunication|Travel|Staff Welfare|Admin Costs|Raw material|Insurance|Repairs and maintenance|Fuel|Advertisement|Advertising & Marketing|Courier\/Transportation|Website|Legal|Legal and Professional Expenses|Marketing expense|Auditors Remuneration|Carriage outwards|Royalty|Motor Car expenses|Electricity Charges - office|Printing and Stationery|Other repairs|Other expenses|KS|TI|CPM|AAS|Swati|Others|None)$/i;
  name = name.replace(categoriesPattern, "").trim();

  // 4. Strip common vendor suffixes (e.g. pay, utilities, retail, limited, ltd, pvt, solutions, industries, corp) at the end of the vendor name
  const suffixesPattern = /\b(?:pay|utilities|retail|limited|ltd|pvt|solutions|industries|corp|llp|co|company|enterprises|enterprise|associates|traders|trading|services|group|chemical|chemicals|chemicles|chem|agency|agencies|subsidiary|subsidiaries|corporation|packers|packaging|textile|textiles|private|govt|government)\b\.?/gi;
  name = name.replace(suffixesPattern, "").trim();

  // Clean up any trailing punctuation or stray conjunctions at the end
  name = name.replace(/[-:·•/&\s]+$/, "").trim();
  name = name.replace(/\b(?:and|&)\b$/i, "").trim();

  const finalName = name || vendor;
  if (!finalName) return "—";
  return finalName.charAt(0).toUpperCase() + finalName.slice(1).toLowerCase();
}

export function isFuzzyVendorMatch(vendor1: string | null | undefined, vendor2: string | null | undefined): boolean {
  if (!vendor1 || !vendor2) return false;
  const v1 = cleanVendorName(vendor1).toLowerCase().trim();
  const v2 = cleanVendorName(vendor2).toLowerCase().trim();
  if (v1 === v2) return true;
  if (v1.includes(v2) || v2.includes(v1)) return true;

  // Split into words and filter out short words
  const words1 = v1.split(/\s+/).filter((w) => w.length >= 4);
  const words2 = v2.split(/\s+/).filter((w) => w.length >= 4);

  if (words1.length > 0 && words2.length > 0) {
    return words1.some((w) => words2.includes(w));
  }
  return false;
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

  // Keyword-based matching for common terms in free-form notes
  const lowerText = text.toLowerCase();
  if (lowerText.includes("salary") || lowerText.includes("wages") || lowerText.includes("payroll")) {
    if (lowerText.includes("factory") || lowerText.includes("labour") || lowerText.includes("daily") || lowerText.includes("operator")) {
      return { expenseCategory: "Labour & Wages", description: text };
    }
    return { expenseCategory: "Salaries & Admin", description: text };
  }
  if (lowerText.includes("electricity") || lowerText.includes("power") || lowerText.includes("msedcl")) {
    return { expenseCategory: "Electricity & Power", description: text };
  }
  if (lowerText.includes("water") && !lowerText.includes("bottle") && !lowerText.includes("tea")) {
    return { expenseCategory: "Water", description: text };
  }
  if (lowerText.includes("repairs") || lowerText.includes("maintenance") || lowerText.includes("servicing") || lowerText.includes("spares")) {
    return { expenseCategory: "Repairs & Maintenance", description: text };
  }
  if (lowerText.includes("carriage") || lowerText.includes("transport") || lowerText.includes("freight") || lowerText.includes("cargo")) {
    return { expenseCategory: "Goods Carriage & Transport", description: text };
  }
  if (lowerText.includes("raw material") || lowerText.includes("chemical") || lowerText.includes("chemicle") || lowerText.includes("chem") || lowerText.includes("felt") || lowerText.includes("fabric") || lowerText.includes("box") || lowerText.includes("carton")) {
    return { expenseCategory: "Raw Material", description: text };
  }
  if (lowerText.includes("travel") || lowerText.includes("cab") || lowerText.includes("auto") || lowerText.includes("metro") || lowerText.includes("commute")) {
    return { expenseCategory: "Travel & Logistics", description: text };
  }
  if (lowerText.includes("marketing") || lowerText.includes("advertisement") || lowerText.includes("ads") || lowerText.includes("google ads") || lowerText.includes("meta ads")) {
    return { expenseCategory: "Marketing & Ads", description: text };
  }
  if (lowerText.includes("software") || lowerText.includes("saas") || lowerText.includes("subscription") || lowerText.includes("website") || lowerText.includes("domain") || lowerText.includes("hosting")) {
    return { expenseCategory: "Software & Tech", description: text };
  }
  if (lowerText.includes("rent") || lowerText.includes("facilities") || lowerText.includes("coworking")) {
    return { expenseCategory: "Rent & Facilities", description: text };
  }
  if (lowerText.includes("legal") || lowerText.includes("professional") || lowerText.includes("insurance") || lowerText.includes("consultant") || lowerText.includes("audit") || lowerText.includes("compliance")) {
    return { expenseCategory: "Professional & Legal", description: text };
  }
  if (lowerText.includes("tax") || lowerText.includes("taxes") || lowerText.includes("gst") || lowerText.includes("tds")) {
    return { expenseCategory: "Taxes & Compliance", description: text };
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

  // 5. Repairs and maintenance -> Direct / Repairs & Maintenance (unless office/facility related or vehicle/manually forced related)
  if (rawCat.toLowerCase() === "repairs and maintenance" || rawCat.toLowerCase() === "repairs & maintenance") {
    let sub = "Equipment Servicing";
    if (hasDesc("office", "admin", "hq", "head office", "building", "furniture", "ac", "air conditioner", "plumbing", "computer", "laptop", "printer")) {
      return { type: "Indirect", category: "Rent & Facilities", subcategory: "Office Maintenance" };
    }
    if (hasDesc("car", "vehicle", "auto", "creta", "motor", "bike", "scooter", "tyre", "wheel", "oil", "service", "northview", "indirect")) {
      return { type: "Indirect", category: "Repairs & Maintenance", subcategory: "Vehicle Maintenance" };
    }
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
  if (rawCat.toLowerCase() === "travel" || rawCat.toLowerCase() === "travel & logistics" || rawCat.toLowerCase() === "motor car expenses" || rawCat.toLowerCase() === "carriage outwards") {
    let sub = "Business Travel";
    if (rawCat.toLowerCase() === "motor car expenses") sub = "Motor Car Expenses";
    else if (rawCat.toLowerCase() === "carriage outwards") sub = "Carriage Outwards";
    else if (hasDesc("commute", "cab", "auto", "metro")) sub = "Employee Commute";
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
  if (rawCat.toLowerCase() === "salary/wages" || rawCat.toLowerCase() === "salaries & admin" || rawCat.toLowerCase() === "salary" || rawCat.toLowerCase() === "salaries") {
    let sub = "Head Office Staff";
    if (hasDesc("management", "manager", "ceo", "director")) sub = "Management Salary";
    else if (hasDesc("admin", "payroll", "hr", "finance")) sub = "Admin Payroll";
    return { type: "Indirect", category: "Salaries & Admin", subcategory: sub };
  }

  // 4. Marketing & Ads
  if (["marketing expense", "advertisement", "business promotion", "marketing & ads", "advertising & marketing"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Business Promotion";
    if (hasDesc("digital", "google", "fb", "ad", "meta", "online")) sub = "Digital Ads";
    else if (hasDesc("event", "exhibition", "fair", "expo")) sub = "Events";
    return { type: "Indirect", category: "Marketing & Ads", subcategory: sub };
  }

  // 5. Software & Tech / Website
  if (["software & tech", "website", "software"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Admin Software";
    if (hasDesc("website", "domain", "host", "server")) sub = "Website";
    else if (hasDesc("saas", "saas subscription", "software", "aws", "adobe", "figma")) sub = "SaaS Subscriptions";
    return { type: "Indirect", category: "Software & Tech", subcategory: sub };
  }

  // 6. General Overhead / Telecommunication
  if (["staff welfare", "telecommunication", "telecom", "general overhead", "admin costs", "other expenses", "royalty", "printing and stationery"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Office Expenses";
    if (rawCat.toLowerCase() === "royalty") sub = "Royalty";
    else if (rawCat.toLowerCase() === "printing and stationery") sub = "Printing & Stationery";
    else if (hasDesc("welfare", "staff", "tea", "snack", "dining", "lunch")) sub = "Staff Welfare";
    else if (hasDesc("telecom", "phone", "internet", "mobile", "wifi")) sub = "Telecommunication";
    else if (hasDesc("dining", "food", "restaurant")) sub = "Dining";
    return { type: "Indirect", category: "General Overhead", subcategory: sub };
  }

  // 7. Professional & Legal
  if (["insurance", "legal", "professional & legal", "legal and professional expenses", "auditors remuneration"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Legal Fees";
    if (rawCat.toLowerCase() === "auditors remuneration") sub = "Auditors Remuneration";
    else if (hasDesc("insurance")) sub = "Insurance";
    else if (hasDesc("compliance", "audit", "tax")) sub = "Compliance";
    else if (hasDesc("professional", "consultant")) sub = "Professional Services";
    return { type: "Indirect", category: "Professional & Legal", subcategory: sub };
  }

  // 8. Rent & Facilities
  if (rawCat.toLowerCase() === "rent" || rawCat.toLowerCase() === "rent & facilities" || rawCat.toLowerCase() === "electricity charges - office" || rawCat.toLowerCase() === "other repairs") {
    let sub = "Office Rent";
    if (rawCat.toLowerCase() === "electricity charges - office") sub = "Office Electricity";
    else if (rawCat.toLowerCase() === "other repairs") sub = "Office Repairs";
    else if (hasDesc("cowork", "co-working", "wework", "shared")) sub = "Co-working Space";
    return { type: "Indirect", category: "Rent & Facilities", subcategory: sub };
  }

  // 9. Taxes & Compliance
  if (rawCat.toLowerCase() === "taxes" || rawCat.toLowerCase() === "taxes & compliance") {
    let sub = "GST Payments";
    if (hasDesc("tds", "withholding")) sub = "TDS";
    else if (hasDesc("fee", "govt", "government", "registration")) sub = "Government Fees";
    return { type: "Indirect", category: "Taxes & Compliance", subcategory: sub };
  }

  // 10. Investment & Other Assets
  if (["investment", "other assets", "investment & other assets", "investment and other assets"].some(c => c === rawCat.toLowerCase()) || hasDesc("investment", "shares", "mutual", "fd", "asset", "machinery", "computer", "laptop")) {
    let sub = "Investment";
    if (hasDesc("shares", "stock", "equity")) sub = "Equity Investments";
    else if (hasDesc("fd", "fixed deposit", "bond")) sub = "Fixed Deposits";
    else if (hasDesc("mutual", "fund", "sip")) sub = "Mutual Funds";
    else if (hasDesc("asset", "machinery", "computer", "laptop", "equipment", "furniture")) sub = "Capital Assets";
    return { type: "Indirect", category: "Investment & Other Assets", subcategory: sub };
  }

  // 11. Other Indirect
  if (["other expenses", "other indirect"].some(c => c === rawCat.toLowerCase())) {
    let sub = "Miscellaneous";
    if (hasDesc("unclassified", "unknown")) sub = "Unclassified";
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

export function cleanDescription(rawText: string | null | undefined, amountText?: string): string {
  if (!rawText) return "";
  let desc = rawText.trim();
  
  // 1. Remove amount if specified
  if (amountText) {
    const cleanAmt = amountText.replace(/,/g, "");
    desc = desc.replace(new RegExp(cleanAmt, 'g'), "");
    // Also try removing with comma formatting
    const formatted = parseFloat(cleanAmt);
    if (!isNaN(formatted)) {
      desc = desc.replace(new RegExp(formatted.toLocaleString("en-IN"), 'g'), "");
      desc = desc.replace(new RegExp(formatted.toLocaleString("en-US"), 'g'), "");
    }
  }
  
  // 2. Remove standard transaction verbs, currencies, and prefixes/suffixes
  desc = desc
    .replace(/\b(add|spent|paid|pay|bought|purchase|purchased|expense|cost|log|record|for|at|to|from|on|of|with|using|via)\b/gi, " ")
    .replace(/\b(rs\.?|inr|usd|eur|gbp|jpy|aud|cad|sgd|aed|chf)\b|[₹$€£¥]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 3. Remove business entity indicator phrases at the end, e.g. "and business as KS", "selected business as KS", etc.
  desc = desc
    .replace(/\b(and\s+)?(selected\s+)?business\s+(as|is|for)\s+[A-Z]{2,3}\b/gi, "")
    .replace(/\b(in|for|division|entity)\s+[A-Z]{2,3}\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // 4. Remove leading/trailing punctuation and space
  desc = desc.replace(/^[.,;:!\s\-·•/]+|[.,;:!\s\-·•/]+$/g, "").trim();

  if (!desc) return "";
  return desc.charAt(0).toUpperCase() + desc.slice(1);
}

export function resolveEntityFromVendor(vendor: string | null | undefined, rawText?: string | null): string {
  const textToCheck = `${vendor || ""} ${rawText || ""}`.toUpperCase();
  
  // AAS - All About Sports (Bhandari) has highest priority if it explicitly appears as buyer/billed to
  if (/\bAAS\b|BHANDARI/i.test(textToCheck)) {
    return "AAS";
  }
  // TI - Tech Industries / Tennex Impex (Valor, Mech, Tennex)
  if (/\bTI\b|VALOR|MECH|TENNEX/i.test(textToCheck)) {
    return "TI";
  }
  // CPM
  if (/\bCPM\b/i.test(textToCheck)) {
    return "CPM";
  }
  // KS - Kumaram Sports / Kismat Sales (Sutri, Anjali, Saurashtra, Sunshine, A B Brother, Dattani etc)
  if (/\bKS\b|KUMARAM|SUTRI|ANJALI|SAURASHTRA|SUNSHINE|SUN\s+SHINE|A\s*B\s*BROTHER|DATTANI/i.test(textToCheck)) {
    return "KS";
  }
  // Default fallback if not recognizable
  return "KS";
}

export function normalizeCategory(cat: string | null | undefined): string {
  if (!cat) return "Other expenses";
  const trimmed = cat.trim().toLowerCase();

  // Graceful mappings for common variations to the exact raw categories
  if (trimmed === "raw material" || trimmed === "raw_material") return "Raw Material";
  if (trimmed === "labour & wages" || trimmed === "labour and wages" || trimmed === "labour") return "Labour & Wages";
  if (trimmed === "electricity & power" || trimmed === "electricity" || trimmed === "power" || trimmed === "fuel") return "Electricity & Power";
  if (trimmed === "water") return "Water";
  if (trimmed === "repairs and maintenance" || trimmed === "repairs & maintenance") return "Repairs & Maintenance";
  if (trimmed === "courier/transportation" || trimmed === "goods carriage & transport" || trimmed === "transportation" || trimmed === "courier") return "Goods Carriage & Transport";
  if (trimmed === "factory-related expenses") return "Factory-Related Expenses";
  
  if (trimmed === "travel" || trimmed === "travel & logistics") return "Travel";
  if (trimmed === "admin costs") return "Admin Costs";
  if (trimmed === "salary" || trimmed === "salaries" || trimmed === "salary admin" || trimmed === "salaries & admin" || trimmed === "payroll" || trimmed === "salary/wages") return "Salary";
  if (trimmed === "marketing expense" || trimmed === "marketing & ads" || trimmed === "marketing" || trimmed === "advertisement" || trimmed === "advertising" || trimmed === "advertising & marketing") return "Advertising & Marketing";
  if (trimmed === "business promotion") return "Business Promotion";
  if (trimmed === "website") return "Website";
  if (trimmed === "telecommunication" || trimmed === "telecom") return "Telecommunication";
  if (trimmed === "insurance") return "Insurance";
  if (trimmed === "legal" || trimmed === "legal and professional expenses" || trimmed === "professional & legal" || trimmed === "legal & professional") return "Legal and Professional Expenses";
  if (trimmed === "taxes" || trimmed === "taxes & compliance") return "Taxes";
  if (trimmed === "rent" || trimmed === "rent & facilities") return "Rent";
  if (trimmed === "investment" || trimmed === "investment & other assets" || trimmed === "investment and other assets" || trimmed === "other assets" || trimmed === "assets") return "Investment & Other Assets";
  if (trimmed === "staff welfare") return "Staff Welfare";
  
  if (trimmed === "auditors remuneration" || trimmed === "auditor remuneration" || trimmed === "audits" || trimmed === "audit") return "Auditors Remuneration";
  if (trimmed === "carriage outwards" || trimmed === "carriage outward") return "Carriage outwards";
  if (trimmed === "royalty" || trimmed === "royalties") return "Royalty";
  if (trimmed === "motor car expenses" || trimmed === "motor car expense" || trimmed === "car expense" || trimmed === "car expenses") return "Motor Car expenses";
  if (trimmed === "electricity charges - office" || trimmed === "office electricity" || trimmed === "electricity - office") return "Electricity Charges - office";
  if (trimmed === "printing and stationery" || trimmed === "printing & stationery" || trimmed === "stationery" || trimmed === "printing") return "Printing and Stationery";
  if (trimmed === "other repairs" || trimmed === "office repairs" || trimmed === "office repair" || trimmed === "other repair") return "Other repairs";

  if (trimmed === "other expenses" || trimmed === "other indirect" || trimmed === "general overhead" || trimmed === "other") return "Other expenses";

  const match = EXPENSE_CATEGORIES.find(c => c.toLowerCase() === trimmed);
  if (match) return match;

  // Fallback: title case
  return cat.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

export function matchBuyerToEntity(buyerName: string | null | undefined, businesses: any[]): string {
  if (!buyerName) return "None";
  const name = buyerName.trim().toUpperCase();
  
  // Explicit matches for known corporate entities
  if (name.includes("KUMARAM SPORTS") || name.includes("KUMARAM RUBBER") || name.includes("KISMAT SALES") || name === "KS") {
    const found = businesses.find(b => b.name.toUpperCase() === "KS");
    if (found) return found.name;
  }
  if (name.includes("TECH INDUSTRIES") || name.includes("TENNEX") || name.includes("VALOR") || name === "TI") {
    const found = businesses.find(b => b.name.toUpperCase() === "TI");
    if (found) return found.name;
  }
  if (name.includes("ALL ABOUT SPORTS") || name.includes("BHANDARI") || name === "AAS") {
    const found = businesses.find(b => b.name.toUpperCase() === "AAS");
    if (found) return found.name;
  }
  if (name.includes("CPM")) {
    const found = businesses.find(b => b.name.toUpperCase() === "CPM");
    if (found) return found.name;
  }
  if (name.includes("SWATI")) {
    const found = businesses.find(b => b.name.toUpperCase() === "SWATI");
    if (found) return found.name;
  }

  // Exact match
  const exactMatch = businesses.find(b => b.name.toUpperCase() === name);
  if (exactMatch) return exactMatch.name;

  // Substring match: business name inside buyerName, or buyerName inside business name
  const substringMatch = businesses.find(b => {
    const bUpper = b.name.toUpperCase();
    return bUpper.length >= 2 && (name.includes(bUpper) || bUpper.includes(name));
  });
  if (substringMatch) return substringMatch.name;

  return "None";
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

export function resizeImageIfNeeded(file: File): Promise<File> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !file.type.startsWith("image/")) {
      resolve(file);
      return;
    }
    const img = new Image();
    img.src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const longEdge = Math.max(img.width, img.height);
      if (longEdge <= 1500) {
        resolve(file);
        return;
      }
      
      let width = img.width;
      let height = img.height;
      if (width > height) {
        height = Math.round((height * 1500) / width);
        width = 1500;
      } else {
        width = Math.round((width * 1500) / height);
        height = 1500;
      }
      
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(file);
          return;
        }
        const resizedFile = new File([blob], file.name, {
          type: file.type,
          lastModified: Date.now(),
        });
        resolve(resizedFile);
      }, file.type);
    };
    img.onerror = () => {
      resolve(file);
    };
  });
}




