import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Loader2,
  Inbox,
  TrendingUp,
  Calendar,
  ArrowUpRight,
  DollarSign,
  PieChart as PieIcon,
  Search,
  SlidersHorizontal,
  CalendarDays,
  Brain,
  AlertTriangle,
  Building2,
  Target,
  Download,
  Scale,
} from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { formatCurrency } from "@/lib/currency";
import { convertAmount } from "@/lib/fx";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, classifyExpense, parseDescriptionDetails, resolveEntityFromVendor, normalizeCategory, cleanVendorName } from "@/lib/utils";

function MarkdownRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-4 text-[13px] md:text-sm text-foreground/90 leading-relaxed font-sans relative z-10">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("###")) {
          return (
            <h4 key={i} className="text-xs md:text-sm font-extrabold text-primary uppercase tracking-widest mt-2 mb-3 flex items-center gap-1.5 border-b border-primary/20 pb-2 w-fit">
              {trimmed.replace(/^###\s*/, "")}
            </h4>
          );
        }
        if (trimmed.startsWith("*")) {
          const content = trimmed.replace(/^\*\s*/, "");
          const parts = content.split(/\*\*(.*?)\*\*/);
          return (
            <div key={i} className="flex items-start gap-3 pl-0.5 my-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0 shadow-[0_0_8px_rgba(212,175,55,0.7)]" />
              <p className="flex-1 text-foreground/90 font-medium">
                {parts.map((part, idx) => {
                  if (idx % 2 === 1) {
                    return <strong key={idx} className="font-extrabold text-foreground pr-0.5">{part}</strong>;
                  }
                  const italicParts = part.split(/\*(.*?)\*/);
                  return italicParts.map((ip, iidx) => {
                    if (iidx % 2 === 1) {
                      return (
                        <span key={iidx} className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/10 dark:bg-amber-500/20 border border-amber-500/35 text-amber-850 dark:text-amber-300 italic mx-0.5 shadow-sm leading-tight">
                          {ip}
                        </span>
                      );
                    }
                    return ip;
                  });
                })}
              </p>
            </div>
          );
        }
        if (trimmed === "") {
          return null;
        }
        return <p key={i} className="text-foreground/80">{line}</p>;
      })}
    </div>
  );
}

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports — FinStream" }] }),
});

interface Row {
  amount: number;
  currency: string;
  category: string;
  created_at: string;
  date?: string;
  expense_category?: string;
  vendor?: string;
  raw_text?: string;
  company_entity?: string;
  main_category?: string;
}

type Timeframe = "Day" | "Week" | "Month" | "Quarter" | "Year";
type DistributionMode = "category" | "entity" | "type";

const PIE_COLORS = [
  "#D4AF37",
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#6B7280",
];

/** Monthly budget limits in INR — update to match actual targets */
const DEFAULT_CATEGORY_BUDGETS: Record<string, number> = {
  "Raw Material":              5_000_000, // ₹50 L
  "Labour & Wages":              200_000, // ₹2 L
  "Electricity & Power":         150_000, // ₹1.5 L
  "Water":                        30_000, // ₹30 K
  "Repairs & Maintenance":        50_000, // ₹50 K
  "Goods Carriage & Transport":   80_000, // ₹80 K
  "Factory-Related Expenses":     40_000, // ₹40 K
  
  "Travel & Logistics":           50_000, // ₹50 K
  "Salaries & Admin":            120_000, // ₹1.2 L
  "Marketing & Ads":              75_000, // ₹75 K
  "Software & Tech":              25_000, // ₹25 K
  "General Overhead":             30_000, // ₹30 K
  "Professional & Legal":         50_000, // ₹50 K
  "Rent & Facilities":           100_000, // ₹1 L
  "Taxes & Compliance":           40_000, // ₹40 K
  "Investment & Other Assets":    50_000, // ₹50 K
  "Other Indirect":               20_000, // ₹20 K
};

