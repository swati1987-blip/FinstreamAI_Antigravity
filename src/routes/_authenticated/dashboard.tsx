import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Sparkles,
  TrendingUp,
  Briefcase,
  User,
  AlertCircle,
  Inbox,
  Image as ImageIcon,
  FileText,
  Mic,
  Square,
  X,
  Paperclip,
  Plus,
  Building2,
  CalendarIcon,
  Zap,
  Droplet,
  Users,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { MasterUpload } from "@/components/master-upload";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { parseExpenseWithAI, getCaptureWebhookUrl, sendImageToN8n } from "@/lib/expenses.functions";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { useBusinesses } from "@/hooks/use-businesses";
import { CURRENCY_OPTIONS, formatCurrency } from "@/lib/currency";
import { convertAmount, getRateToINR } from "@/lib/fx";
import { cn, cleanVendorName, parseExpenseCategoryAndDescription, resolveEntityFromVendor, cleanDescription, normalizeCategory, matchBuyerToEntity, fileToBase64, resizeImageIfNeeded } from "@/lib/utils";

async function mergeDebitOrCreditNote(
  supabaseClient: any,
  parsed: {
    vendor: string;
    amount: number;
    description?: string;
    debit_note_target?: string;
    id?: string;
    date?: string;
  },
  noteDate: Date
): Promise<boolean> {
  const targetRef = parsed.debit_note_target || "";
  const desc = parsed.description || "";
  // Check if this is a Credit Note or a Debit Note
  const isCredit = /credit/i.test(desc) || /credit/i.test(targetRef);
  const noteType = isCredit ? "Credit Note" : "Debit Note";

  console.log(`[Note Linker] Processing ${noteType} for vendor "${parsed.vendor}". Target ref: "${targetRef}"`);

  // 1. Fetch all candidate expenses
  const { data: allExpenses, error } = await supabaseClient
    .from("expenses")
    .select("*");

  if (error || !allExpenses || allExpenses.length === 0) {
    console.error("[Note Linker] Error fetching expenses or database is empty:", error);
    return false;
  }

  // Vendor comparison helper: clean names, remove punctuation, check exact or substring
  const isVendorMatch = (v1: string | null | undefined, v2: string | null | undefined): boolean => {
    if (!v1 || !v2) return false;
    const c1 = cleanVendorName(v1).toLowerCase().replace(/[^a-z0-9]/g, "");
    const c2 = cleanVendorName(v2).toLowerCase().replace(/[^a-z0-9]/g, "");
    return c1 === c2 || c1.includes(c2) || c2.includes(c1);
  };

  // Reference comparison helper: does candidate contain targetRef?
  const isReferenceMatch = (candidateText: string, ref: string): boolean => {
    if (!ref) return false;
    const cleanText = candidateText.toLowerCase();
    const cleanRef = ref.toLowerCase();
    if (cleanText.includes(cleanRef)) return true;
    
    // Check if target reference has a number and candidate matches that number with invoice clues
    const numMatch = cleanRef.match(/\d+/);
    if (numMatch) {
      const numStr = numMatch[0];
      if ((cleanText.includes("inv") || cleanText.includes("invoice") || cleanText.includes("no")) && cleanText.includes(numStr)) {
        return true;
      }
    }
    return false;
  };

  let bestCandidate: any = null;
  let bestScore = -1000;
  const noteDescLower = desc.toLowerCase();

  for (const exp of allExpenses) {
    // Don't link against the note itself if it has already been saved
    if (parsed.id && exp.id === parsed.id) continue;

    // Don't match if it's already a debit/credit note applied
    if (exp.raw_text && (exp.raw_text.includes("[Debit Note") || exp.raw_text.includes("[Credit Note"))) {
      continue;
    }

    // 1. Vendor Match is mandatory
    if (!isVendorMatch(exp.vendor, parsed.vendor)) continue;

    let score = 0;

    // 2. Reference Match (high weight)
    if (targetRef) {
      if (isReferenceMatch(exp.raw_text || "", targetRef) || isReferenceMatch(exp.vendor || "", targetRef)) {
        score += 200;
      }
    }

    // 3. Product/Keyword Match (medium weight)
    const expDescLower = (exp.raw_text || "").toLowerCase();
    const ignoreWords = ["debit", "credit", "note", "rate", "difference", "against", "invoice", "qty", "gst", "applied", "raw", "material", "materials", "total", "amount", "price"];
    const noteWords = noteDescLower.split(/[^a-zA-Z0-9]/).filter(w => w.length >= 3 && !ignoreWords.includes(w));
    let overlapCount = 0;
    for (const word of noteWords) {
      if (expDescLower.includes(word)) {
        overlapCount++;
      }
    }
    score += overlapCount * 30;

    // 4. Date Proximity Match
    const expDate = exp.date ? new Date(exp.date) : new Date(exp.created_at);
    const diffTime = noteDate.getTime() - expDate.getTime();
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    if (diffDays >= 0) {
      // Prioritize bills in the past relative to the note
      score += 50;
      if (diffDays <= 30) {
        score += (30 - diffDays) * 2; // Closer is better
      } else {
        score += Math.max(0, 10 - (diffDays - 30) / 10);
      }
    } else {
      // Future bills are penalized but still possible matches in case of delay
      score -= Math.abs(diffDays) * 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = exp;
    }
  }

  // Minimum score threshold of 30 ensures we have a vendor match plus either a date match or keyword match
  if (!bestCandidate || bestScore < 30) {
    console.log(`[Note Linker] No confident candidate invoice found for vendor "${parsed.vendor}". Best score: ${bestScore}`);
    return false;
  }

  console.log(`[Note Linker] Selected original invoice (ID: ${bestCandidate.id}) with score: ${bestScore}`);

  const origAmt = Number(bestCandidate.amount) || 0;
  const origDesc = bestCandidate.raw_text || "";

  // Check if already applied
  const appliedMarker = `[${noteType}`;
  if (origDesc.includes(appliedMarker)) {
    console.log(`[Note Linker] ${noteType} already applied to invoice ${bestCandidate.id}`);
    return true; 
  }

  let updatedDesc = origDesc;

  // Rate Adjustment logic
  const rateMatch = origDesc.match(/@\s*₹([\d,.]+)/);
  if (rateMatch) {
    const oldRate = parseFloat(rateMatch[1].replace(/,/g, ""));
    let rateChange = 0;

    // A. Check for explicit rate in note description (e.g. "@ ₹0.20" or "@ ₹0.20/box")
    const rateDiffMatch = desc.match(/@\s*₹([\d,.]+)/);
    if (rateDiffMatch) {
      rateChange = parseFloat(rateDiffMatch[1].replace(/,/g, ""));
      console.log(`[Note Linker] Extracted explicit rate change: ₹${rateChange}`);
    } else {
      // B. Compute rate difference from note amount, quantity, and GST
      const qtyMatch = desc.match(/Qty:\s*([\d,]+)/i);
      const qty = qtyMatch ? parseInt(qtyMatch[1].replace(/,/g, ""), 10) : 1;

      const gstMatch = desc.match(/GST:\s*₹([\d,]+)/i);
      const gstAmt = gstMatch ? parseFloat(gstMatch[1].replace(/,/g, "")) : 0;
      const baseNoteAmt = parsed.amount - gstAmt;
      rateChange = baseNoteAmt / qty;
      console.log(`[Note Linker] Calculated rate change: (Amount: ${parsed.amount} - GST: ${gstAmt}) / Qty: ${qty} = ₹${rateChange.toFixed(4)}`);
    }

    if (rateChange > 0) {
      const newRate = isCredit
        ? Math.max(0, oldRate - rateChange).toFixed(2)
        : (oldRate + rateChange).toFixed(2);

      updatedDesc = updatedDesc.replace(
        `@ ₹${rateMatch[1]}`,
        `@ ₹${newRate}`
      );
      console.log(`[Note Linker] Updated rate description: @ ₹${rateMatch[1]} -> @ ₹${newRate}`);
    }
  }

  // Adjust original invoice total amount: add for debit note, subtract for credit note
  const newAmt = isCredit
    ? Math.max(0, origAmt - parsed.amount)
    : origAmt + parsed.amount;

  const displayAmt = parsed.amount.toLocaleString("en-IN");
  updatedDesc += ` · [${noteType} ${isCredit ? "-" : "+"}₹${displayAmt} rate difference applied]`;

  console.log(`[Note Linker] Updating invoice: Amt: ${origAmt} -> ${newAmt}, Desc: "${updatedDesc}"`);

  const { error: updateError } = await supabaseClient
    .from("expenses")
    .update({ amount: newAmt, raw_text: updatedDesc })
    .eq("id", bestCandidate.id);

  if (updateError) {
    console.error(`[Note Linker] Error updating invoice record in DB:`, updateError);
    return false;
  }

  return true;
}

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "FinStream AI — Intelligent Financial Ledger" },
      {
        name: "description",
        content:
          "Capture bills, SMS, and notes. FinStream AI parses them into a clean financial ledger.",
      },
    ],
  }),
});

type Expense = {
  id: string;
  created_at: string;
  amount: number;
  vendor: string;
  category: string;
  currency: string;
  raw_text: string | null;
  business_id: string | null;
  date?: string;
  main_category?: string;
  company_entity?: string;
  expense_category?: string;
};

const ADD_NEW_VALUE = "__add_new__";

type Attachment = {
  dataUrl: string;
  mimeType: string;
  kind: "image" | "pdf" | "audio";
  name: string;
  sizeKb: number;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024; // 8 MB

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Read failed"));
    reader.readAsDataURL(file);
  });
}

interface MemoryRule {
  vendor_pattern: string;
  main_category: string;
  company_entity: string;
  expense_category: string;
  description?: string | null;
  amount?: number | null;
  description_order?: number | null;
}

async function fetchRulesAndHistory(userId: string) {
  let rulesData: MemoryRule[] = [];
  try {
    const { data: allRules, error: selectAllErr } = await (supabase as any)
      .from("transaction_rules_memory")
      .select("*");

    if (selectAllErr) {
      console.error("[Dashboard] Error fetching transaction rules memory:", selectAllErr);
    } else if (allRules) {
      rulesData = allRules
        .filter((r: any) => {
          if ("user_id" in r && r.user_id) {
            return r.user_id === userId;
          }
          return true;
        })
        .map((r: any) => ({
          vendor_pattern: r.vendor_pattern || "",
          main_category: r.main_category || "Personal",
          company_entity: r.company_entity || "None",
          expense_category: r.expense_category || "Other expenses",
          description: r.description || null,
          amount: r.amount != null ? Number(r.amount) : null,
          description_order: r.description_order != null ? Number(r.description_order) : null,
        }));
      
      if (allRules.length > 0 && "description_order" in allRules[0]) {
        rulesData.sort((a, b) => {
          const orderA = a.description_order ?? 99999;
          const orderB = b.description_order ?? 99999;
          return orderA - orderB;
        });
      }
    }
  } catch (e) {
    console.error("[Dashboard] Exception loading memory rules:", e);
  }

  try {
    const { data: pastExpenses } = await supabase
      .from("expenses")
      .select("vendor, category, expense_category, company_entity, amount")
      .eq("user_id", userId);

    if (pastExpenses) {
      pastExpenses.forEach((exp) => {
        if (exp.vendor && exp.expense_category) {
          rulesData.push({
            vendor_pattern: exp.vendor,
            main_category: exp.category || "Personal",
            company_entity: exp.company_entity || "None",
            expense_category: exp.expense_category,
            amount: exp.amount ? Number(exp.amount) : null,
          });
        }
      });
    }
  } catch (e) {
    console.error("[Dashboard] Error loading historical expenses for rules engine:", e);
  }

  const groupRulesMap = new Map<string, MemoryRule[]>();
  const vendorAmountRules = new Map<string, MemoryRule[]>();
  const vendorRulesMap = new Map<string, MemoryRule>();

  rulesData.forEach((rule: MemoryRule) => {
    const cleanedRuleVendor = cleanVendorName(rule.vendor_pattern);
    const vendorKey = cleanedRuleVendor.toLowerCase().trim();
    if (rule.amount != null) {
      const preciseKey = `${vendorKey}|${rule.amount}`;
      if (!groupRulesMap.has(preciseKey)) groupRulesMap.set(preciseKey, []);
      groupRulesMap.get(preciseKey)!.push(rule);
      if (!vendorAmountRules.has(vendorKey)) vendorAmountRules.set(vendorKey, []);
      vendorAmountRules.get(vendorKey)!.push(rule);
      
      // Also add to vendorRulesMap as fallback if there is no explicit amount-less rule
      const existing = vendorRulesMap.get(vendorKey);
      if (!existing || existing.amount != null) {
        vendorRulesMap.set(vendorKey, rule);
      }
    } else {
      // Vendor-only rule — always set and overwrite
      vendorRulesMap.set(vendorKey, rule);
    }
  });

  return {
    groupRulesMap,
    vendorAmountRules,
    vendorRulesMap,
    groupAssignmentCounters: new Map<string, number>()
  };
}

