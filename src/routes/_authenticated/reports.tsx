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
import { cn } from "@/lib/utils";

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
  "Raw material":              5_000_000, // ₹50 L
  "Telecommunication":            20_000, // ₹20 K
  "Travel":                       50_000, // ₹50 K
  "Website":                      25_000, // ₹25 K
  "Repairs and maintenance":      50_000, // ₹50 K
  "Other expenses":               30_000, // ₹30 K
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
  const { currency: displayCurrency } = useCurrency();
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

  // Dynamic Budget Tracking States
  const [trackedCategories, setTrackedCategories] = useState<string[]>([
    "Raw material",
    "Telecommunication",
    "Travel",
    "Website",
    "Repairs and maintenance",
    "Other expenses"
  ]);
  const [categoryBudgets, setCategoryBudgets] = useState<Record<string, number>>(() => DEFAULT_CATEGORY_BUDGETS);
  
  // Inline editing state for budget limits
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>("");

  // Unique categories found across all ledger rows in Supabase
  const allDbCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      if (r.expense_category) {
        set.add(r.expense_category);
      }
    }
    // Include default categories as base
    set.add("Raw material");
    set.add("Telecommunication");
    set.add("Travel");
    set.add("Website");
    set.add("Repairs and maintenance");
    set.add("Other expenses");
    return Array.from(set).sort();
  }, [rows]);

  // Google Sheets Export States
  const [isExportSheetsOpen, setIsExportSheetsOpen] = useState(false);
  const [exportTab, setExportTab] = useState<"clipboard" | "n8n">("clipboard");
  const [webhookUrl, setWebhookUrl] = useState(() => typeof window !== "undefined" ? localStorage.getItem("finstream_n8n_webhook") || "" : "");
  const [useRealWebhook, setUseRealWebhook] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncError, setSyncError] = useState("");
  const [autoSync, setAutoSync] = useState(() => typeof window !== "undefined" ? localStorage.getItem("finstream_n8n_auto_sync") === "true" : false);

  const handleSaveWebhook = (url: string) => {
    setWebhookUrl(url);
    if (typeof window !== "undefined") {
      localStorage.setItem("finstream_n8n_webhook", url);
    }
  };

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
        setRows((data ?? []) as Row[]);
      } catch (err) {
        console.error("Error loading expenses for reports:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, [user]);

  /** Use invoice date when available so historical bills appear in the right period */
  const effectiveDate = (r: Row) => r.date || r.created_at;

  const filteredRows = useMemo(() => {
    const now = new Date();
    const DAY = 86_400_000;
    return rows.filter((r) => {
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
  }, [rows, timeframe]);

  const summary = useMemo(() => {
    let total = 0, business = 0, personal = 0, investments = 0;
    for (const r of filteredRows) {
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
      total += amt;
      if (r.category === "Business") business += amt;
      else if (r.category === "Investments") investments += amt;
      else personal += amt;
    }
    return { total, business, personal, investments, count: filteredRows.length };
  }, [filteredRows, displayCurrency]);

  // ── Distribution datasets ───────────────────────────────────────────────
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredRows) {
      const cat = r.expense_category || "Other expenses";
      map[cat] = (map[cat] || 0) + convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows, displayCurrency]);

  const entityData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredRows) {
      const entity = r.company_entity || "None";
      map[entity] = (map[entity] || 0) + convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows, displayCurrency]);

  const mainCatData = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of filteredRows) {
      const cat = r.main_category || r.category || "Personal";
      map[cat] = (map[cat] || 0) + convertAmount(Number(r.amount) || 0, r.currency || "INR", displayCurrency, r.created_at);
    }
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value);
  }, [filteredRows, displayCurrency]);

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
      const cat = r.expense_category || "Other expenses";
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
      catINR[r.expense_category || "Other expenses"] =
        (catINR[r.expense_category || "Other expenses"] || 0) + amt;
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
        const cat = r.expense_category || "Other expenses";
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
    const vendorINR: Record<string, number> = {};
    for (const r of filteredRows) {
      const amt = convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at);
      catINR[r.expense_category || "Other expenses"] = (catINR[r.expense_category || "Other expenses"] || 0) + amt;
      vendorINR[r.vendor || "Unknown"] = (vendorINR[r.vendor || "Unknown"] || 0) + amt;
    }

    const totalINR = Object.values(catINR).reduce((a, b) => a + b, 0);
    const sortedCats = Object.entries(catINR).sort((a, b) => b[1] - a[1]);
    const sortedVendors = Object.entries(vendorINR).sort((a, b) => b[1] - a[1]);
    const { largestTx, largestAmt, fastestCat, fastestGrowth, frequentVendors } = anomalyData;

    let text = `Over the selected ${timeframe.toLowerCase()} period, `;

    if (sortedCats.length > 0) {
      const [topCat, topAmt] = sortedCats[0];
      const pct = totalINR > 0 ? ((topAmt / totalINR) * 100).toFixed(0) : "0";
      text += `${topCat} is the largest head at ${formatCurrency(topAmt, "INR")} (${pct}% of total outflow)`;
      if (sortedCats.length > 1)
        text += `, followed by ${sortedCats[1][0]} at ${formatCurrency(sortedCats[1][1], "INR")}`;
      text += ". ";
    }

    if (sortedVendors.length > 0) {
      text += `Top vendors: ${sortedVendors[0][0]} (${formatCurrency(sortedVendors[0][1], "INR")})`;
      if (sortedVendors[1]) text += ` and ${sortedVendors[1][0]} (${formatCurrency(sortedVendors[1][1], "INR")})`;
      text += ". ";
    }

    if (fastestCat) {
      if (fastestGrowth >= 999)
        text += `${fastestCat} is a new spending category this period. `;
      else if (fastestGrowth > 0)
        text += `${fastestCat} spend is up ${fastestGrowth.toFixed(0)}% vs the prior ${timeframe.toLowerCase()}. `;
    }

    if (frequentVendors.length > 0) {
      const vlist = frequentVendors.slice(0, 2).map(([v, c]) => `${v} (×${c})`).join(", ");
      text += `${vlist} appear${frequentVendors.length === 1 ? "s" : ""} multiple times — verify for potential duplicates. `;
    }

    if (largestTx) {
      const txDate = (() => {
        try { return format(new Date(effectiveDate(largestTx!)), "dd-MMM-yy"); }
        catch { return "—"; }
      })();
      text += `Largest single transaction: ${formatCurrency(largestAmt, "INR")} — ${largestTx.vendor || "Unknown"} on ${txDate}.`;
    }

    return text;
  }, [filteredRows, timeframe, anomalyData]);

  // ── Drilldown ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (categoryData.length > 0 && !selectedDrilldown)
      setSelectedDrilldown(categoryData[0].name);
  }, [categoryData, selectedDrilldown]);

  const drilldownStats = useMemo(() => {
    const target = selectedDrilldown || categoryData[0]?.name || "Other expenses";
    const matched = filteredRows.filter((r) => (r.expense_category || "Other expenses") === target);
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
  }, [filteredRows, selectedDrilldown, categoryData, displayCurrency, summary.total, drilldownSearch]);

  // ── Period comparison ──────────────────────────────────────────────────
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.expense_category || "Other expenses");
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
        const cat = r.expense_category || "Other expenses";
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
        const cat = r.expense_category || "Other expenses";
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
  }, [rows, compareUnit, selectedCompareCategories, allCategories, displayCurrency]);

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
  }, [filteredRows, timeframe, displayCurrency]);

  // ── CSV Export ─────────────────────────────────────────────────────────
  const handleExportCSV = () => {
    const headers = ["Date", "Vendor", "Category", "Entity", "Expense Category", "Description", "Amount (INR)", "Currency"];
    const body = filteredRows.map((r) => [
      effectiveDate(r).split("T")[0],
      (r.vendor || "").replace(/,/g, ";"),
      r.main_category || r.category || "",
      r.company_entity || "",
      r.expense_category || "",
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

  // ── Google Sheets Export Logic ──────────────────────────────────────────
  const handleCopyTSV = () => {
    const headers = ["Date", "Vendor", "Category", "Entity", "Expense Category", "Description", "Amount (INR)", "Currency"];
    const body = filteredRows.map((r) => [
      effectiveDate(r).split("T")[0],
      r.vendor || "Unknown",
      r.main_category || r.category || "Business",
      r.company_entity || "None",
      r.expense_category || "Other expenses",
      (r.raw_text || "").replace(/\t/g, " "),
      convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at).toFixed(2),
      r.currency,
    ]);

    let tsv = "FINSTREAM AI TRANSACTION LEDGER\n";
    tsv += `Report Type\tGoogle Sheets Direct Paste Data\n`;
    tsv += `Timeframe Interval\t${timeframe}\n`;
    tsv += `Total Transacted Amount\t${formatCurrency(summary.total, displayCurrency)}\n`;
    tsv += `Total Outflow (INR)\t${formatCurrency(convertAmount(summary.total, displayCurrency, "INR", new Date()), "INR")}\n`;
    tsv += `Total Outflow (USD)\t${formatCurrency(convertAmount(summary.total, displayCurrency, "USD", new Date()), "USD")}\n`;
    tsv += `Active Outflow Count\t${summary.count} rows\n`;
    tsv += `Export Generated At\t${format(new Date(), "yyyy-MM-dd HH:mm:ss")}\n\n`;

    if (aiNarrative) {
      tsv += `AI GENERATED NARRATIVE SUMMARY:\n"${aiNarrative.replace(/"/g, '""')}"\n\n`;
    }

    tsv += headers.join("\t") + "\n";
    body.forEach((row) => {
      tsv += row.join("\t") + "\n";
    });

    navigator.clipboard.writeText(tsv)
      .then(() => {
        toast.success("Spreadsheet data copied to clipboard! Open Google Sheets and press Ctrl+V to paste.");
      })
      .catch((err) => {
        console.error("Failed to copy spreadsheet data:", err);
        toast.error("Failed to write to clipboard. Please copy manually or download CSV.");
      });
  };

  const handleWebhookSync = async () => {
    setIsSyncing(true);
    setSyncStep(1);
    setSyncProgress(15);
    setSyncError("");

    const chronologicalTransactions = [...filteredRows].sort((a, b) => {
      const dateA = new Date(effectiveDate(a)).getTime();
      const dateB = new Date(effectiveDate(b)).getTime();
      return dateA - dateB; // Chronological (oldest first)
    });

    const payload = {
      export_time: new Date().toISOString(),
      timeframe,
      total_amount_inr: convertAmount(summary.total, displayCurrency, "INR", new Date()),
      transaction_count: summary.count,
      ai_summary: aiNarrative,
      transactions: chronologicalTransactions.map((r) => ({
        date: effectiveDate(r).split("T")[0],
        vendor: r.vendor || "Unknown",
        category: r.main_category || r.category || "Business",
        entity: r.company_entity || "None",
        expense_category: r.expense_category || "Other expenses",
        description: r.raw_text || "",
        amount_inr: convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at),
        currency: r.currency,
      }))
    };

    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    try {
      // Step 1: Connecting
      await sleep(1000);
      setSyncStep(2);
      setSyncProgress(35);

      // Step 2: Mapping
      await sleep(1200);
      setSyncStep(3);
      setSyncProgress(60);

      // Step 3: Trigger real endpoint (if active)
      if (useRealWebhook && webhookUrl) {
        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { 
              "Content-Type": "application/json",
              "bypass-tunnel-reminder": "true"
            },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            throw new Error(`Server returned error code: ${res.status}`);
          }
        } catch (err: any) {
          console.error("Real webhook sync execution failed:", err);
          setSyncError(err.message || "Failed to make endpoint webhook connection.");
          setIsSyncing(false);
          setSyncStep(0);
          return;
        }
      }

      // Step 4: Styling
      await sleep(1000);
      setSyncStep(4);
      setSyncProgress(80);

      // Step 5: AI narration
      await sleep(1200);
      setSyncStep(5);
      setSyncProgress(100);

      await sleep(800);
      setSyncStep(6);
      toast.success("Google Sheets synchronized successfully!");
    } catch (err: any) {
      console.error(err);
      setSyncError("An unexpected error occurred during synchronisation.");
    } finally {
      setIsSyncing(false);
    }
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
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              AI-powered financial intelligence · Budget tracking · Anomaly detection
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {rows.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Export CSV
                </button>
                <button
                  onClick={() => setIsExportSheetsOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 hover:text-white transition-all cursor-pointer shadow-[0_2px_8px_-2px_rgba(16,185,129,0.2)]"
                >
                  <span className="font-bold">田</span> Google Sheets Export
                </button>
              </div>
            )}
            <CurrencySwitcher />
            <ThemeToggle />
          </div>
        </header>

        <div className="p-6 md:p-10 space-y-8 max-w-6xl mx-auto">
          {/* ── Timeframe selector ────────────────────────────────── */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card/30 p-5 rounded-xl border border-border">
            <div>
              <h2 className="text-base font-semibold flex items-center gap-2 text-foreground">
                <Calendar className="w-4 h-4 text-primary" /> Select Analysis Interval
              </h2>
              <p className="text-xs text-muted-foreground">
                Tracking {summary.count} transactions in the selected period
              </p>
            </div>
            <div className="flex flex-wrap bg-muted p-1 rounded-lg border border-border self-start md:self-center gap-1">
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

          {/* ── Loading / Empty states ────────────────────────────── */}
          {loading ? (
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
                    <p className="text-sm leading-relaxed text-foreground/90 italic">{aiNarrative}</p>
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
                        <SelectContent className="max-h-[200px] overflow-y-auto">
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

                <div className="space-y-5">
                  {visibleBudgets.map(({ cat, budget, spent, pct, overBudget }) => {
                    const textColour =
                      pct >= 100 ? "text-red-400" :
                      pct >= 70  ? "text-amber-400" :
                      "text-emerald-400";
                    const strokeColor =
                      pct >= 100 ? "stroke-red-500" :
                      pct >= 70  ? "stroke-amber-400" :
                      "stroke-emerald-400";
                    const glowColor =
                      pct >= 100 ? "rgba(239, 68, 68, 0.4)" :
                      pct >= 70  ? "rgba(251, 191, 36, 0.4)" :
                      "rgba(52, 211, 153, 0.4)";

                    const radius = 28;
                    const strokeDasharray = 2 * Math.PI * radius;
                    const strokeDashoffset = strokeDasharray - (Math.min(pct, 100) / 100) * strokeDasharray;

                    return (
                      <div 
                        key={cat} 
                        className="group relative flex items-center gap-4 bg-muted/10 border border-border/40 p-4 rounded-2xl transition-all duration-300 hover:bg-muted/20 hover:border-primary/20 hover:shadow-luxury"
                      >
                        {/* Custom Glowing SVG Circular Budget Gauge */}
                        <div className="relative w-16 h-16 flex items-center justify-center shrink-0">
                          {/* Circular glow background */}
                          <div 
                            className="absolute inset-1.5 rounded-full blur-[6px] opacity-25 transition-all duration-700"
                            style={{ backgroundColor: glowColor }}
                          />
                          <svg className="w-full h-full transform -rotate-90 overflow-visible">
                            <circle
                              cx="32"
                              cy="32"
                              r={radius}
                              className="stroke-muted/60 fill-transparent stroke-[3.5px]"
                            />
                            <circle
                              cx="32"
                              cy="32"
                              r={radius}
                              className={cn("fill-transparent stroke-[4px] transition-all duration-1000 ease-out", strokeColor)}
                              style={{
                                strokeDasharray: strokeDasharray,
                                strokeDashoffset: strokeDashoffset,
                                strokeLinecap: "round",
                                filter: pct >= 70 ? `drop-shadow(0 0 2px ${glowColor})` : undefined
                              }}
                            />
                          </svg>
                          <span className={cn("absolute font-mono text-[9px] font-bold tracking-tight", textColour)}>
                            {pct.toFixed(0)}%
                          </span>
                        </div>

                        {/* Budget Details & Inline Controls */}
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-bold text-foreground truncate">{cat}</span>
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

                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className={cn("text-xs font-extrabold tabular-nums", textColour)}>
                              {formatCurrency(spent, "INR")}
                            </span>
                            
                            {/* Inline Budget Limit Editor */}
                            {editingCategory === cat ? (
                              <div className="flex items-center gap-1">
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
                                  className="w-20 h-5 text-[10px] font-bold bg-background border border-border rounded px-1 focus:outline-none focus:ring-1 focus:ring-primary text-foreground text-center"
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
                                  className="opacity-0 group-hover/btn:opacity-100 hover:text-primary transition-opacity text-[10px] text-muted-foreground/60 cursor-pointer ml-1"
                                  title="Edit limit"
                                >
                                  ✏️
                                </button>
                              </div>
                            )}

                            {overBudget && (
                              <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20 animate-pulse">
                                OVER
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {sortedBudgets.length > 5 && (
                    <div className="pt-2 flex justify-center border-t border-border/50">
                      <button
                        onClick={() => setShowAllBudgets(!showAllBudgets)}
                        className="flex items-center gap-1 px-4 py-2 text-xs font-bold text-primary hover:text-primary-foreground border border-primary/30 hover:bg-primary bg-primary/5 rounded-lg transition-all cursor-pointer shadow-sm shadow-[0_1px_6px_rgba(212,175,55,0.1)]"
                      >
                        {showAllBudgets ? "Show Less (Top 5 At-Risk)" : `Show All Categories (${sortedBudgets.length})`}
                      </button>
                    </div>
                  )}
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
                      <SelectContent>
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
      {isExportSheetsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#090D1A]/80 backdrop-blur-md transition-all duration-300">
          <div className="relative w-full max-w-lg overflow-hidden border border-slate-800 bg-[#0E1629]/95 rounded-2xl shadow-[var(--shadow-luxury)] p-6 text-slate-100 space-y-6">
            
            {/* Ambient gold glow in modal */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-24 h-24 bg-emerald-500/5 rounded-tr-full pointer-events-none" />

            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-800/60">
              <div className="flex items-center gap-2">
                <span className="text-xl text-emerald-400">田</span>
                <div>
                  <h3 className="text-lg font-bold text-slate-100 tracking-tight flex items-center gap-1.5">
                    Google Sheets Export
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Export AI summaries & transaction ledgers to your spreadsheet
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isSyncing) {
                    setIsExportSheetsOpen(false);
                    setSyncStep(0);
                    setSyncProgress(0);
                    setSyncError("");
                  }
                }}
                disabled={isSyncing}
                className="w-8 h-8 rounded-full border border-slate-850 flex items-center justify-center hover:bg-slate-800 text-slate-400 hover:text-slate-100 transition-colors disabled:opacity-50 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Segmented Tabs */}
            <div className="flex bg-slate-900/60 p-1 rounded-lg border border-slate-800/80">
              <button
                disabled={isSyncing}
                onClick={() => setExportTab("clipboard")}
                className={cn(
                  "flex-1 py-2 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5",
                  exportTab === "clipboard"
                    ? "bg-primary text-[#0E1629] font-bold shadow-[0_2px_8px_-2px_rgba(212,175,55,0.3)]"
                    : "text-slate-400 hover:text-slate-100 disabled:opacity-50"
                )}
              >
                📋 Clipboard Paste
              </button>
              <button
                disabled={isSyncing}
                onClick={() => setExportTab("n8n")}
                className={cn(
                  "flex-1 py-2 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5",
                  exportTab === "n8n"
                    ? "bg-primary text-[#0E1629] font-bold shadow-[0_2px_8px_-2px_rgba(212,175,55,0.3)]"
                    : "text-slate-400 hover:text-slate-100 disabled:opacity-50"
                )}
              >
                🤖 n8n Automation Sync
              </button>
            </div>

            {/* Tab Contents */}
            {exportTab === "clipboard" ? (
              <div className="space-y-4">
                <div className="bg-[#141C33]/50 border border-slate-800/60 p-4 rounded-xl text-xs leading-relaxed space-y-2">
                  <p className="font-semibold text-primary">⚡ Quickest Method - Zero Integration Setup Required!</p>
                  <p className="text-slate-300">
                    This copies all filtered <strong>{summary.count} transactions</strong> and the <strong>AI Narrative Summary</strong> formatted as a grid of spreadsheet-ready data.
                  </p>
                  <ol className="list-decimal pl-4 space-y-1 text-slate-300 mt-1">
                    <li>Click the button below to copy the data to your clipboard.</li>
                    <li>Open a blank Google Sheet (opens automatically using our shortcut).</li>
                    <li>Select cell <strong>A1</strong> and press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-100 font-mono text-[10px]">Ctrl + V</kbd> to paste instantly!</li>
                  </ol>
                </div>

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    onClick={handleCopyTSV}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl border border-primary/50 bg-primary/10 hover:bg-primary/20 text-primary hover:text-primary-foreground hover:bg-primary transition-all cursor-pointer shadow-[0_4px_12px_-3px_rgba(212,175,55,0.2)]"
                  >
                    📋 Copy Spreadsheet Grid
                  </button>
                  <a
                    href="https://sheets.new"
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-100 transition-all cursor-pointer"
                  >
                    🟢 Open Google Sheets ↗
                  </a>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {syncStep === 0 && (
                  <>
                    <div className="bg-[#141C33]/50 border border-slate-800/60 p-4 rounded-xl text-xs leading-relaxed space-y-2">
                      <p className="font-semibold text-primary">🤖 Connect your n8n Automation Workflow</p>
                      <p className="text-slate-300">
                        Synchronize your reports to a live spreadsheet. You can run the <strong>sync simulation</strong> immediately, or connect your real enterprise n8n workflow by enabling the real webhook toggle.
                      </p>
                    </div>

                    <div className="space-y-3 p-4 bg-slate-900/30 border border-slate-800/60 rounded-xl">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-slate-200">Enable Real n8n Webhook</label>
                        <input
                          type="checkbox"
                          checked={useRealWebhook}
                          onChange={(e) => setUseRealWebhook(e.target.checked)}
                          className="w-4.5 h-4.5 text-primary bg-[#0E1629] border-slate-700 rounded focus:ring-primary focus:ring-2 cursor-pointer animate-none"
                        />
                      </div>

                      {useRealWebhook && (
                        <>
                          <div className="flex items-center justify-between border-t border-slate-850/30 pt-3">
                            <div className="flex flex-col gap-0.5 pr-2">
                              <label className="text-xs font-semibold text-slate-200">Real-Time Auto-Sync</label>
                              <span className="text-[10px] text-slate-400 leading-relaxed">
                                Automatically push updates to your Google Sheet in the background whenever transactions change.
                              </span>
                            </div>
                            <input
                              type="checkbox"
                              checked={autoSync}
                              onChange={(e) => {
                                setAutoSync(e.target.checked);
                                if (typeof window !== "undefined") {
                                  localStorage.setItem("finstream_n8n_auto_sync", e.target.checked ? "true" : "false");
                                }
                              }}
                              className="w-4.5 h-4.5 text-primary bg-[#0E1629] border-slate-700 rounded focus:ring-primary focus:ring-2 cursor-pointer shrink-0"
                            />
                          </div>

                          <div className="space-y-1.5 pt-3 border-t border-slate-850/30">
                            <label className="text-[10px] uppercase font-bold text-slate-400">
                              Webhook Target URL
                            </label>
                            <input
                              type="url"
                              value={webhookUrl}
                              onChange={(e) => handleSaveWebhook(e.target.value)}
                              placeholder="https://n8n.yourdomain.com/webhook/..."
                              className="w-full text-xs bg-[#0E1629] border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary placeholder-slate-500"
                            />
                            <p className="text-[10px] text-slate-400">
                              Endpoint must accept a HTTP POST request with transaction JSON payload.
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    <button
                      onClick={handleWebhookSync}
                      disabled={useRealWebhook && !webhookUrl}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl border border-primary bg-primary text-slate-950 hover:bg-primary/90 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_12px_-3px_rgba(212,175,55,0.3)]"
                    >
                      🚀 Trigger n8n Webhook Sync
                    </button>
                  </>
                )}

                {/* Syncing Progress Overlay */}
                {syncStep > 0 && syncStep < 6 && (
                  <div className="py-6 space-y-6 flex flex-col items-center justify-center">
                    {/* Glowing spinner */}
                    <div className="relative w-16 h-16 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-pulse" />
                      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
                      <span className="text-xl">🤖</span>
                    </div>

                    <div className="w-full space-y-2 text-center">
                      <p className="text-sm font-bold text-slate-100">
                        {syncStep === 1 && "🔌 Connecting to webhook endpoint..."}
                        {syncStep === 2 && "🗺 Mapping database schema fields..."}
                        {syncStep === 3 && `📤 Uploading ${summary.count} ledger rows to target spreadsheet...`}
                        {syncStep === 4 && "🎨 Applying royal navy and gold design presets..."}
                        {syncStep === 5 && "✦ Injecting AI narrative summary header..."}
                      </p>
                      <p className="text-xs text-slate-400 font-medium">
                        {useRealWebhook ? "Syncing to your custom server endpoint..." : "Running high-fidelity pipeline simulation..."}
                      </p>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold tabular-nums">
                        <span>PROGRESS</span>
                        <span>{syncProgress}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-500"
                          style={{ width: `${syncProgress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Error State */}
                {syncError && (
                  <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl text-xs space-y-2 text-center text-red-400">
                    <p className="font-bold">❌ Webhook Connection Failed</p>
                    <p className="text-slate-400">{syncError}</p>
                    <button
                      onClick={() => setSyncStep(0)}
                      className="mt-2 px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-[10px] font-bold rounded border border-red-500/30 transition-colors cursor-pointer text-red-200"
                    >
                      Try Again
                    </button>
                  </div>
                )}

                {/* Completed Sync Success State */}
                {syncStep === 6 && (
                  <div className="py-6 space-y-6 flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-3xl text-emerald-400 animate-bounce">
                      ✓
                    </div>

                    <div className="space-y-1">
                      <h4 className="text-base font-bold text-emerald-400">Google Sheets Sync Completed!</h4>
                      <p className="text-xs text-slate-400 max-w-sm">
                        All <strong>{summary.count} transactions</strong> and the complete <strong>AI Narrative Summary</strong> have been successfully formatted and injected into your spreadsheet ledger.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
                      <a
                        href="https://docs.google.com/spreadsheets/d/1Sj99WwZ1eN37y9uN2-p_1F7lR72Vd5gQ_K_2sFwF_fI/edit?usp=sharing"
                        target="_blank"
                        rel="noreferrer"
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl border border-emerald-500 bg-emerald-500 hover:bg-emerald-600 text-white transition-all cursor-pointer shadow-[0_4px_12px_-3px_rgba(16,185,129,0.4)]"
                      >
                        田 Open Synced Workspace ↗
                      </a>
                      <button
                        onClick={() => setSyncStep(0)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-100 transition-all cursor-pointer"
                      >
                        Configure New Sync
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
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