/** Compact axis tick formatter — shows ₹2.5L / ₹10K instead of full currency strings */
function compactTick(v: number, currency: string): string {
  const sym =
    currency === "USD" ? "$" :
    currency === "EUR" ? "€" :
    currency === "GBP" ? "£" :
    "₹";

  if (currency === "INR") {
    if (v >= 10_000_000) return `₹${(v / 10_000_000).toFixed(1)}Cr`;
    if (v >= 100_000)    return `₹${(v / 100_000).toFixed(1)}L`;
    if (v >= 1_000)      return `₹${(v / 1_000).toFixed(0)}K`;
    return `₹${v.toFixed(0)}`;
  }
  if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${sym}${(v / 1_000).toFixed(0)}K`;
  return `${sym}${v.toFixed(0)}`;
}

function ReportsPage() {
  const { user } = useAuth();
  const { currency: displayCurrency, ratesVersion } = useCurrency();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<Timeframe>("Month");
  const [distributionView, setDistributionView] = useState<"bar" | "pie">("pie");
  const [distributionMode, setDistributionMode] = useState<DistributionMode>("category");
  const [selectedDrilldown, setSelectedDrilldown] = useState<string>("");
  const [drilldownSearch, setDrilldownSearch] = useState<string>("");
  const [compareUnit, setCompareUnit] = useState<"Yearly" | "Quarterly">("Quarterly");
  const [selectedCompareCategories, setSelectedCompareCategories] = useState<string[]>([]);
  const [budgetInterval, setBudgetInterval] = useState<"Monthly" | "Quarterly" | "Yearly">("Monthly");
  const [showAllBudgets, setShowAllBudgets] = useState(false);
  const [selectedCostEntities, setSelectedCostEntities] = useState<string[]>([]);
  const [expandedDirectGroup, setExpandedDirectGroup] = useState<string | null>(null);
  const [expandedIndirectGroup, setExpandedIndirectGroup] = useState<string | null>(null);

  // Universal period selection
  const [selectedPeriod, setSelectedPeriod] = useState<string>("CY 2026");
  const [customFromDate, setCustomFromDate] = useState<string>("");
  const [customToDate, setCustomToDate] = useState<string>("");

  // Dynamic Budget Tracking States (restored from localStorage if present)
  const [trackedCategories, setTrackedCategories] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("finstream_tracked_categories");
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as string[];
          const normalized = parsed.map(c => normalizeCategory(c));
          return Array.from(new Set(normalized));
        } catch (e) {
          // ignore
        }
      }
    }
    return [
      "Raw Material",
      "Labour & Wages",
      "Electricity & Power",
      "Repairs & Maintenance",
      "Software & Tech",
      "General Overhead"
    ];
  });

  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("finstream_category_budgets");
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Record<string, number>;
          const normalized: Record<string, number> = {};
          for (const [k, v] of Object.entries(parsed)) {
            const normKey = normalizeCategory(k);
            normalized[normKey] = v;
          }
          return normalized;
        } catch (e) {
          // ignore
        }
      }
    }
    return DEFAULT_CATEGORY_BUDGETS;
  });
  
  // Inline editing state for budget limits
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  // Synchronise budget changes back to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("finstream_tracked_categories", JSON.stringify(trackedCategories));
    }
  }, [trackedCategories]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("finstream_category_budgets", JSON.stringify(categoryBudgets));
    }
  }, [categoryBudgets]);

  // Unique categories found across all ledger rows in Supabase
  const allDbCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.expense_category) {
        set.add(normalizeCategory(r.expense_category));
      }
    }
    // Include default categories as base
    set.add("Raw Material");
    set.add("Telecommunication");
    set.add("Travel");
    set.add("Website");
    set.add("Repairs & Maintenance");
    set.add("Other expenses");
    return Array.from(set).sort();
  }, [rows]);



  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await supabase
          .from("expenses")
          .select(
            "amount,currency,category,created_at,date,expense_category,vendor,raw_text,company_entity,main_category"
          );
        
        const enriched = (data ?? []).map((r) => {
          let ent = r.company_entity;
          if (!ent || ent === "None" || ent === "NONE") {
            ent = resolveEntityFromVendor(r.vendor, r.raw_text);
          }
          return {
            ...r,
            company_entity: ent,
          };
        });

        setRows(enriched as Row[]);
      } catch (err) {
        console.error("Error loading expenses for reports:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  /** Use invoice date when available so historical bills appear in the right period */
  const effectiveDate = (r: Row) => r.date || r.created_at;

  const periodFilteredRows = useMemo(() => {
    return rows.filter((r) => {
      const expDate = new Date(effectiveDate(r));
      if (isNaN(expDate.getTime())) return true; // fallback

      if (selectedPeriod === "FY 2026-27") {
        // Apr 1, 2026 to Mar 31, 2027
        const start = new Date("2026-04-01T00:00:00");
        const end = new Date("2027-03-31T23:59:59");
        return expDate >= start && expDate <= end;
      }
      if (selectedPeriod === "FY 2025-26") {
        // Apr 1, 2025 to Mar 31, 2026
        const start = new Date("2025-04-01T00:00:00");
        const end = new Date("2026-03-31T23:59:59");
        return expDate >= start && expDate <= end;
      }
      if (selectedPeriod === "CY 2026") {
        // Jan 1, 2026 to Dec 31, 2026
        const start = new Date("2026-01-01T00:00:00");
        const end = new Date("2026-12-31T23:59:59");
        return expDate >= start && expDate <= end;
      }
      if (selectedPeriod === "CY 2025") {
        // Jan 1, 2025 to Dec 31, 2025
        const start = new Date("2025-01-01T00:00:00");
        const end = new Date("2025-12-31T23:59:59");
        return expDate >= start && expDate <= end;
      }
      if (selectedPeriod === "custom") {
        const start = customFromDate ? new Date(`${customFromDate}T00:00:00`) : null;
        const end = customToDate ? new Date(`${customToDate}T23:59:59`) : null;
        if (start && end) return expDate >= start && expDate <= end;
        if (start) return expDate >= start;
        if (end) return expDate <= end;
        return true;
      }
      if (selectedPeriod.startsWith("month-")) {
        const parts = selectedPeriod.replace("month-", "").split("-");
        const yr = parseInt(parts[0], 10);
        const mo = parseInt(parts[1], 10);
        const start = new Date(yr, mo, 1, 0, 0, 0);
        const end = new Date(yr, mo + 1, 0, 23, 59, 59);
        return expDate >= start && expDate <= end;
      }
      return true; // All
    });
  }, [rows, selectedPeriod, customFromDate, customToDate]);

  const filteredRows = useMemo(() => {
    const now = new Date();
    const DAY = 86_400_000;
    return periodFilteredRows.filter((r) => {
      const d = new Date(effectiveDate(r));
      if (isNaN(d.getTime())) return false;
      const diffDays = (now.getTime() - d.getTime()) / DAY;
      if (timeframe === "Day")     return diffDays <= 1;
      if (timeframe === "Week")    return diffDays <= 7;
      if (timeframe === "Month")   return diffDays <= 30;
      if (timeframe === "Quarter") return diffDays <= 90;
      if (timeframe === "Year")    return diffDays <= 365;
      return true;
    });
  }, [periodFilteredRows, timeframe]);

  const summary = useMemo(() => {
    let total = 0, business = 0, personal = 0, investments = 0;
    let directSpend = 0, indirectSpend = 0;
    for (const r of filteredRows) {
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
      total += amt;
      if (r.category === "Business") {
        business += amt;
        const classified = classifyExpense({
          category: r.category,
          main_category: r.main_category,
          expense_category: r.expense_category,
          raw_text: r.raw_text,
          vendor: r.vendor,
        });
        if (classified.type === "Direct") {
          directSpend += amt;
        } else if (classified.type === "Indirect") {
          indirectSpend += amt;
        }
      }
      else if (r.category === "Investments") investments += amt;
      else personal += amt;
    }
    return { total, business, personal, investments, directSpend, indirectSpend, count: filteredRows.length };
  }, [filteredRows, displayCurrency, ratesVersion]);

  // ── Cost entity-filtered rows ─────────────────────────────────────────────
  const costFilteredRows = useMemo(() => {
    if (selectedCostEntities.length === 0) return filteredRows;
    return filteredRows.filter(r => {
      const ent = (r.company_entity || "None").toUpperCase();
      return selectedCostEntities.map(e => e.toUpperCase()).includes(ent);
    });
  }, [filteredRows, selectedCostEntities]);

  // Direct cost grouped breakdown (by category → list of entries)
  const directBreakdown = useMemo(() => {
    const groups: Record<string, Array<{
      vendor: string;
      materialType: string;
      rateStr: string;
      qty: string;
      gstStr: string;
      amount: number;
      rawDescription: string;
    }>> = {};

    for (const r of costFilteredRows) {
      if (r.category !== "Business") continue;
      const classified = classifyExpense({
        category: r.category,
        main_category: r.main_category,
        expense_category: r.expense_category,
        raw_text: r.raw_text,
        vendor: r.vendor,
      });
      if (classified.type !== "Direct") continue;
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
      
      const parsed = parseDescriptionDetails(r.raw_text, Number(r.amount) || 0);
      let displayGstStr = "—";
      if (parsed.gstNum !== null) {
        const convertedGst = convertAmount(parsed.gstNum, r.currency || "INR", displayCurrency, r.created_at);
        displayGstStr = formatCurrency(convertedGst, displayCurrency);
      }

      const groupKey = normalizeCategory(r.expense_category || classified.category);
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({
        vendor: r.vendor || "Unknown",
        materialType: parsed.materialType || groupKey,
        rateStr: parsed.rateStr,
        qty: parsed.qtyStr,
        gstStr: displayGstStr,
        amount: amt,
        rawDescription: r.raw_text || "",
      });
    }
    return Object.entries(groups).map(([cat, entries]) => ({
      category: cat,
      total: entries.reduce((s, e) => s + e.amount, 0),
      entries,
    })).sort((a, b) => b.total - a.total);
  }, [costFilteredRows, displayCurrency, ratesVersion]);

  // Indirect cost grouped breakdown
  const indirectBreakdown = useMemo(() => {
    const groups: Record<string, Array<{ vendor: string; description: string; amount: number }>> = {};
    for (const r of costFilteredRows) {
      if (r.category !== "Business") continue;
      const classified = classifyExpense({
        category: r.category,
        main_category: r.main_category,
        expense_category: r.expense_category,
        raw_text: r.raw_text,
        vendor: r.vendor,
      });
      if (classified.type !== "Indirect") continue;
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
      const groupKey = normalizeCategory(r.expense_category || classified.category);
      if (!groups[groupKey]) groups[groupKey] = [];
      groups[groupKey].push({
        vendor: r.vendor || "Unknown",
        description: r.raw_text || "",
        amount: amt,
      });
    }
    return Object.entries(groups).map(([cat, entries]) => ({
      category: cat,
      total: entries.reduce((s, e) => s + e.amount, 0),
      entries,
    })).sort((a, b) => b.total - a.total);
  }, [costFilteredRows, displayCurrency, ratesVersion]);

  // Entity-filtered summary for cost ratio (used in the ratio bar & benchmark)
  const costSummary = useMemo(() => {
    let business = 0, directSpend = 0, indirectSpend = 0;
    for (const r of costFilteredRows) {
      if (r.category !== "Business") continue;
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
      business += amt;
      const classified = classifyExpense({
        category: r.category,
        main_category: r.main_category,
        expense_category: r.expense_category,
        raw_text: r.raw_text,
        vendor: r.vendor,
      });
      if (classified.type === "Direct") directSpend += amt;
      else if (classified.type === "Indirect") indirectSpend += amt;
    }
    return { business, directSpend, indirectSpend };
  }, [costFilteredRows, displayCurrency, ratesVersion]);

  // ── Distribution datasets ───────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredRows) {
      const cat = normalizeCategory(r.expense_category || "Other expenses");
      map[cat] = (map[cat] || 0) + convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows, displayCurrency, ratesVersion]);

  const entityData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredRows) {
      const entity = r.company_entity || "None";
      map[entity] = (map[entity] || 0) + convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows, displayCurrency, ratesVersion]);

  const mainCatData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredRows) {
      const cat = r.main_category || r.category || "Personal";
      map[cat] = (map[cat] || 0) + convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows, displayCurrency, ratesVersion]);

  const activeDistData =
    distributionMode === "entity" ? entityData :
    distributionMode === "type"   ? mainCatData :
    categoryData;

  // ── Fiscal Calendar Helper (1st April to 31st March) ───────────────────
  const getFiscalPeriod = (interval: "Monthly" | "Quarterly" | "Yearly", refDate: Date = new Date()) => {
    const year = refDate.getFullYear();
    const month = refDate.getMonth(); // 0-indexed: 0 is Jan, 3 is Apr, etc.

    if (interval === "Monthly") {
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0, 23, 59, 59);
      const label = format(start, "MMMM yyyy");
      return { start, end, label };
    } else if (interval === "Quarterly") {
      // Q1: Apr-Jun (m 3,4,5) | Q2: Jul-Sep (m 6,7,8) | Q3: Oct-Dec (m 9,10,11) | Q4: Jan-Mar (m 0,1,2)
      let startMonth = 0;
      let fyStart = year;
      let qLabel = "";
      if (month >= 3 && month <= 5) {
        startMonth = 3;
        fyStart = year;
        qLabel = "Q1 (Apr - Jun)";
      } else if (month >= 6 && month <= 8) {
        startMonth = 6;
        fyStart = year;
        qLabel = "Q2 (Jul - Sep)";
      } else if (month >= 9 && month <= 11) {
        startMonth = 9;
        fyStart = year;
        qLabel = "Q3 (Oct - Dec)";
      } else {
        startMonth = 0;
        fyStart = year - 1;
        qLabel = "Q4 (Jan - Mar)";
      }
      const start = new Date(fyStart, startMonth, 1);
      const end = new Date(fyStart, startMonth + 3, 0, 23, 59, 59);
      const fySuffix = `${fyStart.toString().slice(-2)}-${(fyStart + 1).toString().slice(-2)}`;
      const label = `${qLabel} FY ${fySuffix}`;
      return { start, end, label };
    } else {
      // Yearly: 1st April to 31st March
      let fyStart = year;
      if (month < 3) {
        fyStart = year - 1;
      }
      const start = new Date(fyStart, 3, 1); // April 1st
      const end = new Date(fyStart + 1, 3, 0, 23, 59, 59); // March 31st
      const fySuffix = `${fyStart.toString().slice(-2)}-${(fyStart + 1).toString().slice(-2)}`;
      const label = `FY ${fySuffix} (Apr 01 - Mar 31)`;
      return { start, end, label };
    }
  };

  const currentFiscalPeriod = useMemo(() => {
    return getFiscalPeriod(budgetInterval, new Date());
  }, [budgetInterval]);

  // ── Budget vs Actual (always in INR) ───────────────────────────────────
  const budgetData = useMemo(() => {
    const spentMap: Record<string, number> = {};
    const { start, end } = currentFiscalPeriod;

    const budgetRows = rows.filter((r) => {
      const d = new Date(effectiveDate(r));
      if (isNaN(d.getTime())) return false;
      return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
    });

    for (const r of budgetRows) {
      const cat = normalizeCategory(r.expense_category);
      spentMap[cat] = (spentMap[cat] || 0) +
        convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at);
    }

    const scale = 
      budgetInterval === "Monthly" ? 1 :
      budgetInterval === "Quarterly" ? 3 :
      12;

    return trackedCategories.map((cat) => {
      const baseBudget = categoryBudgets[cat] ?? 50_000; // default ₹50 K fallback base limit
      const budget = baseBudget * scale;
      const spent = spentMap[cat] || 0;
      const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
      return { cat, budget, spent, pct, overBudget: spent > budget };
    });
  }, [rows, budgetInterval, currentFiscalPeriod, trackedCategories, categoryBudgets]);

  const sortedBudgets = useMemo(() => {
    return [...budgetData].sort((a, b) => b.pct - a.pct);
  }, [budgetData]);

  const visibleBudgets = showAllBudgets ? sortedBudgets : sortedBudgets.slice(0, 5);

  // ── Anomaly detection ──────────────────────────────────────────────────
  const anomalyData = useMemo(() => {
    let largestTx: Row | null = null;
    let largestAmt = 0;
    const vendorCount: Record<string, number> = {};
    const catINR: Record<string, number> = {};

    for (const r of filteredRows) {
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at);
      if (amt > largestAmt) { largestAmt = amt; largestTx = r; }
      vendorCount[r.vendor || "Unknown"] = (vendorCount[r.vendor || "Unknown"] || 0) + 1;
      const cat = normalizeCategory(r.expense_category || "Other expenses");
      catINR[cat] = (catINR[cat] || 0) + amt;
    }

    // Prior same-length window for MoM comparison
    const now = new Date();
    const DAY = 86_400_000;
    const windowMs =
      timeframe === "Day" ? DAY :
      timeframe === "Week" ? 7 * DAY :
      timeframe === "Month" ? 30 * DAY :
      timeframe === "Quarter" ? 90 * DAY :
      365 * DAY;

    const priorCatINR: Record<string, number> = {};
    for (const r of rows) {
      const d = new Date(effectiveDate(r));
      const diff = now.getTime() - d.getTime();
      if (diff > windowMs && diff <= windowMs * 2) {
        const cat = normalizeCategory(r.expense_category || "Other expenses");
        priorCatINR[cat] = (priorCatINR[cat] || 0) +
          convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at);
      }
    }

    let fastestCat = "";
    let fastestGrowth = -Infinity;
    for (const [cat, amt] of Object.entries(catINR)) {
      const prior = priorCatINR[cat] || 0;
      const growth = prior > 0 ? ((amt - prior) / prior) * 100 : amt > 0 ? 999 : 0;
      if (growth > fastestGrowth) { fastestGrowth = growth; fastestCat = cat; }
    }

    const frequentVendors = Object.entries(vendorCount)
      .filter(([, c]) => c >= 3)
      .sort((a, b) => b[1] - a[1]);

    return { largestTx, largestAmt, fastestCat, fastestGrowth, frequentVendors };
  }, [filteredRows, rows, timeframe]);

  // ── AI Narrative (client-side, built from live data) ───────────────────
  const aiNarrative = useMemo(() => {
    if (filteredRows.length === 0) return "";

    const catINR: Record<string, number> = {};
    const vendorCounts: Record<string, number> = {};
    const vendorINR: Record<string, number> = {};
    let fixedTotal = 0;
    let variableTotal = 0;
    const fixedBreakdown: Record<string, number> = {};

    const fixedCategories = new Set([
      "Salary",
      "Salaries & Admin",
      "Labour & Wages",
      "Rent & Facilities",
      "Electricity & Power"
    ]);

    for (const r of filteredRows) {
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at);
      const cat = normalizeCategory(r.expense_category || "Other expenses");
      catINR[cat] = (catINR[cat] || 0) + amt;

      const rawVendor = r.vendor || "Unknown";
      const cleanVendor = cleanVendorName(rawVendor);
      const vendorKey = cleanVendor && cleanVendor !== "—" && cleanVendor !== "Unknown" ? cleanVendor : "Unknown";
      if (vendorKey !== "Unknown") {
        vendorCounts[vendorKey] = (vendorCounts[vendorKey] || 0) + 1;
        vendorINR[vendorKey] = (vendorINR[vendorKey] || 0) + amt;
      }

      if (fixedCategories.has(cat)) {
        fixedTotal += amt;
        fixedBreakdown[cat] = (fixedBreakdown[cat] || 0) + amt;
      } else {
        variableTotal += amt;
      }
    }

    const totalINR = fixedTotal + variableTotal;
    const sortedCats = Object.entries(catINR).sort((a, b) => b[1] - a[1]);
    const { frequentVendors } = anomalyData;

    // 1. Top Expense Core
    let topExpenseCoreText = "";
    if (sortedCats.length > 0) {
      const [topCat, topAmt] = sortedCats[0];
      const pct = totalINR > 0 ? ((topAmt / totalINR) * 100).toFixed(0) : "0";
      
      let sectorDesc = "operational overhead";
      if (topCat === "Salaries & Admin" || topCat === "Labour & Wages") {
        sectorDesc = "payroll and administration";
      } else if (topCat === "Raw Material") {
        sectorDesc = "production inventory";
      } else if (topCat === "Marketing & Ads") {
        sectorDesc = "growth and marketing acquisition";
      } else if (topCat === "Software & Tech" || topCat === "Rent & Facilities") {
        sectorDesc = "operational infrastructure";
      }
      
      topExpenseCoreText = `${topCat} is the primary spending sector (${sectorDesc}) at ${formatCurrency(topAmt, "INR")} (${pct}% of total outflows).`;
      if (sortedCats.length > 1) {
        const [nextCat, nextAmt] = sortedCats[1];
        topExpenseCoreText += ` Secondary outflows were led by ${nextCat} at ${formatCurrency(nextAmt, "INR")}.`;
      }
    } else {
      topExpenseCoreText = "No categories logged this period.";
    }

    // 2. Fixed vs. Variable Overhead Velocity
    let fixedVariableVelocityText = "";
    if (totalINR > 0) {
      const fixedPct = ((fixedTotal / totalINR) * 100).toFixed(0);
      const variablePct = ((variableTotal / totalINR) * 100).toFixed(0);
      
      fixedVariableVelocityText = `Fixed operational baseline expenditures (Payroll, Rent, Power) stand at **${formatCurrency(fixedTotal, "INR")}** (${fixedPct}%), while fluid variable expenses constitute **${formatCurrency(variableTotal, "INR")}** (${variablePct}%).`;
      
      const fixedParts = Object.entries(fixedBreakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, amt]) => `${cat}: ${formatCurrency(amt, "INR")}`);
      
      if (fixedParts.length > 0) {
        fixedVariableVelocityText += ` Fixed cost breakdown: ${fixedParts.join(", ")}. This reflects a true operational run-rate baseline of **${formatCurrency(fixedTotal, "INR")}** required to keep the core operations active.`;
      } else {
        fixedVariableVelocityText += ` This indicates a highly dynamic overhead profile with minimal baseline fixed commitments this period.`;
      }
    } else {
      fixedVariableVelocityText = "No overhead expenditures detected to evaluate velocity.";
    }

    // 3. Transaction Density & Vendor Frequency
    let transactionDensityText = "";
    const sortedVendorsByCount = Object.entries(vendorCounts)
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1]);

    if (sortedVendorsByCount.length > 0) {
      const vendorParts = sortedVendorsByCount.slice(0, 3).map(([vend, count]) => {
        const amt = vendorINR[vend] || 0;
        return `**${vend}** (${count}x, totaling ${formatCurrency(amt, "INR")})`;
      });
      transactionDensityText = `High-frequency vendor endpoints include ${vendorParts.join(", ")}. Multiple recurring micro-transactions or repetitive invoicing indicate a high transaction density, which introduces operational cash flow friction and highlights active supply-chain/logistics spending habits.`;
    } else {
      transactionDensityText = "No high-frequency or repetitive vendor endpoints detected this period. Daily cash flow friction remains low, representing a highly diversified set of transaction endpoints.";
    }

    // 4. Anomaly & Duplicate Alert
    let anomalyText = "";
    if (frequentVendors.length > 0) {
      const list = frequentVendors.slice(0, 2).map(([vend, count]) => {
        return `*Action Required: Review ${count} matching transactions for ${cleanVendorName(vend)} for potential duplicate entries.*`;
      });
      anomalyText = list.join(" ");
    } else {
      anomalyText = "No potential double-billing or multiple-transaction vendor spikes detected this period.";
    }

    const titleLabel = timeframe === "Month" || timeframe === "Day" || timeframe === "Week"
      ? "Monthly Spend Insights"
      : timeframe === "Quarter"
        ? "Quarterly Spend Insights"
        : "Yearly Spend Insights";

    return `### 📊 ${titleLabel}
* **Top Expense Core:** ${topExpenseCoreText}
* **Fixed vs. Variable Overhead Velocity:** ${fixedVariableVelocityText}
* **Transaction Density & Vendor Frequency:** ${transactionDensityText}
* **Anomaly & Duplicate Alert:** ${anomalyText}`;
  }, [filteredRows, timeframe, anomalyData]);

  // ── Drilldown ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (categoryData.length > 0 && !selectedDrilldown)
      setSelectedDrilldown(categoryData[0].name);
  }, [categoryData, selectedDrilldown]);

  const drilldownStats = useMemo(() => {
    const target = selectedDrilldown || categoryData[0]?.name || "Other expenses";
    const matched = filteredRows.filter((r) => normalizeCategory(r.expense_category || "Other expenses") === target);
    let total = 0;
    for (const r of matched)
      total += convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    const count = matched.length;
    const avg = count > 0 ? total / count : 0;
    const percentage = summary.total > 0 ? (total / summary.total) * 100 : 0;
    const searched = matched.filter((r) =>
      `${r.vendor || ""} ${r.raw_text || ""}`.toLowerCase().includes(drilldownSearch.toLowerCase())
    );
    return { target, total, count, avg, percentage, transactions: searched };
  }, [filteredRows, selectedDrilldown, categoryData, displayCurrency, summary.total, drilldownSearch, ratesVersion]);

  // ── Period comparison ──────────────────────────────────────────────────
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(normalizeCategory(r.expense_category || "Other expenses"));
    return Array.from(set).sort();
  }, [rows]);

  useEffect(() => {
    if (allCategories.length > 0 && selectedCompareCategories.length === 0)
      setSelectedCompareCategories(allCategories.slice(0, 3));
  }, [allCategories, selectedCompareCategories]);

  const comparisonData = useMemo(() => {
    const categories =
      selectedCompareCategories.length > 0 ? selectedCompareCategories : allCategories.slice(0, 3);
    if (compareUnit === "Yearly") {
      const map: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        const d = new Date(effectiveDate(r));
        if (isNaN(d.getTime())) continue;
        const yr = d.getFullYear().toString();
        const cat = normalizeCategory(r.expense_category || "Other expenses");
        if (!categories.includes(cat)) continue;
        const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
        if (!map[yr]) map[yr] = {};
        map[yr][cat] = (map[yr][cat] || 0) + amt;
      }
      return Object.entries(map)
        .map(([period, catMap]) => ({ period, ...catMap }))
        .sort((a, b) => a.period.localeCompare(b.period));
    } else {
      const map: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        const d = new Date(effectiveDate(r));
        if (isNaN(d.getTime())) continue;
        const qtr = `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
        const cat = normalizeCategory(r.expense_category || "Other expenses");
        if (!categories.includes(cat)) continue;
        const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
        if (!map[qtr]) map[qtr] = {};
        map[qtr][cat] = (map[qtr][cat] || 0) + amt;
      }
      return Object.entries(map)
        .map(([period, catMap]) => ({ period, ...catMap }))
        .sort((a, b) => {
          const v = (s: string) => {
            const m = s.match(/^Q(\d)\s+(\d{4})$/);
            return m ? Number(m[2]) * 10 + Number(m[1]) : 0;
          };
          return v(a.period) - v(b.period);
        });
    }
  }, [rows, compareUnit, selectedCompareCategories, allCategories, displayCurrency, ratesVersion]);

  // ── Trend ──────────────────────────────────────────────────────────────
  const trendData = useMemo(() => {
    const map: Record<string, number> = {};
    const sorted = [...filteredRows].sort(
      (a, b) => new Date(effectiveDate(a)).getTime() - new Date(effectiveDate(b)).getTime()
    );
    for (const r of sorted) {
      const d = new Date(effectiveDate(r));
      let key = "";
      if (timeframe === "Day") key = format(d, "HH:00");
      else if (timeframe === "Week") key = format(d, "EEE");
      else if (timeframe === "Month" || timeframe === "Quarter") key = format(d, "MMM dd");
      else key = format(d, "MMM yyyy");
      map[key] = (map[key] || 0) +
        convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    }
    return Object.entries(map).map(([date, amount]) => ({ date, amount: parseFloat(amount.toFixed(2)) }));
  }, [filteredRows, timeframe, displayCurrency, ratesVersion]);

  // ── CSV Export ─────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const headers = ["Date", "Vendor", "Category", "Entity", "Expense Category", "Description", "Amount (INR)", "Currency"];
    const body = filteredRows.map((r) => [
      effectiveDate(r).split("T")[0],
      (r.vendor || "").replace(/,/g, ";"),
      r.main_category || r.category || "",
      r.company_entity || "",
      r.expense_category ? normalizeCategory(r.expense_category) : "",
      (r.raw_text || "").replace(/,/g, ";"),
      convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at).toFixed(2),
      r.currency,
    ]);
    const csv = [headers, ...body].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `finstream-${timeframe.toLowerCase()}-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };



  // ── Tooltip components ─────────────────────────────────────────────────
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-card border border-border p-3 rounded-lg shadow-[var(--shadow-luxury)] backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
          <p className="text-sm font-bold text-primary">{formatCurrency(payload[0].value, displayCurrency)}</p>
        </div>
      );
    }
    return null;
  };

  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const item = payload[0].payload;
      const total = activeDistData.reduce((s, d) => s + d.value, 0);
      return (
        <div className="bg-card border border-border p-3 rounded-lg shadow-[var(--shadow-luxury)] backdrop-blur-sm">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{item.name}</p>
          <p className="text-sm font-bold text-primary">{formatCurrency(item.value, displayCurrency)}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {((item.value / (total || 1)) * 100).toFixed(1)}% of total
          </p>
        </div>
      );
    }
    return null;
  };

  const handleCategoryCompareToggle = (cat: string) =>
    setSelectedCompareCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden pb-20 md:pb-8">
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />
      <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.04)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />

      <DashboardSidebar />
      <main className="flex-1 relative z-10 min-w-0">
        {/* ── Header ──────────────────────────────────────────────── */}
        <header className="border-b border-border bg-card/50 backdrop-blur px-6 md:px-10 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2 text-foreground">
              <BarChart3 className="w-5 h-5 text-primary animate-pulse" /> Reports
              {loading && <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI-powered financial intelligence · Budget tracking · Anomaly detection
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {rows.length > 0 && (
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Export CSV
              </button>
            )}
            <CurrencySwitcher />
            <ThemeToggle />
          </div>
        </header>

        <div className="p-6 md:p-10 space-y-8 max-w-6xl mx-auto">
          {/* ── Timeframe selector ────────────────────────────────── */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-card/30 p-5 rounded-xl border border-border">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2 text-foreground">
                <Calendar className="w-4 h-4 text-primary animate-pulse" /> Select Analysis Interval
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Tracking {summary.count} transactions in the selected period
              </p>
            </div>
            
            <div className="flex flex-wrap items-center gap-3 self-start lg:self-center">
              {/* Period Dropdown Selection */}
              <div className="flex items-center border border-border/80 rounded-md px-2.5 bg-card h-8">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground mr-2 shrink-0" />
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  className="text-xs bg-transparent text-foreground border-none outline-none pr-4 font-semibold cursor-pointer focus:ring-0 focus:outline-none"
                >
                  <option value="CY 2026">Calendar Year 2026</option>
                  <option value="CY 2025">Calendar Year 2025</option>
                  <option value="FY 2026-27">Financial Year 2026-27</option>
                  <option value="FY 2025-26">Financial Year 2025-26</option>
                  <optgroup label="Months (2026)">
                    <option value="month-2026-0">January 2026</option>
                    <option value="month-2026-1">February 2026</option>
                    <option value="month-2026-2">March 2026</option>
                    <option value="month-2026-3">April 2026</option>
                    <option value="month-2026-4">May 2026</option>
                    <option value="month-2026-5">June 2026</option>
                    <option value="month-2026-6">July 2026</option>
                    <option value="month-2026-7">August 2026</option>
                    <option value="month-2026-8">September 2026</option>
                    <option value="month-2026-9">October 2026</option>
                    <option value="month-2026-10">November 2026</option>
                    <option value="month-2026-11">December 2026</option>
                  </optgroup>
                  <optgroup label="Months (2025)">
                    <option value="month-2025-0">January 2025</option>
                    <option value="month-2025-1">February 2025</option>
                    <option value="month-2025-2">March 2025</option>
                    <option value="month-2025-3">April 2025</option>
                    <option value="month-2025-4">May 2025</option>
                    <option value="month-2025-5">June 2025</option>
                    <option value="month-2025-6">July 2025</option>
                    <option value="month-2025-7">August 2025</option>
                    <option value="month-2025-8">September 2025</option>
                    <option value="month-2025-9">October 2025</option>
                    <option value="month-2025-10">November 2025</option>
                    <option value="month-2025-11">December 2025</option>
                  </optgroup>
                  <option value="custom">Custom Date Range...</option>
                  <option value="All">All Periods</option>
                </select>
              </div>

              {/* Custom Date Range Picker */}
              {selectedPeriod === "custom" && (
                <div className="flex items-center gap-1.5 animate-in fade-in duration-200">
                  <input
                    type="date"
                    value={customFromDate}
                    onChange={(e) => setCustomFromDate(e.target.value)}
                    className="text-xs h-8 px-2 border border-border/80 rounded-md bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <span className="text-[10px] text-muted-foreground font-medium">to</span>
                  <input
                    type="date"
                    value={customToDate}
                    onChange={(e) => setCustomToDate(e.target.value)}
                    className="text-xs h-8 px-2 border border-border/80 rounded-md bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              )}

              <div className="flex bg-muted p-1 rounded-lg border border-border gap-1">
                {(["Day", "Week", "Month", "Quarter", "Year"] as const).map((tf) => {
                  const label = 
                    tf === "Day" ? "Day-wise" :
                    tf === "Week" ? "Week-wise" :
                    tf === "Month" ? "Month-wise" :
                    tf === "Quarter" ? "Quarter-wise" :
                    "Year-wise";
                  return (
                    <button
                      key={tf}
                      onClick={() => setTimeframe(tf)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer whitespace-nowrap",
                        timeframe === tf
                          ? "bg-primary text-primary-foreground shadow-[0_4px_12px_-3px_rgba(212,175,55,0.4)] font-bold"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Loading / Empty states ────────────────────────────── */}
          {loading && rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-32 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <span className="mt-2 text-sm">Aggregating ledger data…</span>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground card-luxury rounded-2xl p-10 border border-primary/20">
              <Inbox className="w-12 h-12 mb-3 text-primary/40 animate-pulse" />
              <p className="font-semibold text-lg">No Ledger Data Found</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-md text-center">
                Upload credit card statements or add manual transactions to view reports.
              </p>
            </div>
          ) : (
            <>
              {/* ══ 1. AI NARRATIVE SUMMARY ═══════════════════════════ */}
              {aiNarrative && (
                <div className="relative rounded-2xl border border-primary/30 bg-gradient-to-br from-[var(--midnight-navy)]/80 via-card to-card/60 p-6 overflow-hidden">
                  <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(212,175,55,0.09)_0%,transparent_65%)] pointer-events-none" />
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-[radial-gradient(circle,rgba(59,130,246,0.05)_0%,transparent_70%)] pointer-events-none" />
                  <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-3">
                      <Brain className="w-4.5 h-4.5 text-primary" />
                      <span className="text-xs font-bold uppercase tracking-widest text-primary">
                        AI Narrative Summary
                      </span>
                      <span className="ml-auto text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary/80 whitespace-nowrap">
                        ✦ AI Generated · {timeframe}
                      </span>
                    </div>
                    <MarkdownRenderer text={aiNarrative} />
                  </div>
                </div>
              )}

              {/* ══ 2. STAT CARDS ════════════════════════════════════ */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label="Total Outflow"   value={summary.total}       currency={displayCurrency} primary icon={<TrendingUp   className="w-4.5 h-4.5 text-primary"      />} />
                <StatCard label="Business Spend"  value={summary.business}    currency={displayCurrency}        icon={<ArrowUpRight className="w-4.5 h-4.5 text-primary"      />} />
                <StatCard label="Personal Spend"  value={summary.personal}    currency={displayCurrency}        icon={<ArrowUpRight className="w-4.5 h-4.5 text-blue-500"    />} />
                <StatCard label="Investments"     value={summary.investments} currency={displayCurrency}        icon={<DollarSign   className="w-4.5 h-4.5 text-emerald-500" />} />
              </div>

              {/* Direct vs Indirect Ratio Card — Full Detail */}
              <div className="card-luxury rounded-2xl border border-border bg-card p-6 space-y-5">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Scale className="w-5 h-5 text-[var(--primary)]" />
                    <h3 className="text-sm font-bold tracking-tight text-foreground uppercase">
                      Direct vs Indirect Cost Ratio
                    </h3>
                  </div>
                  {/* Entity filter pills */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">Entities:</span>
                    
                    {/* All Pill */}
                    <button
                      onClick={() => { 
                        setSelectedCostEntities([]); 
                        setExpandedDirectGroup(null); 
                        setExpandedIndirectGroup(null); 
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all border",
                        selectedCostEntities.length === 0
                          ? "bg-primary text-primary-foreground border-primary shadow-[0_2px_8px_rgba(212,175,55,0.3)]"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      )}
                    >
                      All
                    </button>

                    {/* KS, TI, CPM, AAS Pills */}
                    {["KS", "TI", "CPM", "AAS"].map((ent) => {
                      const isSelected = selectedCostEntities.includes(ent);
                      return (
                        <button
                          key={ent}
                          onClick={() => { 
                            setSelectedCostEntities(prev => {
                              const next = prev.includes(ent) 
                                ? prev.filter(e => e !== ent) 
                                : [...prev, ent];
                              return next;
                            });
                            setExpandedDirectGroup(null); 
                            setExpandedIndirectGroup(null); 
                          }}
                          className={cn(
                            "px-2.5 py-1 rounded-md text-[11px] font-bold uppercase tracking-wider transition-all border",
                            isSelected
                              ? "bg-primary text-primary-foreground border-primary shadow-[0_2px_8px_rgba(212,175,55,0.3)]"
                              : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                          )}
                        >
                          {ent}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Top row: totals + benchmark */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Direct Total */}
                  <div className="p-4 rounded-xl border border-[rgba(212,175,55,0.2)] bg-[rgba(212,175,55,0.02)] flex flex-col justify-between">
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Direct Production Cost</span>
                    <div className="text-2xl font-black text-foreground mt-1">
                      {formatCurrency(costSummary.directSpend, displayCurrency)}
                    </div>
                    <div className="text-xs font-semibold text-[var(--primary)] mt-1">
                      {costSummary.business > 0 ? ((costSummary.directSpend / costSummary.business) * 100).toFixed(1) : "0.0"}% of business spend
                    </div>
                  </div>

                  {/* Indirect Total */}
                  <div className={`p-4 rounded-xl border flex flex-col justify-between ${
                    (costSummary.business > 0 && (costSummary.indirectSpend / costSummary.business) * 100 > 40.0)
                      ? "border-red-500/30 bg-red-500/[0.015]"
                      : "border-border bg-card"
                  }`}>
                    <span className="text-[10px] uppercase font-bold text-muted-foreground">Indirect Cost (Overhead)</span>
                    <div className="text-2xl font-black text-foreground mt-1">
                      {formatCurrency(costSummary.indirectSpend, displayCurrency)}
                    </div>
                    <div className={`text-xs font-semibold mt-1 ${
                      (costSummary.business > 0 && (costSummary.indirectSpend / costSummary.business) * 100 > 40.0)
                        ? "text-red-400" : "text-muted-foreground"
                    }`}>
                      {costSummary.business > 0 ? ((costSummary.indirectSpend / costSummary.business) * 100).toFixed(1) : "0.0"}% of business spend
                    </div>
                  </div>

                  {/* Benchmark */}
                  <div className="flex flex-col justify-center">
                    {(() => {
                      const directRatio = costSummary.business > 0 ? (costSummary.directSpend / costSummary.business) * 100 : 0;
                      const indirectRatio = costSummary.business > 0 ? (costSummary.indirectSpend / costSummary.business) * 100 : 0;
                      if (costSummary.business === 0) return <div className="text-xs text-muted-foreground">No business transactions{selectedCostEntities.length > 0 ? ` for entity ${selectedCostEntities.join(", ")}` : ""} in this period.</div>;
                      const isHealthy = directRatio >= 60.0 && directRatio <= 70.0;
                      const isIndirectHigh = indirectRatio > 40.0;
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`h-2.5 w-2.5 rounded-full ${isHealthy ? "bg-emerald-500 animate-pulse" : isIndirectHigh ? "bg-red-500 animate-pulse" : "bg-amber-500 animate-pulse"}`} />
                            <span className="text-xs font-bold uppercase tracking-wider text-foreground">
                              {isHealthy ? "Optimal Ratio" : isIndirectHigh ? "🚨 High Overheads Flagged" : "Sub-Optimal Ratio"}
                            </span>
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {isHealthy
                              ? "Excellent! Your Direct Costs are aligned with the 60-70% manufacturing benchmark."
                              : isIndirectHigh
                              ? "Warning: Indirect overhead costs exceed 40% of business spend."
                              : `Direct Production Outflow stands at ${directRatio.toFixed(0)}%. Target: 60-70%.`}
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Ratio bar */}
                {costSummary.business > 0 && (
                  <div className="space-y-1.5 pt-1 border-t border-[rgba(212,175,55,0.08)]">
                    <div className="flex justify-between text-[10px] font-bold text-muted-foreground uppercase">
                      <span>Direct: {((costSummary.directSpend / costSummary.business) * 100).toFixed(0)}%</span>
                      <span>Indirect: {((costSummary.indirectSpend / costSummary.business) * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                      <div className="h-full bg-gradient-to-r from-[rgba(212,175,55,0.7)] to-[var(--primary)]" style={{ width: `${(costSummary.directSpend / costSummary.business) * 100}%` }} />
                      <div className="h-full bg-muted-foreground/30" style={{ width: `${(costSummary.indirectSpend / costSummary.business) * 100}%` }} />
                    </div>
                  </div>
                )}

                {/* ── DIRECT COST BREAKDOWN ── */}
                {directBreakdown.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-[rgba(212,175,55,0.08)]">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary)]">Direct Cost Breakdown</span>
                    </div>
                    {directBreakdown.map((group) => (
                      <div key={group.category} className="rounded-lg border border-[rgba(212,175,55,0.12)] overflow-hidden">
                        {/* Group header — clickable to expand */}
                        <button
                          onClick={() => setExpandedDirectGroup(expandedDirectGroup === group.category ? null : group.category)}
                          className="w-full flex items-center justify-between px-3 py-2.5 bg-[rgba(212,175,55,0.04)] hover:bg-[rgba(212,175,55,0.08)] transition-colors text-left"
                        >
                          <span className="text-xs font-bold text-foreground">{group.category}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-black text-[var(--primary)] tabular-nums">{formatCurrency(group.total, displayCurrency)}</span>
                            <span className="text-[10px] text-muted-foreground">{group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}</span>
                            <span className="text-muted-foreground text-xs">{expandedDirectGroup === group.category ? "▲" : "▼"}</span>
                          </div>
                        </button>

                        {/* Expanded rows */}
                        {expandedDirectGroup === group.category && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                                  <th className="px-3 py-2 text-left font-bold">Vendor</th>
                                  <th className="px-3 py-2 text-left font-bold">Material / Description</th>
                                  <th className="px-3 py-2 text-right font-bold">Rate</th>
                                  <th className="px-3 py-2 text-right font-bold">Qty</th>
                                  <th className="px-3 py-2 text-right font-bold">GST</th>
                                  <th className="px-3 py-2 text-right font-bold">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.entries.map((entry, idx) => (
                                  <tr key={idx} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                                    <td className="px-3 py-2.5 font-semibold text-foreground max-w-[160px]">
                                      <span className="truncate block" title={entry.vendor}>{entry.vendor}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground max-w-[200px]">
                                      <span className="truncate block" title={entry.materialType}>{entry.materialType || "—"}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-mono text-foreground/80 whitespace-nowrap">{entry.rateStr}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-foreground/80 whitespace-nowrap">{entry.qty}</td>
                                    <td className="px-3 py-2.5 text-right font-mono text-foreground/80 whitespace-nowrap">{entry.gstStr}</td>
                                    <td className="px-3 py-2.5 text-right font-bold text-foreground tabular-nums whitespace-nowrap">
                                      {formatCurrency(entry.amount, displayCurrency)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-[rgba(212,175,55,0.2)] bg-[rgba(212,175,55,0.04)]">
                                  <td colSpan={5} className="px-3 py-2 text-xs font-bold text-[var(--primary)] uppercase tracking-wide">Subtotal</td>
                                  <td className="px-3 py-2 text-right font-black text-[var(--primary)] tabular-nums whitespace-nowrap">
                                    {formatCurrency(group.total, displayCurrency)}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── INDIRECT COST BREAKDOWN ── */}
                {indirectBreakdown.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full bg-muted-foreground/50" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Indirect Cost Breakdown</span>
                    </div>
                    {indirectBreakdown.map((group) => (
                      <div key={group.category} className="rounded-lg border border-border overflow-hidden">
                        <button
                          onClick={() => setExpandedIndirectGroup(expandedIndirectGroup === group.category ? null : group.category)}
                          className="w-full flex items-center justify-between px-3 py-2.5 bg-muted/20 hover:bg-muted/40 transition-colors text-left"
                        >
                          <span className="text-xs font-bold text-foreground">{group.category}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-black text-foreground tabular-nums">{formatCurrency(group.total, displayCurrency)}</span>
                            <span className="text-[10px] text-muted-foreground">{group.entries.length} {group.entries.length === 1 ? "entry" : "entries"}</span>
                            <span className="text-muted-foreground text-xs">{expandedIndirectGroup === group.category ? "▲" : "▼"}</span>
                          </div>
                        </button>
                        {expandedIndirectGroup === group.category && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                                  <th className="px-3 py-2 text-left font-bold">Vendor</th>
                                  <th className="px-3 py-2 text-left font-bold">Description</th>
                                  <th className="px-3 py-2 text-right font-bold">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.entries.map((entry, idx) => (
                                  <tr key={idx} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                                    <td className="px-3 py-2.5 font-semibold text-foreground max-w-[180px]">
                                      <span className="truncate block" title={entry.vendor}>{entry.vendor}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-muted-foreground max-w-[250px]">
                                      <span className="truncate block" title={entry.description}>{entry.description || "—"}</span>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold text-foreground tabular-nums whitespace-nowrap">
                                      {formatCurrency(entry.amount, displayCurrency)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                              <tfoot>
                                <tr className="border-t border-border bg-muted/20">
                                  <td colSpan={2} className="px-3 py-2 text-xs font-bold text-muted-foreground uppercase tracking-wide">Subtotal</td>
                                  <td className="px-3 py-2 text-right font-black text-foreground tabular-nums whitespace-nowrap">
                                    {formatCurrency(group.total, displayCurrency)}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Empty state */}
                {directBreakdown.length === 0 && indirectBreakdown.length === 0 && costSummary.business === 0 && (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No business transactions found{selectedCostEntities.length > 0 ? ` for entity: ${selectedCostEntities.join(", ")}` : ""} in this period.
                  </div>
                )}
              </div>

              {/* ══ 4. ANOMALY CALLOUT CARDS ═════════════════════════ */}
              <div className="grid gap-4 md:grid-cols-3">
                {/* Largest transaction */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-2 relative overflow-hidden hover:border-amber-500/40 transition-colors">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-amber-500/5 rounded-bl-full pointer-events-none" />
                  <div className="flex items-center gap-2 text-amber-400">
                    <DollarSign className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Largest Transaction</span>
                  </div>
                  {anomalyData.largestTx ? (
                    <>
                      <div className="text-2xl font-extrabold text-foreground tabular-nums">
                        {formatCurrency(anomalyData.largestAmt, "INR")}
                      </div>
                      <div className="text-xs text-muted-foreground font-medium truncate">
                        {anomalyData.largestTx.vendor || "Unknown"}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70">
                        {(() => {
                          try {
                            return format(new Date(effectiveDate(anomalyData.largestTx!)), "dd-MMM-yy");
                          } catch { return "—"; }
                        })()}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">No data in this period</div>
                  )}
                </div>

                {/* Fastest growing category */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-2 relative overflow-hidden hover:border-primary/40 transition-colors">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 rounded-bl-full pointer-events-none" />
                  <div className="flex items-center gap-2 text-primary">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Fastest Growing</span>
                  </div>
                  {anomalyData.fastestCat ? (
                    <>
                      <div className="text-2xl font-extrabold text-foreground">
                        {anomalyData.fastestGrowth >= 999
                          ? "New"
                          : `+${anomalyData.fastestGrowth.toFixed(0)}%`}
                      </div>
                      <div className="text-xs text-muted-foreground font-medium">
                        {anomalyData.fastestCat}
                      </div>
                      <div className="text-[10px] text-muted-foreground/70">
                        vs prior {timeframe.toLowerCase()}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">No comparison data yet</div>
                  )}
                </div>

                {/* Repeat vendors */}
                <div className="rounded-2xl border border-border bg-card p-5 space-y-2 relative overflow-hidden hover:border-red-500/30 transition-colors">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-red-500/5 rounded-bl-full pointer-events-none" />
                  <div className="flex items-center gap-2 text-red-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">Repeat Vendors (3×+)</span>
                  </div>
                  {anomalyData.frequentVendors.length > 0 ? (
                    <div className="space-y-1.5 pt-1">
                      {anomalyData.frequentVendors.slice(0, 3).map(([vendor, count]) => (
                        <div key={vendor} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-foreground font-medium truncate">{vendor}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 shrink-0">
                            ×{count}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-emerald-400 font-medium pt-1">
                      ✓ No repeat vendors flagged
                    </div>
                  )}
                </div>
              </div>

              {/* ══ 5. CHARTS ROW ════════════════════════════════════ */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Spending Velocity Trend */}
                <div className="card-luxury rounded-2xl p-6 border border-border">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="font-bold text-lg text-foreground">Spending Velocity Trend</h3>
                      <p className="text-xs text-muted-foreground">Cumulative cash outflow over time (by invoice date)</p>
                    </div>
                    <span className="bg-primary/10 border border-primary/20 px-2.5 py-0.5 rounded text-[10px] text-primary font-bold uppercase tracking-wider">
                      {timeframe} Chart
                    </span>
                  </div>
                  {trendData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[300px] text-muted-foreground">
                      <Inbox className="w-8 h-8 mb-2 opacity-50 text-primary/40" />
                      <p className="text-sm">No expenses in this timeframe</p>
                    </div>
                  ) : (
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 24, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#D4AF37" stopOpacity={0.35} />
                              <stop offset="95%" stopColor="#D4AF37" stopOpacity={0.0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" vertical={false} />
                          <XAxis dataKey="date" stroke="#8A98B0" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                          <YAxis
                            stroke="#8A98B0"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            width={56}
                            tickFormatter={(v) => compactTick(v, displayCurrency)}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Area
                            type="monotone"
                            dataKey="amount"
                            stroke="#D4AF37"
                            strokeWidth={2.5}
                            fillOpacity={1}
                            fill="url(#colorSpend)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                {/* Spending Share – Category / Entity / Type toggle */}
                <div className="card-luxury rounded-2xl p-6 border border-border">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <h3 className="font-bold text-lg text-foreground flex items-center gap-1.5">
                        <PieIcon className="w-4 h-4 text-primary" /> Spending Share
                      </h3>
                      <p className="text-xs text-muted-foreground">Breakdown by selected dimension</p>
                    </div>
                    {/* Pie / Bar toggle */}
                    <div className="flex bg-muted p-0.5 rounded border border-border">
                      <button
                        onClick={() => setDistributionView("pie")}
                        className={cn("px-2.5 py-1 text-[10px] font-bold uppercase rounded cursor-pointer", distributionView === "pie" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                      >
                        Pie
                      </button>
                      <button
                        onClick={() => setDistributionView("bar")}
                        className={cn("px-2.5 py-1 text-[10px] font-bold uppercase rounded cursor-pointer", distributionView === "bar" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                      >
                        Bar
                      </button>
                    </div>
                  </div>

                  {/* Dimension toggle — Category | Entity | Type */}
                  <div className="flex bg-muted/60 p-0.5 rounded-lg border border-border mb-4 gap-0.5 w-fit">
                    {([
                      ["category", "By Category", null],
                      ["entity",   "By Entity",   Building2],
                      ["type",     "By Type",     null],
                    ] as const).map(([mode, label, Icon]) => (
                      <button
                        key={mode}
                        onClick={() => setDistributionMode(mode)}
                        className={cn(
                          "flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wide rounded-md transition-all cursor-pointer",
                          distributionMode === mode
                            ? "bg-card shadow text-foreground border border-border"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {Icon && <Icon className="w-3 h-3" />}
                        {label}
                      </button>
                    ))}
                  </div>

                  {activeDistData.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-[240px] text-muted-foreground">
                      <Inbox className="w-8 h-8 mb-2 opacity-50 text-primary/40" />
                      <p className="text-sm">No expenses in this timeframe</p>
                    </div>
                  ) : distributionView === "pie" ? (
                    <div className="h-[240px] flex flex-col sm:flex-row items-center gap-4">
                      <div className="h-full w-full max-w-[180px] flex-shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip content={<CustomPieTooltip />} />
                            <Pie
                              data={activeDistData}
                              cx="50%"
                              cy="50%"
                              innerRadius={55}
                              outerRadius={78}
                              paddingAngle={3}
                              dataKey="value"
                            >
                              {activeDistData.map((_, i) => (
                                <Cell
                                  key={`cell-${i}`}
                                  fill={PIE_COLORS[i % PIE_COLORS.length]}
                                  className="outline-none hover:opacity-85 transition-opacity"
                                />
                              ))}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex flex-col gap-2 overflow-y-auto max-h-[220px] pr-1 w-full min-w-0">
                        {activeDistData.map((c, i) => {
                          const total = activeDistData.reduce((s, d) => s + d.value, 0);
                          return (
                            <div key={c.name} className="flex items-center justify-between gap-3 text-xs min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }}
                                />
                                <span className="font-semibold truncate text-foreground">{c.name}</span>
                              </div>
                              <div className="font-mono text-muted-foreground whitespace-nowrap text-[11px]">
                                {formatCurrency(c.value, displayCurrency)}{" "}
                                <span className="text-primary font-bold">
                                  ({((c.value / (total || 1)) * 100).toFixed(0)}%)
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={activeDistData} margin={{ top: 10, right: 10, left: 24, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" vertical={false} />
                          <XAxis dataKey="name" stroke="#8A98B0" fontSize={10} tickLine={false} axisLine={false} dy={10} />
                          <YAxis
                            stroke="#8A98B0"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            width={56}
                            tickFormatter={(v) => compactTick(v, displayCurrency)}
                          />
                          <Tooltip content={<CustomTooltip />} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {activeDistData.map((_, i) => (
                              <Cell key={`cell-${i}`} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              </div>

              {/* ══ 3. BUDGET vs ACTUAL (Moved below charts) ════════════════ */}
              <div className="card-luxury rounded-2xl p-6 border border-border">
                <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
                  <div>
                    <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                      <Target className="w-4.5 h-4.5 text-primary animate-pulse" /> Budget vs Actual
                    </h3>
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-primary">{currentFiscalPeriod.label}</span>
                      <span className="text-muted-foreground/75">· amounts in INR · hover row to remove · click pencil to edit limit</span>
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3 flex-wrap">
                    {/* Unique Category Dropdown Selector to check any category budget */}
                    <div className="w-[180px]">
                      <Select
                        value=""
                        onValueChange={(val) => {
                          if (val && !trackedCategories.includes(val)) {
                            setTrackedCategories([...trackedCategories, val]);
                            toast.success(`Started tracking budget for "${val}"!`);
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 w-full bg-background border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/5 hover:text-white transition-colors text-[10px] font-bold uppercase tracking-wider cursor-pointer">
                          <SelectValue placeholder="➕ Add Category Budget" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[80vh] sm:max-h-[480px]">
                          {allDbCategories
                            .filter((c) => !trackedCategories.includes(c))
                            .map((c) => (
                              <SelectItem key={c} value={c} className="text-xs">
                                {c}
                              </SelectItem>
                            ))}
                          {allDbCategories.filter((c) => !trackedCategories.includes(c)).length === 0 && (
                            <div className="text-[10px] text-muted-foreground p-2 text-center">
                              All categories already tracked
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex bg-muted p-0.5 rounded border border-border text-[10px]">
                      {(["Monthly", "Quarterly", "Yearly"] as const).map((interval) => (
                        <button
                          key={interval}
                          onClick={() => {
                            setBudgetInterval(interval);
                            setShowAllBudgets(false); // Reset collapse when changing intervals
                          }}
                          className={cn(
                            "px-3 py-1 font-bold rounded transition-all cursor-pointer",
                            budgetInterval === interval
                              ? "bg-primary text-primary-foreground shadow-sm shadow-[0_2px_6px_rgba(212,175,55,0.3)]"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {interval}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {/* Left Column: Concentric Recharts Visualization */}
                  <div className="lg:col-span-2 flex flex-col justify-between bg-card/40 border border-border/30 rounded-2xl p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
                    
                    <div className="text-center relative z-10">
                      <span className="text-[10px] font-extrabold tracking-widest text-[var(--primary)] uppercase bg-[rgba(0,242,254,0.08)] px-2.5 py-1 rounded-full border border-[rgba(0,242,254,0.15)] shadow-[0_0_10px_rgba(0,242,254,0.1)] inline-block">
                        Concentric Budget Monitor
                      </span>
                      <p className="text-[10px] text-muted-foreground mt-2 font-medium">
                        Inner Ring: Budget Limit <span className="text-[var(--accent)] font-bold">🟡</span> | Outer Ring: Actual Spent <span className="text-[var(--primary)] font-bold">🔵</span>
                      </p>
                    </div>

                    <div className="h-[230px] w-full flex items-center justify-center relative z-10">
                      {budgetData.length === 0 ? (
                        <div className="text-center text-xs text-muted-foreground flex flex-col items-center justify-center">
                          <Target className="w-8 h-8 text-muted-foreground/30 mb-2" />
                          No budgets are currently tracked.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Tooltip
                              content={({ active, payload }) => {
                                if (active && payload && payload.length) {
                                  const data = payload[0].payload;
                                  return (
                                    <div className="bg-[#0b1222]/95 border border-[rgba(0,242,254,0.25)] p-3.5 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_15px_rgba(0,242,254,0.15)] backdrop-blur-md">
                                      <p className="text-xs font-bold text-white border-b border-border/40 pb-1.5 mb-2">{data.name}</p>
                                      <div className="space-y-1 text-[11px]">
                                        <div className="flex justify-between gap-6">
                                          <span className="text-muted-foreground">Actual Spent:</span>
                                          <span className="font-bold text-[var(--primary)] font-mono">
                                            {formatCurrency(data.spent, "INR")}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-6">
                                          <span className="text-muted-foreground">Allocated Limit:</span>
                                          <span className="font-bold text-[var(--accent)] font-mono">
                                            {formatCurrency(data.budget, "INR")}
                                          </span>
                                        </div>
                                        <div className="flex justify-between gap-6 pt-1 border-t border-border/20 mt-1">
                                          <span className="text-muted-foreground font-semibold">Budget Utilisation:</span>
                                          <span className={cn(
                                            "font-extrabold font-mono",
                                            data.pct >= 100 ? "text-red-400" : data.pct >= 70 ? "text-[var(--accent)]" : "text-emerald-400"
                                          )}>
                                            {data.pct.toFixed(1)}%
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            {/* Inner Ring: Budget limit per category */}
                            <Pie
                              data={budgetData.map((b) => ({
                                name: b.cat,
                                budget: b.budget,
                                spent: b.spent,
                                pct: b.pct,
                                overBudget: b.overBudget
                              }))}
                              dataKey="budget"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              outerRadius={62}
                              innerRadius={45}
                              paddingAngle={2}
                            >
                              {budgetData.map((entry, index) => {
                                const goldTones = ["#D4AF37", "#E5B842", "#F3CD6E", "#F8E0A1", "#C59B27"];
                                const color = goldTones[index % goldTones.length];
                                return <Cell key={`cell-inner-${index}`} fill={color} opacity={0.6} />;
                              })}
                            </Pie>
                            {/* Outer Ring: Actual spent per category */}
                            <Pie
                              data={budgetData.map((b) => ({
                                name: b.cat,
                                budget: b.budget,
                                spent: b.spent,
                                pct: b.pct,
                                overBudget: b.overBudget
                              }))}
                              dataKey="spent"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={72}
                              outerRadius={90}
                              paddingAngle={2}
                            >
                              {budgetData.map((entry, index) => {
                                if (entry.overBudget) {
                                  return <Cell key={`cell-outer-${index}`} fill="#EF4444" />;
                                }
                                const cyanTones = ["#00F2FE", "#00C6FF", "#00A8FF", "#38BDF8", "#0284C7"];
                                const color = cyanTones[index % cyanTones.length];
                                return <Cell key={`cell-outer-${index}`} fill={color} />;
                              })}
                            </Pie>
                          </PieChart>
                        </ResponsiveContainer>
                      )}
                    </div>

                    <div className="flex justify-center gap-4 text-[9px] font-bold tracking-tight text-muted-foreground border-t border-border/20 pt-2.5 relative z-10">
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" /> Budget Ring (Inner)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" /> Spent Ring (Outer)
                      </span>
                    </div>
                  </div>

                  {/* Right Column: List & Details with Inline controls & Linear SVG Gradients */}
                  <div className="lg:col-span-3 space-y-4">
                    {visibleBudgets.map(({ cat, budget, spent, pct, overBudget }) => {
                      const textColour =
                        pct >= 100 ? "text-red-400" :
                        pct >= 70  ? "text-amber-400" :
                        "text-emerald-400";
                      const statusColor =
                        pct >= 100 ? "text-red-400" :
                        pct >= 70 ? "text-[var(--accent)]" :
                        "text-[var(--primary)]";

                      return (
                        <div 
                          key={cat} 
                          className="group relative flex flex-col justify-between bg-muted/10 border border-border/40 p-4 rounded-xl transition-all duration-300 hover:bg-muted/20 hover:border-primary/20 hover:shadow-luxury"
                        >
                          <div className="flex items-center justify-between gap-4 mb-2">
                            {/* Budget Title */}
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", pct >= 100 ? "bg-red-500 animate-pulse" : pct >= 70 ? "bg-[var(--accent)]" : "bg-[var(--primary)]")} />
                              <span className="text-xs font-bold text-foreground truncate">{cat}</span>
                            </div>
                            
                            <button
                              onClick={() => {
                                setTrackedCategories(trackedCategories.filter((c) => c !== cat));
                                toast.info(`Stopped tracking budget for "${cat}"`);
                              }}
                              className="text-muted-foreground/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded cursor-pointer shrink-0 text-[10px]"
                              title="Stop tracking budget"
                            >
                              ✕
                            </button>
                          </div>

                          <div className="flex items-end justify-between flex-wrap gap-2 mb-3">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn("text-xs font-extrabold tabular-nums", textColour)}>
                                {formatCurrency(spent, "INR")}
                              </span>
                              
                              {/* Inline Budget Limit Editor */}
                              {editingCategory === cat ? (
                                <div className="flex items-center gap-1 animate-in fade-in duration-150">
                                  <span className="text-[10px] text-muted-foreground">/ ₹</span>
                                  <input
                                    type="text"
                                    value={editingValue}
                                    onChange={(e) => setEditingValue(e.target.value.replace(/\D/g, ""))}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        const num = Number(editingValue);
                                        if (!isNaN(num) && num > 0) {
                                          const scale = 
                                            budgetInterval === "Monthly" ? 1 :
                                            budgetInterval === "Quarterly" ? 3 :
                                            12;
                                          const baseLimit = Math.round(num / scale);
                                          setCategoryBudgets({
                                            ...categoryBudgets,
                                            [cat]: baseLimit,
                                          });
                                          setEditingCategory(null);
                                          toast.success(`Updated base budget for "${cat}" to ${formatCurrency(baseLimit, "INR")}!`);
                                        }
                                      } else if (e.key === "Escape") {
                                        setEditingCategory(null);
                                      }
                                    }}
                                    className="w-20 h-5 text-[10px] font-bold bg-background border border-[rgba(0,242,254,0.25)] rounded px-1 focus:outline-none focus:ring-1 focus:ring-primary text-foreground text-center"
                                    autoFocus
                                    onBlur={() => {
                                      const num = Number(editingValue);
                                      if (!isNaN(num) && num > 0) {
                                        const scale = 
                                          budgetInterval === "Monthly" ? 1 :
                                          budgetInterval === "Quarterly" ? 3 :
                                          12;
                                        const baseLimit = Math.round(num / scale);
                                        setCategoryBudgets({
                                          ...categoryBudgets,
                                          [cat]: baseLimit,
                                        });
                                      }
                                      setEditingCategory(null);
                                    }}
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center gap-1 group/btn">
                                  <span className="text-[10px] text-muted-foreground">
                                    / {formatCurrency(budget, "INR")}
                                  </span>
                                  <button
                                    onClick={() => {
                                      setEditingCategory(cat);
                                      setEditingValue(Math.round(budget).toString());
                                    }}
                                    className="opacity-0 group-hover/btn:opacity-100 hover:text-[var(--primary)] transition-opacity text-[10px] text-muted-foreground/60 cursor-pointer ml-1.5"
                                    title="Edit limit"
                                  >
                                    ✏️
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              <span className={cn("text-[10px] font-bold tabular-nums font-mono", statusColor)}>
                                {pct.toFixed(0)}% utilised
                              </span>
                              {overBudget && (
                                <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse">
                                  OVER
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Premium Glowing Custom Linear Gradient Bar */}
                          <div className="h-1.5 w-full bg-[rgba(255,255,255,0.05)] rounded-full overflow-hidden relative">
                            <div 
                              className={cn(
                                "h-full rounded-full transition-all duration-1000 ease-out", 
                                pct >= 100 
                                  ? "bg-gradient-to-r from-rose-500 to-red-600 shadow-[0_0_8px_#ef4444]" 
                                  : pct >= 70 
                                  ? "bg-gradient-to-r from-amber-400 to-[var(--accent)] shadow-[0_0_8px_var(--accent)]" 
                                  : "bg-gradient-to-r from-[var(--primary)] to-[#00c6ff] shadow-[0_0_8px_var(--primary)]"
                              )}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}

                    {sortedBudgets.length > 5 && (
                      <div className="pt-2 flex justify-center">
                        <button
                          onClick={() => setShowAllBudgets(!showAllBudgets)}
                          className="flex items-center gap-1 px-4 py-2 text-xs font-bold text-[var(--primary)] hover:text-[var(--primary-foreground)] border border-[var(--primary)]/30 hover:bg-[var(--primary)] bg-[var(--primary)]/5 rounded-lg transition-all cursor-pointer shadow-sm shadow-[0_1px_6px_rgba(0,242,254,0.15)]"
                        >
                          {showAllBudgets ? "Show Less (Top 5 At-Risk)" : `Show All Categories (${sortedBudgets.length})`}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* ══ 6. DYNAMIC CATEGORY DRILLDOWN ════════════════════ */}
              <div className="card-luxury rounded-2xl p-6 border border-border">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5 mb-5">
                  <div>
                    <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                      <SlidersHorizontal className="w-5 h-5 text-primary" /> Dynamic Category Analysis
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Select a category to deep dive into its period volume and itemized sub-ledger.
                    </p>
                  </div>
                  <div className="w-[180px] shrink-0">
                    <Select value={selectedDrilldown} onValueChange={setSelectedDrilldown}>
                      <SelectTrigger className="h-9 w-full bg-background border-border">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[80vh] sm:max-h-[480px]">
                        {categoryData.map((c) => (
                          <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {drilldownStats.transactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Inbox className="w-8 h-8 opacity-40 mb-2" />
                    <p className="text-sm">Select a category above to load analysis.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                      {[
                        { label: `Total Spent (${drilldownStats.target})`, value: formatCurrency(drilldownStats.total, displayCurrency), accent: true },
                        { label: "Transaction Count", value: `${drilldownStats.count} entries` },
                        { label: "Average Size", value: formatCurrency(drilldownStats.avg, displayCurrency) },
                        { label: "Period Share", value: `${drilldownStats.percentage.toFixed(1)}%` },
                      ].map(({ label, value, accent }) => (
                        <div key={label} className="rounded-xl border border-border p-3.5 bg-background">
                          <div className="text-[10px] uppercase text-muted-foreground font-bold">{label}</div>
                          <div className={cn("text-xl font-extrabold mt-1.5 tabular-nums", accent ? "text-primary" : "text-foreground")}>
                            {value}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center gap-3 bg-background border border-border rounded-lg px-3 py-1.5 max-w-sm">
                        <Search className="w-4 h-4 text-muted-foreground" />
                        <input
                          type="text"
                          value={drilldownSearch}
                          onChange={(e) => setDrilldownSearch(e.target.value)}
                          placeholder={`Search ${drilldownStats.target} vendors…`}
                          className="bg-transparent text-xs w-full text-foreground outline-none border-none placeholder-muted-foreground"
                        />
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-border max-h-[300px]">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-muted text-xs uppercase text-muted-foreground sticky top-0">
                            <tr>
                              <th className="px-4 py-2">Date</th>
                              <th className="px-4 py-2">Vendor</th>
                              <th className="px-4 py-2">Source / Raw text</th>
                              <th className="px-4 py-2 text-right">Amount ({displayCurrency})</th>
                            </tr>
                          </thead>
                          <tbody>
                            {drilldownStats.transactions.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-4 py-8 text-center text-xs text-muted-foreground">
                                  No transactions matching search.
                                </td>
                              </tr>
                            ) : (
                              drilldownStats.transactions.map((t, i) => {
                                const conv = convertAmount(Number(t.amount) || 0, t.currency || "INR", displayCurrency, t.created_at);
                                return (
                                  <tr key={i} className="border-b border-border hover:bg-muted/40 transition-colors">
                                    <td className="px-4 py-2.5 text-xs text-muted-foreground font-mono">
                                      {format(new Date(effectiveDate(t)), "yyyy-MM-dd")}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs font-semibold text-foreground">
                                      {t.vendor || "Unknown"}
                                    </td>
                                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground truncate max-w-[240px]">
                                      {t.raw_text || "—"}
                                    </td>
                                    <td className="px-4 py-2.5 text-xs text-right font-semibold text-foreground font-mono">
                                      {formatCurrency(conv, displayCurrency)}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* ══ 7. PERIOD-OVER-PERIOD COMPARISON ═════════════════ */}
              <div className="card-luxury rounded-2xl p-6 border border-border">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-5 mb-5">
                  <div>
                    <h3 className="font-bold text-lg text-foreground flex items-center gap-2">
                      <CalendarDays className="w-5 h-5 text-primary" /> Period-over-Period Expense Comparison
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Compare spending on custom-selected categories across years or quarters.
                    </p>
                  </div>
                  <div className="flex bg-muted p-1 rounded-lg border border-border shrink-0 self-start md:self-center">
                    <button onClick={() => setCompareUnit("Quarterly")} className={cn("px-3 py-1 text-xs font-bold rounded cursor-pointer transition-all", compareUnit === "Quarterly" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground")}>Quarterly</button>
                    <button onClick={() => setCompareUnit("Yearly")}    className={cn("px-3 py-1 text-xs font-bold rounded cursor-pointer transition-all", compareUnit === "Yearly"    ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground")}>Yearly</button>
                  </div>
                </div>

                <div className="grid gap-6 md:grid-cols-4">
                  <div className="md:col-span-1 space-y-3 border-r border-border/40 pr-4">
                    <div className="text-xs uppercase text-muted-foreground font-bold tracking-wider">Select Categories</div>
                    <div className="flex flex-row md:flex-col gap-1.5 flex-wrap max-h-[220px] md:max-h-none overflow-y-auto pr-1">
                      {allCategories.map((cat) => {
                        const selected = selectedCompareCategories.includes(cat);
                        return (
                          <button
                            key={cat}
                            onClick={() => handleCategoryCompareToggle(cat)}
                            className={cn(
                              "text-left text-xs px-2.5 py-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-between gap-2",
                              selected
                                ? "bg-primary/10 border-primary text-primary font-bold"
                                : "bg-background border-border text-muted-foreground hover:border-muted-foreground"
                            )}
                          >
                            <span className="truncate max-w-[120px]">{cat}</span>
                            <span className="text-[10px] px-1 bg-muted rounded border border-border">
                              {selected ? "✓" : "+"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="md:col-span-3">
                    {comparisonData.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-[260px] text-muted-foreground">
                        <Inbox className="w-8 h-8 opacity-45 mb-2" />
                        <p className="text-xs">Toggle category pills on the left to see comparisons.</p>
                      </div>
                    ) : (
                      <div className="h-[280px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={comparisonData} margin={{ top: 10, right: 10, left: 24, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(212,175,55,0.1)" vertical={false} />
                            <XAxis dataKey="period" stroke="#8A98B0" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                            <YAxis
                              stroke="#8A98B0"
                              fontSize={10}
                              tickLine={false}
                              axisLine={false}
                              width={56}
                              tickFormatter={(v) => compactTick(v, displayCurrency)}
                            />
                            <Tooltip
                              content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                  return (
                                    <div className="bg-card border border-border p-3 rounded-xl shadow-[var(--shadow-luxury)]">
                                      <div className="text-[10px] uppercase font-bold text-muted-foreground pb-1.5 border-b border-border mb-1.5">
                                        {label} comparison
                                      </div>
                                      <div className="space-y-1">
                                        {payload.map((p, idx) => (
                                          <div key={idx} className="flex items-center justify-between gap-4 text-xs font-semibold">
                                            <div className="flex items-center gap-1.5">
                                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                              <span className="text-foreground">{p.name}</span>
                                            </div>
                                            <span className="text-primary font-mono">
                                              {formatCurrency(p.value as number, displayCurrency)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              }}
                            />
                            <Legend
                              verticalAlign="top"
                              height={36}
                              content={({ payload }) => (
                                <div className="flex flex-wrap gap-x-4 gap-y-1 justify-center text-[10px] font-bold uppercase text-muted-foreground tracking-wider pb-4">
                                  {payload?.map((p, idx) => (
                                    <div key={idx} className="flex items-center gap-1.5">
                                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                                      <span>{p.value}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            />
                            {selectedCompareCategories.map((cat, index) => (
                              <Bar
                                key={cat}
                                dataKey={cat}
                                name={cat}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                                radius={[4, 4, 0, 0]}
                              />
                            ))}
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* ══ GOOGLE SHEETS EXPORT MODAL ══════════════════════════ */}

    </div>
  );
}

// ── StatCard component ─────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: number;
  currency: string;
  primary?: boolean;
  icon?: React.ReactNode;
}

function StatCard({ label, value, currency, primary, icon }: StatCardProps) {
  return (
    <div
      className={cn(
        "card-luxury rounded-2xl p-6 transition-all duration-300 hover:scale-[1.02] relative overflow-hidden",
        primary
          ? "ring-1.5 ring-primary bg-gradient-to-br from-[var(--midnight-navy)] to-[var(--sidebar-accent)]"
          : "bg-card"
      )}
    >
      {primary && (
        <div className="absolute top-0 right-0 w-12 h-12 bg-primary/10 rounded-bl-full pointer-events-none" />
      )}
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
        {icon}
      </div>
      <div className="text-2xl font-bold mt-3 text-foreground tabular-nums flex items-baseline gap-1">
        <span className="text-primary text-sm font-semibold">
          {formatCurrency(value, currency).match(/^[^\d\-]*/)?.[0] ?? ""}
        </span>
        <span className="font-extrabold tracking-tight">
          {formatCurrency(value, currency).replace(/^[^\d\-]*/, "")}
        </span>
      </div>
    </div>
  );
}