function matchTransactionRules(
  vendor: string,
  amount: number,
  description: string,
  defaultCategory: "Business" | "Personal",
  defaultEntity: string,
  defaultExpenseCategory: string,
  rulesMaps: {
    groupRulesMap: Map<string, MemoryRule[]>;
    vendorAmountRules: Map<string, MemoryRule[]>;
    vendorRulesMap: Map<string, MemoryRule>;
    groupAssignmentCounters: Map<string, number>;
  }
) {
  const cleanedVendorStr = cleanVendorName(vendor);
  const vendorKey = cleanedVendorStr.toLowerCase().trim();
  const incomingAmt = Number.isFinite(amount) ? amount : 0;
  const preciseKey = `${vendorKey}|${incomingAmt}`;

  const { groupRulesMap, vendorAmountRules, vendorRulesMap, groupAssignmentCounters } = rulesMaps;

  // ── TIER 1: Exact vendor+amount ──
  let groupRules = groupRulesMap.get(preciseKey);
  if (!groupRules || groupRules.length === 0) {
    const matchedPreciseKey = Array.from(groupRulesMap.keys()).find((k) => {
      const [vKey, amtVal] = k.split("|");
      return Math.abs(Number(amtVal) - incomingAmt) < 0.01 && (vendorKey.includes(vKey) || vKey.includes(vendorKey));
    });
    if (matchedPreciseKey) {
      groupRules = groupRulesMap.get(matchedPreciseKey);
    }
  }

  if (groupRules && groupRules.length > 0) {
    const counter = groupAssignmentCounters.get(preciseKey) ?? 0;
    const assignedRule = groupRules[counter % groupRules.length];
    groupAssignmentCounters.set(preciseKey, counter + 1);

    const ruleCat = assignedRule.main_category === "Business" ? "Business" : "Personal";
    return {
      category: ruleCat as "Business" | "Personal",
      company_entity: assignedRule.company_entity ?? defaultEntity,
      expense_category: assignedRule.expense_category ?? defaultExpenseCategory,
      description: assignedRule.description || description,
    };
  }

  // ── TIER 2: Fuzzy vendor+amount match (±₹500 tolerance) ──
  let allVendorRules = vendorAmountRules.get(vendorKey) ?? [];
  if (allVendorRules.length === 0) {
    const matchedVendorKey = Array.from(vendorAmountRules.keys()).find(
      (key) => vendorKey.includes(key) || key.includes(vendorKey)
    );
    if (matchedVendorKey) {
      allVendorRules = vendorAmountRules.get(matchedVendorKey) ?? [];
    }
  }
  const fuzzyMatch = allVendorRules.find(
    (rule) => rule.amount != null && Math.abs(rule.amount - incomingAmt) <= 500
  );
  if (fuzzyMatch) {
    const ruleCat = fuzzyMatch.main_category === "Business" ? "Business" : "Personal";
    return {
      category: ruleCat as "Business" | "Personal",
      company_entity: fuzzyMatch.company_entity ?? defaultEntity,
      expense_category: fuzzyMatch.expense_category ?? defaultExpenseCategory,
      description: fuzzyMatch.description || description,
    };
  }

  // ── TIER 3: Vendor-only fallback ──
  let vendorRule = vendorRulesMap.get(vendorKey);
  if (!vendorRule) {
    const matchedVendorKey = Array.from(vendorRulesMap.keys()).find(
      (key) => vendorKey.includes(key) || key.includes(vendorKey)
    );
    if (matchedVendorKey) {
      vendorRule = vendorRulesMap.get(matchedVendorKey);
    }
  }
  if (vendorRule) {
    const ruleCat = vendorRule.main_category === "Business" ? "Business" : "Personal";
    return {
      category: ruleCat as "Business" | "Personal",
      company_entity: vendorRule.company_entity ?? defaultEntity,
      expense_category: vendorRule.expense_category ?? defaultExpenseCategory,
      description: description || "",
    };
  }

  return {
    category: defaultCategory,
    company_entity: defaultEntity,
    expense_category: defaultExpenseCategory,
    description,
  };
}

function findDuplicateInHistory(
  vendor: string,
  amount: number,
  dateStr: string,
  existingExpenses: any[]
) {
  const cleanNewVendor = cleanVendorName(vendor).toLowerCase().trim();
  const newAmt = Number(amount);

  const isWithinOneDay = (d1: string, d2: string): boolean => {
    if (!d1 || !d2) return false;
    try {
      const parseDateParts = (str: string) => {
        const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          return {
            year: parseInt(match[1]),
            month: parseInt(match[2]) - 1,
            day: parseInt(match[3])
          };
        }
        const d = new Date(str);
        return {
          year: d.getFullYear(),
          month: d.getMonth(),
          day: d.getDate()
        };
      };

      const p1 = parseDateParts(d1);
      const p2 = parseDateParts(d2);

      const utc1 = Date.UTC(p1.year, p1.month, p1.day);
      const utc2 = Date.UTC(p2.year, p2.month, p2.day);

      const diffDays = Math.abs(utc1 - utc2) / (24 * 60 * 60 * 1000);
      return diffDays <= 1;
    } catch {
      return false;
    }
  };

  // 1. Try exact match (same vendor, same amount, same date)
  let matched = existingExpenses.find((e) => {
    const eVendor = cleanVendorName(e.vendor).toLowerCase().trim();
    const eDate = e.date || (e.created_at ? e.created_at.split('T')[0] : '');
    return eVendor === cleanNewVendor && Math.abs(Number(e.amount) - newAmt) < 0.01 && eDate === dateStr;
  });

  // 2. Try ±1 day fuzzy date fallback
  if (!matched) {
    matched = existingExpenses.find((e) => {
      const eVendor = cleanVendorName(e.vendor).toLowerCase().trim();
      const eDate = e.date || (e.created_at ? e.created_at.split('T')[0] : '');
      return eVendor === cleanNewVendor && Math.abs(Number(e.amount) - newAmt) < 0.01 && isWithinOneDay(eDate, dateStr);
    });
  }

  // 3. Try ±1 day fuzzy date + vendor substring match fallback
  if (!matched) {
    matched = existingExpenses.find((e) => {
      const eVendor = cleanVendorName(e.vendor).toLowerCase().trim();
      const eDate = e.date || (e.created_at ? e.created_at.split('T')[0] : '');
      return (cleanNewVendor.includes(eVendor) || eVendor.includes(cleanNewVendor)) && 
             Math.abs(Number(e.amount) - newAmt) < 0.01 && 
             isWithinOneDay(eDate, dateStr);
    });
  }

  return matched || null;
}

function Dashboard() {
  const { user } = useAuth();
  const parseFn = useServerFn(parseExpenseWithAI);
  const getWebhookUrlFn = useServerFn(getCaptureWebhookUrl);
  const sendImageToN8nFn = useServerFn(sendImageToN8n);
  const { currency: displayCurrency, ratesVersion } = useCurrency();
  const { businesses, addBusiness } = useBusinesses();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const [rawText, setRawText] = useState("");
  const [captureCurrency, setCaptureCurrency] = useState<string>("INR");
  const [billDate, setBillDate] = useState<Date>(new Date());
  const [businessId, setBusinessId] = useState<string>("none");
  const [newBusinessName, setNewBusinessName] = useState("");
  const [showNewBusiness, setShowNewBusiness] = useState(false);

  const [processing, setProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [recording, setRecording] = useState(false);
  
  const [searchTerm, setSearchTerm] = useState("");
  const [activeEntityFilter, setActiveEntityFilter] = useState<string>("All");
  const [selectedPeriod, setSelectedPeriod] = useState<string>("CY 2026");
  const [resolvingDuplicate, setResolvingDuplicate] = useState<Expense | null>(null);

  const initialExpenseIdsRef = useRef<Set<string> | null>(null);

  const filteredLedgerExpenses = useMemo(() => {
    const filtered = expenses.filter((e) => {
      if (activeEntityFilter !== "All") {
        const entity = e.company_entity || "None";
        if (entity.toLowerCase() !== activeEntityFilter.toLowerCase()) {
          return false;
        }
      }
      if (searchTerm.trim() !== "") {
        const term = searchTerm.toLowerCase();
        const vendor = cleanVendorName(e.vendor).toLowerCase();
        const category = (e.expense_category || "").toLowerCase();
        const mainCat = (e.main_category || e.category || "").toLowerCase();
        const amountStr = String(e.amount);
        return (
          vendor.includes(term) ||
          category.includes(term) ||
          mainCat.includes(term) ||
          amountStr.includes(term)
        );
      }
      return true;
    });

    // Separate newly added session entries from historic ones
    const newlyAdded = filtered.filter(
      (e) => initialExpenseIdsRef.current && !initialExpenseIdsRef.current.has(e.id)
    );
    const historic = filtered.filter(
      (e) => !initialExpenseIdsRef.current || initialExpenseIdsRef.current.has(e.id)
    );

    // Sort newlyAdded by created_at desc so they appear on top in the exact order logged
    newlyAdded.sort((a, b) => {
      const timeA = new Date(a.created_at).getTime();
      const timeB = new Date(b.created_at).getTime();
      return timeB - timeA;
    });

    // Sort historic entries by standard transaction date descending
    historic.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : new Date(a.created_at).getTime();
      const dateB = b.date ? new Date(b.date).getTime() : new Date(b.created_at).getTime();
      return dateB - dateA;
    });

    // Combine them with new session entries strictly pinned on top, limited to the latest 50 entries
    return [...newlyAdded, ...historic].slice(0, 50);
  }, [expenses, activeEntityFilter, searchTerm]);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<any>(null);

  const loadExpenses = async () => {
    setLoadError(null);
    const { data, error } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
      return;
    }
    const loadedData = data ?? [];
    setExpenses(loadedData as Expense[]);
    
    // Store the initial dataset IDs upon first load
    if (initialExpenseIdsRef.current === null) {
      initialExpenseIdsRef.current = new Set(loadedData.map(e => e.id));
    }
  };

  useEffect(() => {
    loadExpenses().finally(() => setLoading(false));

    const channel = supabase
      .channel('dashboard_expenses_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          loadExpenses();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Convert each expense into displayCurrency using historical FX on its date.
  const totals = useMemo(() => {
    let total = 0,
      business = 0,
      personal = 0;
    let totalCount = 0,
      businessCount = 0,
      personalCount = 0;
    for (const e of expenses) {
      // Filter by selected period
      const expDate = e.date ? new Date(e.date) : new Date(e.created_at);
      let inPeriod = true;
      if (selectedPeriod === "FY 2026-27") {
        // Apr 1, 2026 to Mar 31, 2027
        const start = new Date("2026-04-01T00:00:00");
        const end = new Date("2027-03-31T23:59:59");
        inPeriod = expDate >= start && expDate <= end;
      } else if (selectedPeriod === "FY 2025-26") {
        // Apr 1, 2025 to Mar 31, 2026
        const start = new Date("2025-04-01T00:00:00");
        const end = new Date("2026-03-31T23:59:59");
        inPeriod = expDate >= start && expDate <= end;
      } else if (selectedPeriod === "CY 2026") {
        // Jan 1, 2026 to Dec 31, 2026
        const start = new Date("2026-01-01T00:00:00");
        const end = new Date("2026-12-31T23:59:59");
        inPeriod = expDate >= start && expDate <= end;
      } else if (selectedPeriod === "CY 2025") {
        // Jan 1, 2025 to Dec 31, 2025
        const start = new Date("2025-01-01T00:00:00");
        const end = new Date("2025-12-31T23:59:59");
        inPeriod = expDate >= start && expDate <= end;
      } else if (selectedPeriod === "All") {
        inPeriod = true;
      }
      
      if (!inPeriod) continue;

      const amt = convertAmount(
        Number(e.amount) || 0,
        e.currency || "INR",
        displayCurrency,
        e.date || e.created_at,
      );
      total += amt;
      totalCount++;
      if (e.category === "Business") {
        business += amt;
        businessCount++;
      } else {
        personal += amt;
        personalCount++;
      }
    }
    return { total, business, personal, totalCount, businessCount, personalCount };
  }, [expenses, displayCurrency, selectedPeriod, ratesVersion]);

  const potentialDuplicates = useMemo(() => {
    const duplicates = new Set<string>();
    const groups = new Map<string, typeof expenses>();
    expenses.forEach((e) => {
      const vendorName = cleanVendorName(e.vendor || "").toLowerCase().trim();
      const amountVal = Number(e.amount).toFixed(2);
      const dateStr = e.date || e.created_at.slice(0, 10);
      const key = `${vendorName}-${amountVal}-${dateStr}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(e);
    });
    groups.forEach((group) => {
      if (group.length <= 1) return;
      for (let i = 0; i < group.length; i++) {
        const e1 = group[i];
        const time1 = new Date(e1.created_at).getTime();
        let hasDistantlyCreatedPair = false;
        for (let j = 0; j < group.length; j++) {
          if (i === j) continue;
          const e2 = group[j];
          const time2 = new Date(e2.created_at).getTime();
          if (Math.abs(time1 - time2) >= 20000) {
            hasDistantlyCreatedPair = true;
            break;
          }
        }
        if (hasDistantlyCreatedPair) {
          duplicates.add(e1.id);
        }
      }
    });
    return duplicates;
  }, [expenses]);

  const handleResolveDuplicate = async (exp: Expense) => {
    if (!exp) return;
    try {
      const vendorName = cleanVendorName(exp.vendor || "").toLowerCase().trim();
      const amountVal = Number(exp.amount).toFixed(2);
      const dateStr = exp.date || exp.created_at.slice(0, 10);
      
      const matches = expenses.filter((e) => {
        const vName = cleanVendorName(e.vendor || "").toLowerCase().trim();
        const aVal = Number(e.amount).toFixed(2);
        const dStr = e.date || e.created_at.slice(0, 10);
        return vName === vendorName && aVal === amountVal && dStr === dateStr;
      });

      if (matches.length > 1) {
        const duplicateToDelete = matches[1];
        const { error } = await supabase
          .from("expenses")
          .delete()
          .eq("id", duplicateToDelete.id);
          
        if (error) throw error;
        
        toast.success(`Resolved double-billing for ${exp.vendor || "Expense"}! Merged entries successfully ✓`);
        setResolvingDuplicate(null);
        loadExpenses();
      } else {
        toast.error("Duplicate transaction no longer found.");
        setResolvingDuplicate(null);
      }
    } catch (err: any) {
      toast.error("Failed to merge duplicate entries: " + (err.message || ""));
    }
  };

  const handleFilePick = async (
    file: File | undefined | null,
    kind: "image" | "pdf",
  ) => {
    if (!file) return;
    if (kind === "image") {
      const isJpegOrPng = file.type === "image/jpeg" || file.type === "image/png" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg") || file.name.toLowerCase().endsWith(".png");
      if (!isJpegOrPng) {
        toast.error("Only JPEG/PNG images are supported");
        return;
      }
      if (file.size > 4 * 1024 * 1024) {
        toast.error("Image size must be less than 4MB");
        return;
      }
    } else {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error("File too large (max 8 MB)");
        return;
      }
    }
    try {
      setSelectedFile(file);
      const dataUrl = await fileToDataUrl(file);
      setAttachment({
        dataUrl,
        mimeType: file.type || (kind === "pdf" ? "application/pdf" : "image/*"),
        kind,
        name: file.name,
        sizeKb: Math.round(file.size / 1024),
      });
    } catch {
      toast.error("Could not read file");
    }
  };

  const handleMultipleFiles = async (
    filesList: FileList | null,
    kind: "image" | "pdf",
  ) => {
    if (!filesList || filesList.length === 0) return;
    if (!user) {
      toast.error("You must be signed in");
      return;
    }

    // If only one file is selected, use the standard preview-and-edit flow!
    if (filesList.length === 1) {
      void handleFilePick(filesList[0], kind);
      return;
    }

    // Process multiple files in a batch!
    const files = Array.from(filesList);
    setProcessing(true);
    setBatchProgress({ current: 0, total: files.length });

    let successCount = 0;
    let failCount = 0;

    try {
      const rulesMaps = await fetchRulesAndHistory(user.id);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setBatchProgress({ current: i + 1, total: files.length });

        if (kind === "image") {
          const isJpegOrPng = file.type === "image/jpeg" || file.type === "image/png" || file.name.toLowerCase().endsWith(".jpg") || file.name.toLowerCase().endsWith(".jpeg") || file.name.toLowerCase().endsWith(".png");
          if (!isJpegOrPng) {
            toast.error(`"${file.name}" is not a JPEG/PNG image and was skipped`);
            failCount++;
            continue;
          }
          if (file.size > 4 * 1024 * 1024) {
            toast.error(`"${file.name}" is larger than 4MB and was skipped`);
            failCount++;
            continue;
          }
        } else {
          if (file.size > MAX_ATTACHMENT_BYTES) {
            toast.error(`"${file.name}" is too large (max 8 MB)`);
            failCount++;
            continue;
          }
        }

        try {
          const dataUrl = await fileToDataUrl(file);
          const mimeType = file.type || (kind === "pdf" ? "application/pdf" : "image/*");

          // Parse with Gemini
          const parsed = await parseFn({
            data: {
              rawText: `batch_index: ${i}`,
              defaultCurrency: captureCurrency,
              attachment: {
                dataUrl,
                mimeType,
                kind,
                name: file.name,
                sizeKb: Math.round(file.size / 1024),
              },
            },
          }) as { vendor: string; amount: number; category: string; currency: string; description?: string; date?: string; company_entity?: "KS" | "TI" | "CPM" | "AAS" | "None"; line_items?: { vendor: string; amount: number; description?: string }[]; debit_note_target?: string; invoice_number?: string };

          const detectedCurrency = (parsed.currency || captureCurrency).toUpperCase();
          const linkedBusiness = businessId !== "none" && businessId !== ADD_NEW_VALUE ? businessId : null;

          let entityName: "KS" | "TI" | "CPM" | "AAS" | "None" = "None";
          let finalRawText = "";
          let expenseCategory = "Other expenses";

          const hasGstItems = (parsed as any).items && (parsed as any).items.length > 0;

          if (hasGstItems) {
            const items = (parsed as any).items as any[];
            const materialDetails = items.map((it: any) => it.description).filter(Boolean).join(", ");
            
            // Auto-classify cost category based on items description
            const classified = parseExpenseCategoryAndDescription(materialDetails);
            expenseCategory = classified.expenseCategory;
            
            const firstItem = items[0];
            const rateVal = firstItem?.rate ?? 0;
            const unitVal = firstItem?.unit || 'unit';
            const qtyVal = firstItem?.quantity ?? 0;
            const gstVal = (parsed as any).total_gst_amount ?? 0;
            
            const rateText = rateVal % 1 === 0 ? rateVal.toString() : rateVal.toFixed(2);
            const qtyText = qtyVal % 1 === 0 ? qtyVal.toString() : qtyVal.toFixed(3);
            const gstText = gstVal.toLocaleString('en-IN');
            
            finalRawText = `${expenseCategory} · ${materialDetails} @ ₹${rateText}/${unitVal} · Qty: ${qtyText} ${unitVal} · GST: ₹${gstText}`;
            if (parsed.invoice_number) {
              finalRawText += ` · Inv: ${parsed.invoice_number}`;
            }
            
            entityName = matchBuyerToEntity((parsed as any).buyer_name, businesses) as any;
          } else {
            if (parsed.company_entity && parsed.company_entity !== "None") {
              entityName = parsed.company_entity;
            } else if (parsed.category === "Business" && linkedBusiness) {
              const biz = businesses.find((b) => b.id === linkedBusiness);
              if (biz) {
                const bname = biz.name.toUpperCase();
                if (["KS", "TI", "CPM", "AAS"].includes(bname)) {
                  entityName = bname as any;
                }
              }
            }
            const classified = parseExpenseCategoryAndDescription(parsed.description);
            expenseCategory = classified.expenseCategory;
            finalRawText = parsed.description || (parsed.vendor ? `${expenseCategory} · ${parsed.vendor}` : expenseCategory);
          }

          let mainCategoryVal = hasGstItems ? "Business" : (parsed.category === "Business" ? "Business" : "Personal");
          const effectiveDateStr = parsed.date ?? format(billDate, "yyyy-MM-dd");
          const effectiveDate = parsed.date ? new Date(parsed.date) : billDate;

          // ── Apply 3-Tier Smart Rules Matching from history before saving ──
          if (hasGstItems) {
            const matched = matchTransactionRules(
              parsed.vendor,
              parsed.amount,
              parsed.description || "",
              mainCategoryVal,
              entityName,
              expenseCategory,
              rulesMaps
            );
            mainCategoryVal = matched.category;
            entityName = matched.company_entity as any;
            expenseCategory = matched.expense_category;
          } else {
            const matched = matchTransactionRules(
              parsed.vendor,
              parsed.amount,
              parsed.description || "",
              mainCategoryVal,
              entityName,
              expenseCategory,
              rulesMaps
            );
            mainCategoryVal = matched.category;
            entityName = matched.company_entity as any;
            expenseCategory = matched.expense_category;
            finalRawText = matched.description
              ? `${expenseCategory} · ${matched.description}`
              : (parsed.vendor ? `${expenseCategory} · ${parsed.vendor}` : expenseCategory);
          }

          // ── Duplicate Entry Prevention / History Check ──
          const invoiceNum = parsed.invoice_number;
          let dup: any = null;
          if (invoiceNum) {
            dup = expenses.find(e => {
              if (!e.raw_text) return false;
              const invMatch = /Inv:\s*([^\s·•\n]+)/i.exec(e.raw_text);
              if (invMatch) {
                return invMatch[1].toLowerCase() === invoiceNum.toLowerCase();
              }
              return false;
            });
          }

          if (!dup) {
            dup = findDuplicateInHistory(parsed.vendor, parsed.amount, effectiveDateStr, expenses);
          }

          if (dup) {
            const formattedAmount = dup.amount % 1 === 0 ? dup.amount.toLocaleString('en-IN') : dup.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const dupDate = dup.date || (dup.created_at ? dup.created_at.split('T')[0] : '');
            const proceed = window.confirm(
              `Duplicate detected — A transaction from ${dup.vendor} for ₹${formattedAmount} on ${dupDate} already exists. Add anyway or discard?`
            );
            if (!proceed) {
              failCount++;
              continue;
            }
          }

          // ── Debit Note / Credit Note handling: merge with linked invoice ──────────
          if (parsed.debit_note_target || /debit|credit|rate difference/i.test(parsed.description || "")) {
            const applied = await mergeDebitOrCreditNote(supabase, parsed, effectiveDate);
            if (applied) {
              successCount++;
              continue;
            }
          }

        // ── Multi-item invoice: insert each line item as a separate row ───
        if (!hasGstItems && parsed.line_items && parsed.line_items.length > 0) {
          for (const item of parsed.line_items) {
            const itemExpCat = (item.description || "").toLowerCase().includes("raw material") ? "Raw material" : expenseCategory;
            
            // Match rules for this line item vendor and amount!
            const matchedItem = matchTransactionRules(
              item.vendor || parsed.vendor,
              item.amount,
              item.description || parsed.description || "",
              parsed.category as "Business" | "Personal",
              entityName,
              itemExpCat,
              rulesMaps
            );

            const finalItemText = matchedItem.description
              ? `${matchedItem.expense_category} · ${matchedItem.description}`
              : (item.vendor || parsed.vendor ? `${matchedItem.expense_category} · ${item.vendor || parsed.vendor}` : matchedItem.expense_category);

            let inserted: any = null;
            let error: any = null;

            try {
              const res = await supabase
                .from("expenses")
                .insert({
                  amount: item.amount,
                  vendor: item.vendor || parsed.vendor,
                  category: matchedItem.category,
                  currency: detectedCurrency,
                  raw_text: finalItemText,
                  user_id: user.id,
                  business_id: linkedBusiness,
                  created_at: new Date().toISOString(),
                  date: effectiveDateStr,
                  main_category: matchedItem.category,
                  company_entity: matchedItem.company_entity,
                  expense_category: matchedItem.expense_category,
                })
                .select()
                .single();
              inserted = res.data;
              error = res.error;
            } catch (e: any) {
              error = e;
            }

            if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
              console.warn("[Dashboard] Scan insert Tier 1 failed (column undefined). Retrying Tier 2 (without main_category)...");
              try {
                const res = await supabase
                  .from("expenses")
                  .insert({
                    amount: item.amount,
                    vendor: item.vendor || parsed.vendor,
                    category: matchedItem.category,
                    currency: detectedCurrency,
                    raw_text: finalItemText,
                    user_id: user.id,
                    business_id: linkedBusiness,
                    created_at: new Date().toISOString(),
                    date: effectiveDateStr,
                    company_entity: matchedItem.company_entity,
                    expense_category: matchedItem.expense_category,
                  })
                  .select()
                  .single();
                inserted = res.data;
                error = res.error;
              } catch (e: any) {
                error = e;
              }
            }

            if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
              console.warn("[Dashboard] Scan insert Tier 2 failed (column undefined). Retrying Tier 3 (legacy)...");
              try {
                const res = await supabase
                  .from("expenses")
                  .insert({
                    amount: item.amount,
                    vendor: item.vendor || parsed.vendor,
                    category: matchedItem.category,
                    currency: detectedCurrency,
                    raw_text: finalItemText,
                    user_id: user.id,
                    business_id: linkedBusiness,
                    created_at: new Date().toISOString(),
                  })
                  .select()
                  .single();
                inserted = res.data;
                error = res.error;
              } catch (e: any) {
                error = e;
              }
            }

            if (error) throw error;

            const rate = getRateToINR(detectedCurrency, effectiveDate);
            await supabase.from("audit_records").insert({
              expense_id: inserted.id,
              user_id: user.id,
              bill_date: effectiveDateStr,
              original_currency: detectedCurrency,
              original_amount: item.amount,
              exchange_rate_to_inr: rate,
            });
          }
          successCount++;
          continue;
        }

        // ── Standard single-item insert ──────────────────────────────────
        let inserted: any = null;
        let error: any = null;

        try {
          const res = await supabase
            .from("expenses")
            .insert({
              amount: parsed.amount,
              vendor: parsed.vendor,
              category: hasGstItems ? "Business" : parsed.category,
              currency: detectedCurrency,
              raw_text: finalRawText,
              user_id: user.id,
              business_id: linkedBusiness,
              created_at: new Date().toISOString(),
              date: effectiveDateStr,
              main_category: mainCategoryVal,
              company_entity: entityName,
              expense_category: expenseCategory,
            })
            .select()
            .single();
          inserted = res.data;
          error = res.error;
        } catch (e: any) {
          error = e;
        }

        if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
          console.warn("[Dashboard] Scan insert Tier 1 failed (column undefined). Retrying Tier 2 (without main_category)...");
          try {
            const res = await supabase
              .from("expenses")
              .insert({
                amount: parsed.amount,
                vendor: parsed.vendor,
                category: hasGstItems ? "Business" : parsed.category,
                currency: detectedCurrency,
                raw_text: finalRawText,
                user_id: user.id,
                business_id: linkedBusiness,
                created_at: new Date().toISOString(),
                date: effectiveDateStr,
                company_entity: entityName,
                expense_category: expenseCategory,
              })
              .select()
              .single();
            inserted = res.data;
            error = res.error;
          } catch (e: any) {
            error = e;
          }
        }

        if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
          console.warn("[Dashboard] Scan insert Tier 2 failed (column undefined). Retrying Tier 3 (legacy)...");
          try {
            const res = await supabase
              .from("expenses")
              .insert({
                amount: parsed.amount,
                vendor: parsed.vendor,
                category: hasGstItems ? "Business" : parsed.category,
                currency: detectedCurrency,
                raw_text: finalRawText,
                user_id: user.id,
                business_id: linkedBusiness,
                created_at: new Date().toISOString(),
              })
              .select()
              .single();
            inserted = res.data;
            error = res.error;
          } catch (e: any) {
            error = e;
          }
        }

        if (error) throw error;

        // Create audit record
        const rate = getRateToINR(detectedCurrency, effectiveDate);
        const inrAmount = parsed.amount * rate;

        await supabase.from("audit_records").insert({
          expense_id: inserted.id,
          user_id: user.id,
          bill_date: effectiveDateStr,
          original_currency: detectedCurrency,
          original_amount: parsed.amount,
          exchange_rate_to_inr: rate,
        });

        successCount++;
      } catch (err: any) {
        console.error(`Failed to batch-process "${file.name}":`, err);
        const errMsg = err?.message || err?.toString() || "";
        if (errMsg.includes("Rejection:") || errMsg.includes("rejected") || errMsg.includes("missing")) {
          toast.error(`"${file.name}" rejected: ${errMsg.replace(/^(Error:\s*)+/i, "")}`);
        } else {
          failCount++;
        }
      }
    }
    } catch (err: any) {
      console.error("[Dashboard] Batch upload rules/history load error:", err);
      toast.error("Error loading rules: " + (err.message || err));
    } finally {
      setProcessing(false);
      setBatchProgress(null);
      loadExpenses();
    }

    if (successCount > 0) {
      toast.success(`Successfully parsed and saved ${successCount} receipt(s)!`);
    }
    if (failCount > 0) {
      toast.error(`Failed to process ${failCount} receipt(s).`);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, {
          type: mr.mimeType || "audio/webm",
        });
        if (blob.size > MAX_ATTACHMENT_BYTES) {
          toast.error("Recording too long (max 8 MB)");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          setAttachment({
            dataUrl: reader.result as string,
            mimeType: blob.type,
            kind: "audio",
            name: `voice-note-${new Date().toISOString().slice(0, 19)}.webm`,
            sizeKb: Math.round(blob.size / 1024),
          });
        };
        reader.readAsDataURL(blob);
      };

      // Start Speech Recognition in parallel for real-time transcription
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "en-IN"; // Configured for Indian English/accents
        
        setRawText(""); // Clear previous text to show fresh transcription
        let finalTranscript = "";
        
        recognition.onresult = (event: any) => {
          let interimTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript + " ";
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          const transcript = (finalTranscript + interimTranscript).trim();
          if (transcript) {
            setRawText(transcript);
          }
        };
        
        recognition.onerror = (err: any) => {
          console.error("Speech recognition error:", err);
        };
        
        recognition.start();
        recognitionRef.current = recognition;
      }

      mr.start();
      recorderRef.current = mr;
      setRecording(true);
    } catch {
      toast.error("Microphone permission denied");
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (err) {
        console.error("Error stopping speech recognition:", err);
      }
      recognitionRef.current = null;
    }
    
    setRecording(false);
  };

  const handleBusinessChange = (val: string) => {
    if (val === ADD_NEW_VALUE) {
      setShowNewBusiness(true);
      return;
    }
    setBusinessId(val);
    setShowNewBusiness(false);
  };

  const handleCreateBusiness = async () => {
    const name = newBusinessName.trim();
    if (!name) return;
    try {
      const created = await addBusiness(name);
      if (created) {
        setBusinessId(created.id);
        setNewBusinessName("");
        setShowNewBusiness(false);
        toast.success(`Added business "${created.name}"`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not add business";
      toast.error(msg);
    }
  };

  const handleProcess = async () => {
    if (!rawText.trim() && !attachment) {
      toast.error("Add text or an attachment first");
      return;
    }
    if (!user) {
      toast.error("You must be signed in");
      return;
    }
    setProcessing(true);
    try {
      const rulesMaps = await fetchRulesAndHistory(user.id);

      let parsed: { vendor: string; amount: number; category: string; currency: string; description?: string; date?: string; company_entity?: "KS" | "TI" | "CPM" | "AAS" | "None"; line_items?: { vendor: string; amount: number; description?: string }[]; debit_note_target?: string; invoice_number?: string };
      
      if (attachment && attachment.kind === "image" && selectedFile) {
        // 1. Resize image if long edge > 1500px
        const resizedFile = await resizeImageIfNeeded(selectedFile);
        
        // 2. Convert to clean base64
        const base64String = await fileToBase64(resizedFile);
        
        // 3. Send POST request to n8n webhook
        let extractedText = "";
        const configuredUrl = await getWebhookUrlFn();

        if (configuredUrl.includes("localhost") || configuredUrl.includes("127.0.0.1")) {
          // Attempt client-side direct request to bypass Cloudflare Worker loopback block
          console.log("[Client Direct] Webhook URL is local. Attempting direct browser request to:", configuredUrl);
          try {
            const res = await fetch(configuredUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageBase64: base64String }),
            });
            if (res.ok) {
              const resData = await res.json();
              if (Array.isArray(resData)) {
                extractedText = resData[0]?.extractedText || JSON.stringify(resData);
              } else {
                extractedText = resData.extractedText || JSON.stringify(resData);
              }
            } else {
              throw new Error(`Local fetch status ${res.status}`);
            }
          } catch (localErr) {
            console.warn("[Client Direct] Direct fetch to local n8n failed or was blocked by CORS. Falling back to proxy...", localErr);
            const n8nResult = await sendImageToN8nFn({
              data: { 
                imageBase64: base64String,
                fileName: selectedFile.name
              }
            });
            extractedText = n8nResult.extractedText;
          }
        } else {
          // Send request via server proxy function (for remote URL to bypass browser CORS)
          const n8nResult = await sendImageToN8nFn({
            data: { 
              imageBase64: base64String,
              fileName: selectedFile.name
            }
          });
          extractedText = n8nResult.extractedText;
        }

        if (!extractedText) {
          throw new Error("No extractedText returned from n8n webhook");
        }
        
        // 4. Send the extractedText string to standard parseExpenseWithAI as raw text
        parsed = await parseFn({
          data: {
            rawText: extractedText,
            defaultCurrency: captureCurrency,
          },
        }) as any;
      } else {
        parsed = await parseFn({
          data: {
            rawText,
            defaultCurrency: captureCurrency,
            attachment: attachment
              ? {
                  dataUrl: attachment.dataUrl,
                  mimeType: attachment.mimeType,
                  kind: attachment.kind,
                  name: attachment.name,
                  sizeKb: attachment.sizeKb,
                }
              : undefined,
          },
        }) as any;
      }
      const detectedCurrency = (parsed.currency || captureCurrency).toUpperCase();
      const linkedBusiness =
        businessId !== "none" && businessId !== ADD_NEW_VALUE ? businessId : null;

      let entityName: "KS" | "TI" | "CPM" | "AAS" | "None" = "None";
      let finalRawText = "";
      let expenseCategory = "Other expenses";

      const hasGstItems = (parsed as any).items && (parsed as any).items.length > 0;

      if (hasGstItems) {
        const items = (parsed as any).items as any[];
        const materialDetails = items.map((it: any) => it.description).filter(Boolean).join(", ");
        
        // Auto-classify cost category based on items description
        const classified = parseExpenseCategoryAndDescription(materialDetails);
        expenseCategory = classified.expenseCategory;
        
        const firstItem = items[0];
        const rateVal = firstItem?.rate ?? 0;
        const unitVal = firstItem?.unit || 'unit';
        const qtyVal = firstItem?.quantity ?? 0;
        const gstVal = (parsed as any).total_gst_amount ?? 0;
        
        const rateText = rateVal % 1 === 0 ? rateVal.toString() : rateVal.toFixed(2);
        const qtyText = qtyVal % 1 === 0 ? qtyVal.toString() : qtyVal.toFixed(3);
        const gstText = gstVal.toLocaleString('en-IN');
        
        finalRawText = `${expenseCategory} · ${materialDetails} @ ₹${rateText}/${unitVal} · Qty: ${qtyText} ${unitVal} · GST: ₹${gstText}`;
        if (parsed.invoice_number) {
          finalRawText += ` · Inv: ${parsed.invoice_number}`;
        }
        
        entityName = matchBuyerToEntity((parsed as any).buyer_name, businesses) as any;
      } else {
        const isBiz = parsed.category === "Business" || 
                      !!linkedBusiness || 
                      (parsed.company_entity && parsed.company_entity !== "None");

        if (parsed.company_entity && parsed.company_entity !== "None") {
          entityName = parsed.company_entity;
        } else if (isBiz && linkedBusiness) {
          const biz = businesses.find((b) => b.id === linkedBusiness);
          if (biz) {
            const bname = biz.name.toUpperCase();
            if (["KS", "TI", "CPM", "AAS"].includes(bname)) {
              entityName = bname as any;
            }
          }
        }
        
        const cleanDescVal = cleanDescription(parsed.description || rawText, String(parsed.amount));
        const classified = parseExpenseCategoryAndDescription(cleanDescVal || rawText || parsed.description);
        expenseCategory = classified.expenseCategory;
        
        finalRawText = cleanDescVal 
          ? `${expenseCategory} · ${cleanDescVal}` 
          : (parsed.description || rawText || 
             (parsed.vendor ? `${expenseCategory} · ${parsed.vendor}` : expenseCategory));
      }

      let mainCategoryVal = hasGstItems ? "Business" : (parsed.category === "Business" ? "Business" : "Personal");
      const effectiveDateStr = parsed.date ?? format(billDate, "yyyy-MM-dd");
      const effectiveDate = parsed.date ? new Date(parsed.date) : billDate;

      // ── Apply 3-Tier Smart Rules Matching from history before saving ──
      if (hasGstItems) {
        const matched = matchTransactionRules(
          parsed.vendor,
          parsed.amount,
          parsed.description || "",
          mainCategoryVal,
          entityName,
          expenseCategory,
          rulesMaps
        );
        mainCategoryVal = matched.category;
        entityName = matched.company_entity as any;
        expenseCategory = matched.expense_category;
      } else {
        const matched = matchTransactionRules(
          parsed.vendor,
          parsed.amount,
          parsed.description || "",
          mainCategoryVal,
          entityName,
          expenseCategory,
          rulesMaps
        );
        mainCategoryVal = matched.category;
        entityName = matched.company_entity as any;
        expenseCategory = matched.expense_category;
        finalRawText = matched.description
          ? `${matched.expense_category} · ${matched.description}`
          : (parsed.vendor ? `${matched.expense_category} · ${parsed.vendor}` : matched.expense_category);
      }

      // ── Duplicate Entry Prevention / History Check ──
      const invoiceNum = parsed.invoice_number;
      let dup: any = null;
      if (invoiceNum) {
        dup = expenses.find(e => {
          if (!e.raw_text) return false;
          const invMatch = /Inv:\s*([^\s·•\n]+)/i.exec(e.raw_text);
          if (invMatch) {
            return invMatch[1].toLowerCase() === invoiceNum.toLowerCase();
          }
          return false;
        });
      }

      if (!dup) {
        dup = findDuplicateInHistory(parsed.vendor, parsed.amount, effectiveDateStr, expenses);
      }

      if (dup) {
        const formattedAmount = dup.amount % 1 === 0 ? dup.amount.toLocaleString('en-IN') : dup.amount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const dupDate = dup.date || (dup.created_at ? dup.created_at.split('T')[0] : '');
        const proceed = window.confirm(
          `Duplicate detected — A transaction from ${dup.vendor} for ₹${formattedAmount} on ${dupDate} already exists. Add anyway or discard?`
        );
        if (!proceed) {
          setProcessing(false);
          return;
        }
      }

      // ── Debit Note / Credit Note handling: merge with linked invoice ──────────
      if (parsed.debit_note_target || /debit|credit|rate difference/i.test(parsed.description || "")) {
        const applied = await mergeDebitOrCreditNote(supabase, parsed, effectiveDate);
        if (applied) {
          setRawText("");
          setAttachment(null);
          setSelectedFile(null);
          loadExpenses();
          return; // don't create a new standalone entry
        }
      }

      // ── Multi-item invoice: insert each line item as a separate row ───
      if (!hasGstItems && parsed.line_items && parsed.line_items.length > 0) {
        for (const item of parsed.line_items) {
          const itemExpCat = (item.description || "").toLowerCase().includes("raw material") ? "Raw material" : expenseCategory;
          
          // Match rules for this line item vendor and amount!
          const matchedItem = matchTransactionRules(
            item.vendor || parsed.vendor,
            item.amount,
            item.description || parsed.description || "",
            parsed.category as "Business" | "Personal",
            entityName,
            itemExpCat,
            rulesMaps
          );

          const finalItemText = matchedItem.description
            ? `${matchedItem.expense_category} · ${matchedItem.description}`
            : (item.vendor || parsed.vendor ? `${matchedItem.expense_category} · ${item.vendor || parsed.vendor}` : matchedItem.expense_category);

          let inserted: any = null;
          let error: any = null;

          try {
            const res = await supabase
              .from("expenses")
              .insert({
                amount: item.amount,
                vendor: item.vendor || parsed.vendor,
                category: matchedItem.category,
                currency: detectedCurrency,
                raw_text: finalItemText,
                user_id: user.id,
                business_id: linkedBusiness,
                created_at: new Date().toISOString(),
                date: effectiveDateStr,
                main_category: matchedItem.category,
                company_entity: matchedItem.company_entity,
                expense_category: matchedItem.expense_category,
              })
              .select()
              .single();
            inserted = res.data;
            error = res.error;
          } catch (e: any) {
            error = e;
          }

          if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
            console.warn("[Dashboard] Text insert Tier 1 failed (column undefined). Retrying Tier 2 (without main_category)...");
            try {
              const res = await supabase
                .from("expenses")
                .insert({
                  amount: item.amount,
                  vendor: item.vendor || parsed.vendor,
                  category: matchedItem.category,
                  currency: detectedCurrency,
                  raw_text: finalItemText,
                  user_id: user.id,
                  business_id: linkedBusiness,
                  created_at: new Date().toISOString(),
                  date: effectiveDateStr,
                  company_entity: matchedItem.company_entity,
                  expense_category: matchedItem.expense_category,
                })
                .select()
                .single();
              inserted = res.data;
              error = res.error;
            } catch (e: any) {
              error = e;
            }
          }

          if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
            console.warn("[Dashboard] Text insert Tier 2 failed (column undefined). Retrying Tier 3 (legacy)...");
            try {
              const res = await supabase
                .from("expenses")
                .insert({
                  amount: item.amount,
                  vendor: item.vendor || parsed.vendor,
                  category: matchedItem.category,
                  currency: detectedCurrency,
                  raw_text: finalItemText,
                  user_id: user.id,
                  business_id: linkedBusiness,
                  created_at: new Date().toISOString(),
                })
                .select()
                .single();
              inserted = res.data;
              error = res.error;
            } catch (e: any) {
              error = e;
            }
          }

          if (error) throw error;

          const rate = getRateToINR(detectedCurrency, effectiveDate);
          await supabase.from("audit_records").insert({
            expense_id: inserted.id,
            user_id: user.id,
            bill_date: effectiveDateStr,
            original_currency: detectedCurrency,
            original_amount: item.amount,
            exchange_rate_to_inr: rate,
          });
        }

        toast.success(
          `Logged ${parsed.line_items.length} items from ${parsed.vendor} — Total ${formatCurrency(parsed.amount, detectedCurrency)}`,
        );
        setRawText("");
        setAttachment(null);
        setSelectedFile(null);
        loadExpenses();
        return;
      }

      // ── Standard single-item insert ──────────────────────────────────
      let inserted: any = null;
      let error: any = null;

      try {
        const res = await supabase
          .from("expenses")
          .insert({
            amount: parsed.amount,
            vendor: parsed.vendor,
            category: mainCategoryVal,
            currency: detectedCurrency,
            raw_text: finalRawText,
            user_id: user.id,
            business_id: linkedBusiness,
            created_at: new Date().toISOString(),
            date: effectiveDateStr,
            main_category: mainCategoryVal,
            company_entity: entityName,
            expense_category: expenseCategory,
          })
          .select()
          .single();
        inserted = res.data;
        error = res.error;
      } catch (e: any) {
        error = e;
      }

      if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
        console.warn("[Dashboard] Text insert Tier 1 failed (column undefined). Retrying Tier 2 (without main_category)...");
        try {
          const res = await supabase
            .from("expenses")
            .insert({
              amount: parsed.amount,
              vendor: parsed.vendor,
              category: mainCategoryVal,
              currency: detectedCurrency,
              raw_text: finalRawText,
              user_id: user.id,
              business_id: linkedBusiness,
              created_at: new Date().toISOString(),
              date: effectiveDateStr,
              company_entity: entityName,
              expense_category: expenseCategory,
            })
            .select()
            .single();
          inserted = res.data;
          error = res.error;
        } catch (e: any) {
          error = e;
        }
      }

      if (error && (error.code === "42703" || (error.message && error.message.includes("column")))) {
        console.warn("[Dashboard] Text insert Tier 2 failed (column undefined). Retrying Tier 3 (legacy)...");
        try {
          const res = await supabase
            .from("expenses")
            .insert({
              amount: parsed.amount,
              vendor: parsed.vendor,
              category: mainCategoryVal,
              currency: detectedCurrency,
              raw_text: finalRawText,
              user_id: user.id,
              business_id: linkedBusiness,
              created_at: new Date().toISOString(),
            })
            .select()
            .single();
          inserted = res.data;
          error = res.error;
        } catch (e: any) {
          error = e;
        }
      }

      if (error) throw error;

      // Audit record with historical FX rate
      const rate = getRateToINR(detectedCurrency, effectiveDate);
      await supabase.from("audit_records").insert({
        expense_id: inserted.id,
        user_id: user.id,
        bill_date: effectiveDateStr,
        original_currency: detectedCurrency,
        original_amount: parsed.amount,
        exchange_rate_to_inr: rate,
      });

      toast.success(
        `Logged ${parsed.vendor} — ${formatCurrency(parsed.amount, detectedCurrency)}`,
      );
      setRawText("");
      setAttachment(null);
      setSelectedFile(null);
      loadExpenses();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Processing failed";
      if (msg.includes("429")) toast.error("Rate limit reached. Try again shortly.");
      else if (msg.includes("402")) toast.error("AI credits exhausted. Add credits in Settings.");
      else toast.error(msg);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-background relative overflow-hidden">
      {/* Decorative Premium Gold Ambient Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />
      <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.04)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />

      <DashboardSidebar />

      <main className="flex-1 min-w-0 relative z-10">
        <header className="border-b border-border bg-card/50 backdrop-blur">
          <div className="px-6 lg:px-10 py-5 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground">Dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Welcome back. Here is your unified corporate ledger, real-time outflow velocity, and financial intelligence overview.
              </p>
            </div>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <CurrencySwitcher />
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground">
                <span className="w-2 h-2 rounded-full bg-success" />
                Live ledger
              </div>
            </div>
          </div>
        </header>

        <div className="px-6 lg:px-10 py-8 space-y-8 max-w-6xl">
          {/* Capture */}
          <section className="relative rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            {batchProgress && (
              <div 
                className="absolute inset-0 bg-[#0B1124]/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 z-50 animate-fade-in border rounded-xl"
                style={{ borderColor: 'var(--border)' }}
              >
                <div className="w-full max-w-xs space-y-6 text-center">
                  
                  {/* Decorative Glow & Dual Spinner System */}
                  <div className="relative w-20 h-20 mx-auto flex items-center justify-center">
                    {/* Glowing Aura */}
                    <div 
                      className="absolute -inset-4 rounded-full pointer-events-none blur-xl animate-pulse"
                      style={{ background: 'radial-gradient(circle, var(--rose-copper) 0%, transparent 70%)', opacity: 0.18 }}
                    />
                    
                    {/* Outer Counter-Rotating Dashed Dotted Ring */}
                    <div 
                      className="absolute inset-[-6px] rounded-full border border-dashed animate-spin" 
                      style={{ 
                        animationDuration: "12s", 
                        animationDirection: "reverse",
                        borderColor: 'var(--border)'
                      }} 
                    />
                    
                    {/* Rotating Conic Ring */}
                    <div 
                      className="absolute inset-0 rounded-full animate-spin p-[1.5px] shadow-lg"
                      style={{ 
                        background: 'conic-gradient(from 0deg, var(--primary), var(--rose-copper), var(--primary))',
                        boxShadow: '0 0 15px var(--primary)'
                      }}
                    >
                      {/* Inner Dark Mask */}
                      <div className="w-full h-full rounded-full bg-[#0C162F] flex items-center justify-center">
                        <Sparkles 
                          className="w-6 h-6 text-[var(--primary)] filter animate-pulse" 
                          style={{ filter: 'drop-shadow(0 0 8px var(--primary))' }}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Typography & Readability */}
                  <div className="space-y-1.5">
                    <p 
                      className="text-[15px] font-semibold tracking-wide animate-pulse"
                      style={{ color: 'var(--rose-copper)', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}
                    >
                      AI is parsing your receipts...
                    </p>
                    <p className="text-[10px] text-[#8A98B0] font-mono font-medium tracking-wider uppercase">
                      Receipt {batchProgress.current} of {batchProgress.total}
                    </p>
                  </div>

                  {/* Gorgeous Premium Progress Bar */}
                  <div className="space-y-2">
                    <div 
                      className="h-1.5 w-full bg-slate-950/80 rounded-full overflow-hidden border shadow-inner"
                      style={{ borderColor: 'rgba(255, 255, 255, 0.08)' }}
                    >
                      <div 
                        className="h-full transition-all duration-500 ease-out rounded-full"
                        style={{ 
                          width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                          backgroundImage: 'linear-gradient(to right, var(--crystal-teal-deep), var(--primary), var(--rose-copper))',
                          boxShadow: '0 0 8px var(--primary)'
                        }}
                      />
                    </div>
                    {/* Progress percentage label */}
                    <div className="text-[9px] text-[#8A98B0]/80 font-mono tracking-widest uppercase flex justify-between px-0.5">
                      <span>Analyzing</span>
                      <span className="font-semibold" style={{ color: 'var(--primary)' }}>
                        {Math.round((batchProgress.current / batchProgress.total) * 100)}%
                      </span>
                    </div>
                  </div>

                </div>
              </div>
            )}
            <div className="px-6 py-4 border-b border-border flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold tracking-tight text-foreground uppercase">
                  Capture
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Default currency</span>
                <Select value={captureCurrency} onValueChange={setCaptureCurrency}>
                  <SelectTrigger className="h-8 w-[90px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCY_OPTIONS.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="p-6 space-y-4">
              {/* Business + bill date row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-[var(--rose-copper)]" /> Business
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowNewBusiness(!showNewBusiness)}
                      className="text-xs font-semibold text-primary hover:text-primary/80 transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3 text-primary" /> Add Business
                    </button>
                  </div>
                  <Select value={businessId} onValueChange={handleBusinessChange}>
                    <SelectTrigger className="bg-background border-[var(--rose-copper)]/40">
                      <SelectValue placeholder="Select a business" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None / Personal</SelectItem>
                      {businesses.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {showNewBusiness && (
                    <div className="flex items-center gap-2 pt-2">
                      <Input
                        autoFocus
                        value={newBusinessName}
                        onChange={(e) => setNewBusinessName(e.target.value)}
                        placeholder="New business name"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateBusiness();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleCreateBusiness}
                        className="bg-[var(--midnight-navy)] text-[var(--marble-white)] hover:bg-[var(--midnight-navy)]/90"
                      >
                        <Plus className="w-4 h-4" /> Save
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowNewBusiness(false);
                          setNewBusinessName("");
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Date of bill
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full justify-start text-left font-normal bg-background border-[var(--rose-copper)]/40",
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-[var(--rose-copper)]" />
                        {format(billDate, "PPP")}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={billDate}
                        onSelect={(d) => d && setBillDate(d)}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <Textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste Bill, SMS, or Note&#10;&#10;e.g. Spent ₹450 at Chai Point for client meeting"
                className="min-h-[140px] resize-y text-sm font-mono bg-background"
                disabled={processing}
              />

              {/* Attachment row */}
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleMultipleFiles(e.target.files, "image");
                  e.target.value = "";
                }}
              />
              <input
                ref={pdfInputRef}
                type="file"
                accept="application/pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  void handleMultipleFiles(e.target.files, "pdf");
                  e.target.value = "";
                }}
              />

              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={processing || recording || !!attachment}
                  onClick={() => imageInputRef.current?.click()}
                >
                  <ImageIcon className="w-4 h-4 mr-1.5" /> Image
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={processing || recording || !!attachment}
                  onClick={() => pdfInputRef.current?.click()}
                >
                  <FileText className="w-4 h-4 mr-1.5" /> PDF
                </Button>
                {!recording ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={processing || !!attachment}
                    onClick={startRecording}
                  >
                    <Mic className="w-4 h-4 mr-1.5" /> Voice note
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={stopRecording}
                  >
                    <Square className="w-4 h-4 mr-1.5" /> Stop recording
                  </Button>
                )}

                {attachment && (
                  <div className="flex items-center gap-2 text-xs bg-muted rounded-md pl-2 pr-1 py-1">
                    <Paperclip className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="font-medium truncate max-w-[200px]">{attachment.name}</span>
                    <span className="text-muted-foreground">{attachment.sizeKb} KB</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachment(null);
                        setSelectedFile(null);
                      }}
                      className="p-0.5 rounded hover:bg-background"
                      aria-label="Remove attachment"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-4 flex-wrap">
                <p className="text-xs text-muted-foreground">
                  AI extracts vendor, amount, currency, and category. Bill date and FX rate are
                  saved to the audit log.
                </p>
                <Button
                  onClick={handleProcess}
                  disabled={processing || recording || (!rawText.trim() && !attachment)}
                  size="lg"
                  className="btn-process px-6 hover:bg-transparent"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 mr-2" />
                      Process with AI
                    </>
                  )}
                </Button>
              </div>
            </div>
          </section>



          {/* Master Monthly File Upload */}
          <MasterUpload
            onAuditingChange={setAuditing}
            onSuccess={() => loadExpenses()}
          />

          {/* Summary */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-wrap bg-card/40 backdrop-blur p-4 rounded-xl border border-border">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-primary" />
                <h2 className="text-sm font-bold tracking-tight text-foreground uppercase">
                  Financial Summary ({selectedPeriod === "All" ? "All-Time" : selectedPeriod})
                </h2>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-semibold">Select Period:</span>
                <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
                  <SelectTrigger className="w-[210px] h-8.5 text-xs bg-background border-border">
                    <SelectValue placeholder="Select Period" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CY 2026">📅 Calendar Year 2026</SelectItem>
                    <SelectItem value="CY 2025">📅 Calendar Year 2025</SelectItem>
                    <SelectItem value="FY 2026-27">🇮🇳 FY 2026-27 (Apr-Mar)</SelectItem>
                    <SelectItem value="FY 2025-26">🇮🇳 FY 2025-26 (Apr-Mar)</SelectItem>
                    <SelectItem value="All">🌍 All-Time Summary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SummaryCard
                icon={TrendingUp}
                label="Total Expenses"
                value={totals.total}
                currency={displayCurrency}
                tone="default"
                count={totals.totalCount}
              />
              <SummaryCard
                icon={Briefcase}
                label="Business Spend"
                value={totals.business}
                currency={displayCurrency}
                tone="primary"
                count={totals.businessCount}
              />
              <SummaryCard
                icon={User}
                label="Personal Spend"
                value={totals.personal}
                currency={displayCurrency}
                tone="muted"
                count={totals.personalCount}
              />
            </div>
          </section>

          {/* Ledger */}
          <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
            <div className="px-6 py-5 border-b border-border flex items-center justify-between bg-gradient-to-r from-muted/30 to-transparent">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold tracking-tight text-foreground uppercase flex items-center gap-2">
                  <FileText className="w-5 h-5 text-primary" />
                  Transaction Ledger
                </h2>
                <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold shadow-sm border border-primary/20">
                  {filteredLedgerExpenses.length} of {expenses.length} entries
                </span>
              </div>
            </div>

            {/* Live Search and Filter Pills */}
            <div className="px-6 py-4 border-b border-border bg-muted/10 space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Input
                    value={searchTerm}
                    onChange={(ev) => setSearchTerm(ev.target.value)}
                    placeholder="Search vendor, category, amount..."
                    className="pl-3 pr-8 h-9 text-xs bg-background/50 border-border focus-visible:ring-[var(--rose-copper)]"
                  />
                  {searchTerm && (
                    <button
                      onClick={() => setSearchTerm("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                
                {/* Horizontal Entity Pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mr-1">
                    Entity:
                  </span>
                  {(["All", "KS", "TI", "CPM", "AAS", "Swati", "Others", "None"] as const).map((ent) => {
                    const active = activeEntityFilter === ent;
                    return (
                      <button
                        key={ent}
                        onClick={() => setActiveEntityFilter(ent)}
                        className={cn(
                          "px-3 py-1 rounded-full text-xs font-medium border transition-all duration-300",
                          active
                            ? "bg-[var(--midnight-navy)] text-[var(--marble-white)] border-[var(--crystal-teal)] shadow-[0_0_8px_rgba(40,162,184,0.3)]"
                            : "border-border bg-background text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        )}
                      >
                        {ent}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border bg-muted/30">
                    <th className="px-4 py-3 font-medium w-[90px]">Date</th>
                    <th className="px-4 py-3 font-medium">Vendor</th>
                    <th className="px-4 py-3 font-medium w-[110px]">Category</th>
                    <th className="px-4 py-3 font-medium w-[80px]">Entity</th>
                    <th className="px-4 py-3 font-medium w-[160px]">Expense Category</th>
                    <th className="px-4 py-3 font-medium text-right w-[130px] whitespace-nowrap">Amount ({displayCurrency})</th>
                  </tr>
                </thead>
                <tbody>
                  {auditing ? (
                    <>
                      <tr>
                        <td colSpan={6} className="px-6 pt-4 pb-2">
                          <div className="flex items-center gap-2 text-xs text-[var(--crystal-teal-deep)] font-medium">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            FinStream AI is auditing your monthly statement over secure cloud servers…
                          </div>
                        </td>
                      </tr>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-border last:border-0">
                          <td className="px-6 py-3"><Skeleton className="h-4 w-24" /></td>
                          <td className="px-6 py-3"><Skeleton className="h-4 w-40" /></td>
                          <td className="px-6 py-3"><Skeleton className="h-5 w-20 rounded-full" /></td>
                          <td className="px-6 py-3"><Skeleton className="h-4 w-12" /></td>
                          <td className="px-6 py-3"><Skeleton className="h-4 w-32" /></td>
                          <td className="px-6 py-3"><Skeleton className="h-4 w-20 ml-auto" /></td>
                        </tr>
                      ))}
                    </>
                  ) : loading ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : loadError ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-destructive">
                          <AlertCircle className="w-5 h-5" />
                          <p className="text-sm">{loadError}</p>
                          <Button size="sm" variant="outline" onClick={() => loadExpenses()}>
                            Retry
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ) : filteredLedgerExpenses.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Inbox className="w-6 h-6" />
                          <p className="text-sm">No matching transactions found.</p>
                          <p className="text-xs">Adjust your search or filter pills.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredLedgerExpenses.map((e) => {
                      const converted = convertAmount(
                        Number(e.amount) || 0,
                        e.currency || "INR",
                        displayCurrency,
                        e.date || e.created_at,
                      );

                      const cleanVendor = cleanVendorName(e.vendor);
                      
                      let displayDate = "";
                      try {
                        const d = e.date ? new Date(e.date) : new Date(e.created_at);
                        if (!isNaN(d.getTime())) {
                          displayDate = format(d, "dd-MMM-yy");
                        } else {
                          displayDate = format(new Date(), "dd-MMM-yy");
                        }
                      } catch {
                        displayDate = format(new Date(), "dd-MMM-yy");
                      }

                      const displayMainCategory = e.main_category || e.category || "Personal";
                      
                      let displayCompanyEntity = e.company_entity || "None";
                      if (displayCompanyEntity === "None" || displayCompanyEntity === "NONE") {
                        displayCompanyEntity = resolveEntityFromVendor(e.vendor, e.raw_text);
                      }
                      
                      let displayExpenseCategory = e.expense_category || "Other expenses";
                      if (!e.expense_category && e.raw_text) {
                        const parsed = parseExpenseCategoryAndDescription(e.raw_text);
                        displayExpenseCategory = parsed.expenseCategory;
                      }

                      const isNew = new Date().getTime() - new Date(e.created_at).getTime() < 5 * 60 * 1000;

                      return (
                        <tr
                          key={e.id}
                          className={cn(
                            "border-b border-border last:border-0 transition-colors relative",
                            isNew ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                          )}
                        >
                          <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap relative">
                            {isNew && (
                              <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary shadow-[0_0_8px_var(--primary)]" />
                            )}
                            <div className="flex items-center gap-2">
                              {displayDate}
                              {isNew && (
                                <span className="text-[9px] font-bold uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded animate-pulse">
                                  New
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium text-foreground">
                             <div className="flex items-center gap-1.5 max-w-[220px]">
                               <span className="truncate" title={cleanVendor}>{cleanVendor}</span>
                               {potentialDuplicates.has(e.id) && (
                                 <button
                                   onClick={() => setResolvingDuplicate(e)}
                                   className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500 hover:text-[#0E1629] transition-all cursor-pointer animate-pulse shrink-0"
                                   title="Duplicate detected. Click to resolve double-billing!"
                                 >
                                   ⚠ Resolve Duplicate
                                 </button>
                               )}
                             </div>
                           </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span
                              className={cn(
                                "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold tracking-wide",
                                displayMainCategory === "Business"
                                  ? "bg-primary/10 text-primary border border-primary/20"
                                  : "bg-secondary text-secondary-foreground border border-secondary-foreground/10"
                              )}
                            >
                              {displayMainCategory}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-muted text-primary border border-primary/20 text-xs font-bold">
                              {displayCompanyEntity}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-foreground/90 font-medium text-xs bg-muted/30 px-2 py-1 rounded">
                              {displayExpenseCategory}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground whitespace-nowrap">
                            {formatCurrency(converted, displayCurrency)}
                            {e.currency !== displayCurrency && (
                              <div className="text-[10px] font-normal text-muted-foreground">
                                {formatCurrency(Number(e.amount), e.currency)}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </main>

      <Toaster />

      {/* ══ SMART DUPLICATE RESOLUTION MODAL ════════════════════ */}
      {resolvingDuplicate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md transition-all duration-300">
          <div className="relative w-full max-w-md overflow-hidden card-luxury border border-border bg-card/95 rounded-2xl p-6 text-foreground space-y-6">
            <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-bl-full pointer-events-none" />
            
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <span className="text-2xl">🛡</span>
              <div>
                <h3 className="text-base font-bold text-amber-500 tracking-tight">Smart Duplicate Detector</h3>
                <span className="text-[10px] text-muted-foreground font-mono">1-Click Reconciliation Engine</span>
              </div>
            </div>

            <div className="space-y-3.5 text-xs leading-relaxed text-muted-foreground">
              <p>
                We detected potential double-billing in your transaction stream for <strong className="text-foreground">{cleanVendorName(resolvingDuplicate.vendor || "")}</strong> on <strong className="text-foreground">{resolvingDuplicate.date || resolvingDuplicate.created_at.slice(0, 10)}</strong>.
              </p>
              <div className="p-3 bg-muted/40 rounded-xl border border-border space-y-2">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground">Vendor:</span>
                  <span className="font-bold text-foreground">{cleanVendorName(resolvingDuplicate.vendor || "")}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground">Amount:</span>
                  <span className="font-bold text-amber-500">{formatCurrency(resolvingDuplicate.amount, resolvingDuplicate.currency)}</span>
                </div>
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-muted-foreground">Date:</span>
                  <span className="font-bold text-foreground">{resolvingDuplicate.date || resolvingDuplicate.created_at.slice(0, 10)}</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Merging will keep exactly one of these entries as audited, and securely delete the duplicate clone from the live database ledger.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <button
                onClick={() => handleResolveDuplicate(resolvingDuplicate)}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-xl bg-amber-500 text-primary-foreground hover:bg-amber-600 transition-all cursor-pointer shadow-[0_4px_12px_rgba(245,158,11,0.2)]"
              >
                Resolve & Merge
              </button>
              <button
                onClick={() => setResolvingDuplicate(null)}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-xl border border-border bg-secondary hover:bg-secondary/80 text-secondary-foreground transition-all cursor-pointer"
              >
                Keep Both Entries
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ DYNAMIC AI EXPENSE COPILOT CHAT ═════════════════════ */}
      <ExpenseCopilot expenses={expenses} />
    </div>
  );
}

function ExpenseCopilot({ expenses }: { expenses: Expense[] }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  const renderMessageText = (text: string) => {
    // Split by ** for bold, * for italic
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={i} className="font-extrabold text-primary">
            {part.slice(2, -2)}
          </strong>
        );
      }
      if (part.startsWith("*") && part.endsWith("*")) {
        return (
          <em key={i} className="italic text-muted-foreground font-semibold">
            {part.slice(1, -1)}
          </em>
        );
      }
      return part;
    });
  };
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    {
      role: "assistant",
      text: "Hello! I am your glassmorphic FinStream Copilot 🤖. I can dynamically audit your active corporate ledger, check Indian Financial Year subsidiary budgets, or highlight double-billing anomalies. Ask me anything!"
    }
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  const handleSend = (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query) return;

    if (!textToSend) setInput("");

    // Add user message
    const newMessages = [...messages, { role: "user" as const, text: query }];
    setMessages(newMessages);

    // Simulate thinking
    setTimeout(() => {
      let reply = "";
      const lower = query.toLowerCase();

      // Month Name Mapping
      const MONTH_MAP: Record<string, number> = {
        january: 0, jan: 0,
        february: 1, feb: 1,
        march: 2, mar: 2,
        april: 3, apr: 3,
        may: 4,
        june: 5, jun: 5,
        july: 6, jul: 6,
        august: 7, aug: 7,
        september: 8, sep: 8,
        october: 9, oct: 9,
        november: 10, nov: 10,
        december: 11, dec: 11
      };

      // 1. Detect Month
      let targetMonthNum: number | null = null;
      let targetMonthName = "";
      for (const key of Object.keys(MONTH_MAP)) {
        const regex = new RegExp(`\\b${key}\\b`, "i");
        if (regex.test(lower)) {
          targetMonthNum = MONTH_MAP[key];
          const fullMonthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
          ];
          targetMonthName = fullMonthNames[targetMonthNum];
          break;
        }
      }

      // 1.5 Detect Year
      let targetYear: number | null = null;
      const yearMatch = query.match(/\b(202\d)\b/);
      if (yearMatch) {
        targetYear = parseInt(yearMatch[1], 10);
      }

      // 2. Detect Category
      let targetCategory: string | null = null;
      const commonCategories = ["travel", "website", "repair", "maintenance", "telecom", "marketing", "advertising", "material", "food", "office", "personal", "business"];
      for (const cat of commonCategories) {
        const regex = new RegExp(`\\b${cat}\\b`, "i");
        if (regex.test(lower)) {
          targetCategory = cat;
          break;
        }
      }
      
      const dynamicCategories = Array.from(new Set(expenses.map(e => normalizeCategory(e.expense_category || e.category || "").toLowerCase()))).filter(Boolean);
      for (const cat of dynamicCategories) {
        if (cat.length > 2 && lower.includes(cat)) {
          targetCategory = cat;
          break;
        }
      }

      // 3. Detect Vendor
      let targetVendor: string | null = null;
      const dynamicVendors = Array.from(new Set(expenses.map(e => (e.vendor || "").toLowerCase()))).filter(Boolean);
      for (const vend of dynamicVendors) {
        if (vend.length > 2 && lower.includes(vend)) {
          targetVendor = vend;
          break;
        }
      }

      // Avoid conflict if the matched vendor name is identical to or contains the category name (e.g. "travel" matching category and a vendor containing "travel")
      if (targetVendor && targetCategory) {
        const v = targetVendor.toLowerCase();
        const c = targetCategory.toLowerCase();
        if (v === c || v.includes(c) || c.includes(v)) {
          targetVendor = null;
        }
      }

      // 3.5 Detect Entity
      let targetEntity: string | null = null;
      const entityOptions = ["KS", "TI", "CPM", "AAS", "Swati", "Others", "None"];
      for (const ent of entityOptions) {
        const regex = new RegExp(`\\b${ent}\\b`, "i");
        if (regex.test(lower)) {
          targetEntity = ent;
          break;
        }
      }

      // Pre-compute basic DB stats
      const totalCount = expenses.length;
      const totalAmount = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
      const uniqueVendors = Array.from(new Set(expenses.map(e => cleanVendorName(e.vendor || "")))).filter(Boolean);
      const uniqueExpenseCategories = Array.from(new Set(expenses.map(e => normalizeCategory(e.expense_category || e.category || "Other")))).filter(Boolean);
      const uniqueEntities = Array.from(new Set(expenses.map(e => e.company_entity || "None"))).filter(Boolean);

      let firstDate = "N/A";
      let lastDate = "N/A";
      if (expenses.length > 0) {
        const sortedDates = expenses
          .map(e => new Date(e.date || e.created_at))
          .filter(d => !isNaN(d.getTime()))
          .sort((a, b) => a.getTime() - b.getTime());
        if (sortedDates.length > 0) {
          firstDate = format(sortedDates[0], "dd-MMM-yy");
          lastDate = format(sortedDates[sortedDates.length - 1], "dd-MMM-yy");
        }
      }

      // Check if query is asking for specific analytical commands
      if (lower.includes("how many") || lower.includes("count") || lower.includes("number of transaction") || lower.includes("total transaction") || lower.includes("volume")) {
        reply = `📊 **Ledger Transaction Volume:**\n\nYou currently have **${totalCount} active transactions** logged in your database ledger.\n\nThese records span from **${firstDate}** to **${lastDate}**.`;
      } else if (lower.includes("vendor") || lower.includes("who do i pay") || lower.includes("who are my vendors") || lower.includes("list of vendors")) {
        reply = `🏢 **Active Corporate Vendors:**\n\nYour ledger database contains **${uniqueVendors.length} unique vendors**. Here are some of your top billed vendors:\n\n${uniqueVendors.slice(0, 10).map(v => `• ${v}`).join("\n")}\n\n💡 Try asking me about a specific vendor (e.g. *"${uniqueVendors[0] || "Amazon"}"*) to filter their exact expenses!`;
      } else if (lower.includes("category") || lower.includes("categories") || lower.includes("what do i spend on") || lower.includes("list of categories")) {
        reply = `🏷️ **Active Spending Categories:**\n\nYour ledger database tracks **${uniqueExpenseCategories.length} unique expense categories**. Here is the list:\n\n${uniqueExpenseCategories.slice(0, 15).map(c => `• ${c}`).join("\n")}\n\n💡 Try asking me about a specific category (e.g. *"${uniqueExpenseCategories[0] || "Travel"}"*) to filter its outflow!`;
      } else if (lower.includes("highest") || lower.includes("largest") || lower.includes("most expensive") || lower.includes("max spend") || lower.includes("biggest") || lower.includes("maximum")) {
        if (expenses.length === 0) {
          reply = `💰 **Largest Single Transaction Outflow:**\n\nNo transactions logged in the database yet.`;
        } else {
          const highestTx = expenses.reduce((prev, curr) => (Number(prev.amount) > Number(curr.amount)) ? prev : curr);
          const dateStr = highestTx.date || highestTx.created_at.slice(0, 10);
          let displayDate = dateStr;
          try {
            const d = new Date(dateStr);
            if (!isNaN(d.getTime())) displayDate = format(d, "dd-MMM-yy");
          } catch {}
          reply = `💰 **Largest Single Transaction Outflow:**\n\nThe most expensive transaction recorded in your database is **₹${highestTx.amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}** billed by **${cleanVendorName(highestTx.vendor || "")}** on **${displayDate}** (Category: ${normalizeCategory(highestTx.expense_category || highestTx.category || "Other")}).`;
        }
      } else if (lower.includes("average") || lower.includes("avg") || lower.includes("mean")) {
        const avg = totalCount > 0 ? totalAmount / totalCount : 0;
        reply = `📊 **Average Transaction Size:**\n\nAcross all **${totalCount} entries** in your ledger, the average transaction size is **₹${avg.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**.`;
      } else if (
        (targetMonthNum !== null || targetYear !== null || targetCategory !== null || targetVendor !== null || targetEntity !== null) &&
        !lower.includes("budget") && !lower.includes("limit") && !lower.includes("actual")
      ) {
        // Run Dynamic Filter Query
        let filtered = [...expenses];
        const filterDesc: string[] = [];

        if (targetMonthNum !== null) {
          filtered = filtered.filter((e) => {
            const d = e.date ? new Date(e.date) : new Date(e.created_at);
            if (isNaN(d.getTime())) return false;
            const matchesMonth = d.getMonth() === targetMonthNum;
            const matchesYear = targetYear !== null ? d.getFullYear() === targetYear : true;
            return matchesMonth && matchesYear;
          });
          filterDesc.push(`in **${targetMonthName}${targetYear !== null ? ` ${targetYear}` : ""}**`);
        } else if (targetYear !== null) {
          filtered = filtered.filter((e) => {
            const d = e.date ? new Date(e.date) : new Date(e.created_at);
            return !isNaN(d.getTime()) && d.getFullYear() === targetYear;
          });
          filterDesc.push(`in **${targetYear}**`);
        }

        if (targetCategory !== null) {
          filtered = filtered.filter((e) => {
            const ec = (e.expense_category || "").toLowerCase();
            const c = (e.category || "").toLowerCase();
            const mc = (e.main_category || "").toLowerCase();
            return ec.includes(targetCategory!) || c.includes(targetCategory!) || mc.includes(targetCategory!);
          });
          const displayCat = targetCategory.charAt(0).toUpperCase() + targetCategory.slice(1);
          filterDesc.push(`categorized as **${displayCat}**`);
        }

        if (targetVendor !== null) {
          filtered = filtered.filter((e) => {
            return (e.vendor || "").toLowerCase().includes(targetVendor!);
          });
          filterDesc.push(`billed by **${cleanVendorName(targetVendor)}**`);
        }

        if (targetEntity !== null) {
          filtered = filtered.filter((e) => {
            const ce = (e.company_entity || "").toLowerCase();
            return ce === targetEntity!.toLowerCase();
          });
          filterDesc.push(`associated with entity **${targetEntity}**`);
        }

        const totalSpent = filtered.reduce((sum, e) => sum + Number(e.amount), 0);
        
        reply = `✨ **Dynamic Ledger Filter Query:**\n\n`;
        reply += `I filtered your active transaction ledger for entries ${filterDesc.join(" and ")}:\n\n`;
        
        if (filtered.length === 0) {
          reply += `• Total Outflow: **₹0.00**\n`;
          reply += `• Transaction Count: **0 entries**\n\n`;
          reply += `No matching transactions were found for this criteria in the database ledger.`;
        } else {
          reply += `• Total Outflow: **₹${totalSpent.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}**\n`;
          reply += `• Transaction Count: **${filtered.length} ${filtered.length === 1 ? "entry" : "entries"}**\n\n`;
          reply += `**Matching transactions (showing up to 5):**\n`;
          filtered.slice(0, 5).forEach((e) => {
            const dateStr = e.date || e.created_at.slice(0, 10);
            let displayDate = dateStr;
            try {
              const d = new Date(dateStr);
              if (!isNaN(d.getTime())) {
                displayDate = format(d, "dd-MMM-yy");
              }
            } catch {}
            
            reply += `• **${cleanVendorName(e.vendor || "Expense")}**: ₹${Number(e.amount).toLocaleString("en-IN")} on *${displayDate}* (${normalizeCategory(e.expense_category || e.category || "Other")})\n`;
          });
        }
      } else if (lower.includes("total spend") || lower.includes("how much spent") || lower.includes("net outflow") || lower.includes("total expenses") || lower.includes("entire spend") || lower.includes("net spent") || lower.includes("outflow sum")) {
        reply = `💵 **Aggregated Ledger Outflow:**\n\nYour total net outflow across all recorded transactions is **₹${totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}** across **${totalCount} entries**.`;
      } else if (lower.includes("budget") || lower.includes("limit") || lower.includes("actual")) {
        // Calculate category spent dynamically from active expenses
        const catSpent: Record<string, number> = {};
        expenses.forEach((e) => {
          if (e.expense_category) {
            const cat = normalizeCategory(e.expense_category);
            catSpent[cat] = (catSpent[cat] || 0) + Number(e.amount);
          }
        });
        
        reply = "📊 **Dynamic Category Budget Audit:**\n\n";
        const keys = Object.keys(catSpent);
        if (keys.length === 0) {
          reply += "No category spend recorded yet. Create an expense to track category limits!";
        } else {
          reply += "Here is your active category spent:\n";
          keys.slice(0, 5).forEach((k) => {
            const spentVal = catSpent[k];
            // Match standard limits
            let limit = 50000;
            if (k.toLowerCase().includes("material")) limit = 5000000;
            else if (k.toLowerCase().includes("telecom")) limit = 20000;
            else if (k.toLowerCase().includes("travel")) limit = 50000;
            else if (k.toLowerCase().includes("website")) limit = 25000;
            else if (k.toLowerCase().includes("repair")) limit = 50000;

            const pct = (spentVal / limit) * 100;
            reply += `• **${k}**: ₹${spentVal.toLocaleString("en-IN")} spent of ₹${limit.toLocaleString("en-IN")} (${pct.toFixed(0)}% utilization) ${pct >= 100 ? "🚨 *Over Limit!*" : pct >= 70 ? "⚠ *At Risk!*" : "✅ *Safe*"}\n`;
          });
        }
      } else if (lower.includes("duplicate") || lower.includes("double-bill") || lower.includes("same")) {
        // Run duplicate detection algorithm in real-time
        const seen = new Map<string, Expense>();
        const duplicates: Array<[Expense, Expense]> = [];
        
        expenses.forEach((e) => {
          const vendor = cleanVendorName(e.vendor || "").toLowerCase();
          const amount = Number(e.amount);
          const date = e.date || e.created_at.slice(0, 10);
          const key = `${vendor}-${amount}-${date}`;
          
          if (seen.has(key)) {
            duplicates.push([seen.get(key)!, e]);
          } else {
            seen.set(key, e);
          }
        });

        reply = "🛡 **Smart Duplicate Detection Summary:**\n\n";
        if (duplicates.length === 0) {
          reply += "Excellent! I scanned all transactions in the ledger and found **0 double-billing anomalies**.";
        } else {
          reply += `I flagged **${duplicates.length} potential duplicate transactions** in the active ledger:\n\n`;
          duplicates.slice(0, 3).forEach(([e1, e2]) => {
            reply += `• **${cleanVendorName(e1.vendor || "Expense")}**: Two identical transactions of **₹${e1.amount.toLocaleString("en-IN")}** logged on **${e1.date || "May 23rd, 2026"}**.\n`;
          });
          reply += "\n💡 You can use the **1-click 'Resolve'** warning badge directly inside the Ledger list to instantly merge them!";
        }
      } else if (lower.includes("subsidiary") || lower.includes("entity") || lower.includes("company") || lower.includes("ks") || lower.includes("cpm") || lower.includes("ti")) {
        // Calculate subsidiary spend
        const entitySpent: Record<string, number> = {};
        expenses.forEach((e) => {
          const ent = e.company_entity || "None";
          entitySpent[ent] = (entitySpent[ent] || 0) + Number(e.amount);
        });

        reply = "🏢 **Subsidiary Multi-Entity Outflow Audit:**\n\n";
        const keys = Object.keys(entitySpent);
        if (keys.length === 0) {
          reply += "No subsidiary spending logged yet.";
        } else {
          reply += "Active corporate entity outflows computed in display currency:\n";
          keys.forEach((k) => {
            reply += `• **${k}**: ₹${entitySpent[k].toLocaleString("en-IN", { maximumFractionDigits: 2 })}\n`;
          });
          const maxEnt = keys.reduce((a, b) => entitySpent[a] > entitySpent[b] ? a : b);
          reply += `\n**${maxEnt}** is currently your top-outflow subsidiary.`;
        }
      } else if (lower.includes("anomaly") || lower.includes("spike") || lower.includes("large")) {
        // Find high value transactions
        const spikes = expenses.filter((e) => Number(e.amount) >= 50000);
        
        reply = "🚨 **Ledger Anomaly Detection:**\n\n";
        if (spikes.length === 0) {
          reply += "Verified! I scanned the ledger and found **no anomalous spending spikes** above the ₹50,000 threshold.";
        } else {
          reply += `Flagged **${spikes.length} high-value single transactions** representing potential outflow spikes:\n\n`;
          spikes.slice(0, 3).forEach((e) => {
            reply += `• **${cleanVendorName(e.vendor || "Expense")}**: ₹${Number(e.amount).toLocaleString("en-IN")} on **${e.date || "May 23rd"}** (Category: ${normalizeCategory(e.expense_category || e.category || "Other")})\n`;
          });
        }
      } else {
        reply = "🤖 **FinStream Copilot Assistant:**\n\nI can dynamically audit your active multi-entity ledger records. Try asking me one of these queries or typing a custom question:\n\n• *\"Am I close to my budgets?\"* (Scans category limits)\n• *\"Where are my duplicates?\"* (Scans double-billing anomalies)\n• *\"Show me subsidiary spend\"* (Calculates KS/TI/CPM subsidiaries)\n• *\"Check for anomalies\"* (Locates large spending spikes)";
      }

      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    }, 800);
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
      {/* collapsible widget card */}
      {open && (
        <div className="w-80 sm:w-96 h-[460px] card-luxury backdrop-blur-md rounded-2xl shadow-2xl flex flex-col overflow-hidden mb-4 animate-in slide-in-from-bottom-5 duration-300">
          {/* header */}
          <div className="bg-muted/60 border-b border-border px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xl">🤖</span>
              <div>
                <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">FinStream Copilot</h3>
                <span className="text-[9px] text-primary/90 font-mono">Dynamic AI Ledger Agent</span>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground text-xs p-1 cursor-pointer">
              ✕
            </button>
          </div>

          {/* scrollable conversation block */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
            {messages.map((m, idx) => (
              <div key={idx} className={cn("flex flex-col max-w-[80%]", m.role === "user" ? "self-end items-end" : "self-start items-start")}>
                <span className="text-[9px] text-muted-foreground uppercase tracking-wider mb-1 font-bold">
                  {m.role === "user" ? "You" : "FinStream AI"}
                </span>
                <div className={cn("rounded-2xl px-3.5 py-2.5 whitespace-pre-line leading-relaxed shadow-sm", m.role === "user" ? "bg-primary text-primary-foreground font-semibold rounded-tr-none" : "bg-muted/50 border border-border text-foreground rounded-tl-none")}>
                  {renderMessageText(m.text)}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* quick suggestion buttons */}
          <div className="px-4 py-2 border-t border-border bg-muted/20 flex gap-1.5 overflow-x-auto shrink-0 select-none">
            <button onClick={() => handleSend("Am I close to my budgets?")} className="px-2.5 py-1 text-[9px] font-bold rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 shrink-0 cursor-pointer">
              📊 Check Budgets
            </button>
            <button onClick={() => handleSend("Where are my duplicates?")} className="px-2.5 py-1 text-[9px] font-bold rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 shrink-0 cursor-pointer">
              🛡 Find Duplicates
            </button>
            <button onClick={() => handleSend("Show me subsidiary spend")} className="px-2.5 py-1 text-[9px] font-bold rounded-full bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 shrink-0 cursor-pointer">
              🏢 Entity Breakdown
            </button>
          </div>

          {/* input form */}
          <div className="p-3 bg-muted/60 border-t border-border flex gap-2">
            <input
              type="text"
              placeholder="Ask Copilot anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSend();
              }}
              className="flex-1 h-8 text-xs bg-background border border-border rounded-lg px-2.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary placeholder-muted-foreground"
            />
            <button onClick={() => handleSend()} className="h-8 px-3 text-xs bg-primary text-primary-foreground font-bold rounded-lg hover:bg-primary/95 transition cursor-pointer">
              Send
            </button>
          </div>
        </div>
      )}

      {/* dynamic trigger bubble */}
      <button
        onClick={() => setOpen(!open)}
        className="w-12 h-12 bg-primary rounded-full shadow-[0_4px_20px_rgba(212,175,55,0.4)] hover:shadow-[0_4px_24px_rgba(212,175,55,0.6)] flex items-center justify-center hover:scale-110 transition-all duration-300 animate-bounce cursor-pointer relative"
        title="Ask FinStream Copilot"
      >
        <span className="text-xl">🤖</span>
        {!open && (
          <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-background flex items-center justify-center animate-pulse" />
        )}
      </button>
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  currency,
  tone,
  count,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  currency: string;
  tone: "default" | "primary" | "muted";
  count: number;
}) {
  const accent =
    tone === "primary"
      ? "bg-primary/10 text-primary border border-primary/20"
      : tone === "muted"
        ? "bg-[var(--rose-copper)]/15 text-[var(--rose-copper)]"
        : "bg-[var(--crystal-teal)]/15 text-[var(--crystal-teal-deep)]";

  const formatted = formatCurrency(value, currency);
  const match = formatted.match(/^([^\d\-]*)(.*)$/);
  const symbol = match?.[1] ?? "";
  const rest = match?.[2] ?? formatted;

  return (
    <div className="card-luxury rounded-xl p-5 hover:scale-[1.02] hover:shadow-[0_0_15px_rgba(212,175,55,0.15)] hover:border-[var(--rose-copper)]/30 border border-transparent transition-all duration-300 ease-out relative overflow-hidden group">
      {/* Dynamic Gold Ambient hover background shine */}
      <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-[rgba(212,175,55,0.02)] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />
      
      <div className="flex items-center justify-between relative z-10">
        <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/20 border border-white/5 text-muted-foreground">
            {count} {count === 1 ? "entry" : "entries"}
          </span>
          <div className={`w-8 h-8 rounded-md flex items-center justify-center ${accent}`}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </div>
      
      <div className="mt-4 text-3xl font-extrabold tracking-tight text-foreground tabular-nums relative z-10">
        <span className="text-primary mr-0.5">{symbol}</span>{rest}
      </div>
    </div>
  );
}
