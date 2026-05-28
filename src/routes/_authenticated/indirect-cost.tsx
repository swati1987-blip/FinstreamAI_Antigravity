import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { 
  Scale, 
  Search, 
  Loader2, 
  TrendingUp, 
  Coins, 
  Filter, 
  ChevronRight, 
  Boxes,
  Building2,
  Calendar,
  Layers,
  ShieldCheck,
  ArrowUpRight,
  AlertTriangle,
  HelpCircle,
  Flag
} from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { formatCurrency } from "@/lib/currency";
import { getRateToINR } from "@/lib/fx";
import { cleanVendorName, cn, parseDescriptionDetails, resolveEntityFromVendor, classifyExpense } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/indirect-cost")({
  component: IndirectCostPage,
  head: () => ({
    meta: [{ title: "Indirect Costs — FinStream" }],
  }),
});

interface Expense {
  id: string;
  user_id: string;
  raw_text: string | null;
  amount: number;
  currency: string;
  category: string;
  vendor: string | null;
  created_at: string;
  business_id?: string | null;
  date?: string;
  main_category?: string;
  company_entity?: string;
  expense_category?: string;
}

// Indirect cost categories - everything that is NOT a direct cost
const INDIRECT_CATEGORIES = [
  "Admin Costs",
  "Advertisement",
  "Business Promotion",
  "Insurance",
  "Investment",
  "Investment & Other Assets",
  "Investment and other assets",
  "Legal",
  "Marketing expense",
  "Rent",
  "Taxes",
  "Telecommunication",
  "Travel",
  "Website",
  "Other expenses",
];

// Group overhead categories for the summary cards
const OVERHEAD_GROUPS: Record<string, string[]> = {
  "Marketing & Ads": ["Advertisement", "Business Promotion", "Marketing expense"],
  "Travel & Logistics": ["Travel", "Courier/Transportation"],
  "Software & Tech": ["Website", "Telecommunication"],
  "Professional & Rent": ["Legal", "Rent", "Insurance"],
  "General Overhead": ["Admin Costs", "Taxes", "Investment", "Investment & Other Assets", "Investment and other assets", "Other expenses", "Staff Welfare"],
};

function getOverheadGroup(expenseCategory: string | undefined): string {
  if (!expenseCategory) return "General Overhead";
  for (const [group, cats] of Object.entries(OVERHEAD_GROUPS)) {
    if (cats.some(c => c.toLowerCase() === expenseCategory.toLowerCase())) return group;
  }
  return "General Overhead";
}

function IndirectCostPage() {
  const { user } = useAuth();
  const { currency: displayCurrency } = useCurrency();
  const navigate = useNavigate();
  
  const [allItems, setAllItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");

  // Period filter states
  const [selectedPeriod, setSelectedPeriod] = useState<string>("CY 2026");
  const [customFromDate, setCustomFromDate] = useState<string>("");
  const [customToDate, setCustomToDate] = useState<string>("");

  const loadIndirectCosts = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false });
    
    setAllItems((data ?? []) as Expense[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    loadIndirectCosts();

    const channel = supabase
      .channel("indirect_cost_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses" },
        () => {
          loadIndirectCosts();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Enrich records and filter out Personal expenses
  const businessRecords = useMemo(() => {
    return allItems
      .map((item) => {
        const classified = classifyExpense(item);
        const invoiceDate = item.date ? new Date(item.date) : new Date(item.created_at);
        const fxRate = getRateToINR(item.currency, invoiceDate);
        const amountInINR = item.amount * fxRate;
        const overheadGroup = getOverheadGroup(item.expense_category);
        
        let description = item.raw_text || "";
        if (description.includes(" · ")) {
          description = description.split(" · ").slice(1).join(" · ");
        }
        
        const parsed = parseDescriptionDetails(item.raw_text, Number(item.amount) || 0);

        let companyEntity = item.company_entity || "None";
        if (companyEntity === "None" || companyEntity === "NONE") {
          companyEntity = resolveEntityFromVendor(item.vendor, item.raw_text);
        }

        return {
          ...item,
          company_entity: companyEntity,
          classified,
          amountInINR,
          invoiceDate,
          overheadGroup,
          description,
          parsed,
        };
      })
      .filter(r => r.classified.type !== "Personal") // Strictly exclude Personal expenses!
      .filter((r) => {
        const expDate = r.invoiceDate;
        if (selectedPeriod === "FY 2026-27") {
          const start = new Date("2026-04-01T00:00:00");
          const end = new Date("2027-03-31T23:59:59");
          return expDate >= start && expDate <= end;
        }
        if (selectedPeriod === "FY 2025-26") {
          const start = new Date("2025-04-01T00:00:00");
          const end = new Date("2026-03-31T23:59:59");
          return expDate >= start && expDate <= end;
        }
        if (selectedPeriod === "CY 2026") {
          const start = new Date("2026-01-01T00:00:00");
          const end = new Date("2026-12-31T23:59:59");
          return expDate >= start && expDate <= end;
        }
        if (selectedPeriod === "CY 2025") {
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
  }, [allItems, selectedPeriod, customFromDate, customToDate]);

  // Filtered records for the ledger list (strictly indirect)
  const filteredRecords = useMemo(() => {
    return businessRecords.filter((record) => {
      if (record.classified.type !== "Indirect") return false;

      const matchesSearch = 
        (record.classified.category || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
        (record.vendor && record.vendor.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (record.description && record.description.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesEntity = 
        selectedEntities.length === 0 || 
        (record.company_entity && selectedEntities.map(e => e.toUpperCase()).includes(record.company_entity.toUpperCase()));

      const matchesGroup =
        selectedGroup === "all" ||
        record.overheadGroup === selectedGroup;

      return matchesSearch && matchesEntity && matchesGroup;
    });
  }, [businessRecords, searchQuery, selectedEntities, selectedGroup]);

  const distinctGroups = useMemo(() => {
    const groups = businessRecords
      .filter(r => r.classified.type === "Indirect")
      .map(r => r.overheadGroup);
    return Array.from(new Set(groups)).sort();
  }, [businessRecords]);

  const stats = useMemo(() => {
    // Total Indirect Cost in the filtered view
    const indirectTotalINR = filteredRecords.reduce((acc, curr) => acc + curr.amountInINR, 0);
    
    // Total Direct vs Indirect for the selected entity scope
    const entityScopedBusinessRecords = businessRecords.filter(r => 
      selectedEntities.length === 0 || 
      (r.company_entity && selectedEntities.map(e => e.toUpperCase()).includes(r.company_entity.toUpperCase()))
    );

    const totalDirectINR = entityScopedBusinessRecords
      .filter(r => r.classified.type === "Direct")
      .reduce((acc, curr) => acc + curr.amountInINR, 0);

    const totalIndirectINR = entityScopedBusinessRecords
      .filter(r => r.classified.type === "Indirect")
      .reduce((acc, curr) => acc + curr.amountInINR, 0);

    const totalBusinessOutflowINR = totalDirectINR + totalIndirectINR;
    
    const indirectPercentOfOutflow = totalBusinessOutflowINR > 0 
      ? (indirectTotalINR / totalBusinessOutflowINR) * 100 
      : 0;

    const overheadRatio = totalBusinessOutflowINR > 0 
      ? (totalIndirectINR / totalBusinessOutflowINR) * 100 
      : 0;

    // Month-on-Month Change
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    let currentMonthIndirectINR = 0;
    let lastMonthIndirectINR = 0;

    filteredRecords.forEach(r => {
      const dateObj = r.invoiceDate;
      if (dateObj >= currentMonthStart && dateObj <= currentMonthEnd) {
        currentMonthIndirectINR += r.amountInINR;
      } else if (dateObj >= lastMonthStart && dateObj <= lastMonthEnd) {
        lastMonthIndirectINR += r.amountInINR;
      }
    });

    let indirectMomChangePercent = 0;
    if (lastMonthIndirectINR > 0) {
      indirectMomChangePercent = ((currentMonthIndirectINR - lastMonthIndirectINR) / lastMonthIndirectINR) * 100;
    } else if (currentMonthIndirectINR > 0) {
      indirectMomChangePercent = 100;
    }

    // Dominant Overhead Cost Category
    const grouping: Record<string, number> = {};
    filteredRecords.forEach(r => {
      const cat = r.classified.category || "Other Indirect";
      grouping[cat] = (grouping[cat] || 0) + r.amountInINR;
    });

    let dominantOverhead = "—";
    let dominantOverheadSpent = 0;
    Object.entries(grouping).forEach(([group, spent]) => {
      if (spent > dominantOverheadSpent) {
        dominantOverheadSpent = spent;
        dominantOverhead = group;
      }
    });

    const dominantOverheadPercent = indirectTotalINR > 0 
      ? (dominantOverheadSpent / indirectTotalINR) * 100 
      : 0;

    const hasDominantWarning = dominantOverheadPercent > 50;

    interface FlaggedOverhead {
      name: string;
      spend: number;
      ratio: number;
    }

    const flaggedOverheadCategories: FlaggedOverhead[] = Object.entries(grouping)
      .map(([name, spend]): FlaggedOverhead => {
        const ratio = indirectTotalINR > 0 ? (spend / indirectTotalINR) * 100 : 0;
        return { name, spend, ratio };
      })
      .filter((c: FlaggedOverhead) => c.ratio > 20.0)
      .sort((a: FlaggedOverhead, b: FlaggedOverhead) => b.ratio - a.ratio);

    return {
      indirectTotalINR,
      indirectPercentOfOutflow,
      overheadRatio,
      indirectMomChangePercent,
      dominantOverhead,
      dominantOverheadSpent,
      dominantOverheadPercent,
      hasDominantWarning,
      flaggedOverheadCategories,
      totalBusinessOutflowINR
    };
  }, [filteredRecords, businessRecords, selectedEntities]);

  const momTrends = useMemo(() => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    const indirectCategoryMap: Record<string, { current: number; last: number }> = {};
    distinctGroups.forEach(g => { indirectCategoryMap[g] = { current: 0, last: 0 }; });

    filteredRecords.forEach(r => {
      const cat = r.overheadGroup;
      if (!indirectCategoryMap[cat]) return;
      const dateObj = r.invoiceDate;
      if (dateObj >= currentMonthStart && dateObj <= currentMonthEnd) {
        indirectCategoryMap[cat].current += r.amountInINR;
      } else if (dateObj >= lastMonthStart && dateObj <= lastMonthEnd) {
        indirectCategoryMap[cat].last += r.amountInINR;
      }
    });

    return Object.entries(indirectCategoryMap).map(([category, spend]) => {
      let percentChange = 0;
      if (spend.last > 0) {
        percentChange = ((spend.current - spend.last) / spend.last) * 100;
      } else if (spend.current > 0) {
        percentChange = 100;
      }
      return { category, currentSpend: spend.current, lastSpend: spend.last, percentChange };
    }).sort((a, b) => b.currentSpend - a.currentSpend);
  }, [filteredRecords, distinctGroups]);

  const groupSummaries = useMemo(() => {
    const summaryMap: Record<string, { group: string; totalSpent: number; count: number }> = {};
    filteredRecords.forEach((record) => {
      const key = record.overheadGroup;
      if (!summaryMap[key]) summaryMap[key] = { group: key, totalSpent: 0, count: 0 };
      summaryMap[key].totalSpent += record.amountInINR;
      summaryMap[key].count += 1;
    });
    return Object.values(summaryMap).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [filteredRecords]);

  const isOverheadCritical = stats.overheadRatio > 40.0;

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />
      <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.04)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />

      <DashboardSidebar />

      <main className="flex-1 p-6 md:p-10 relative z-10 min-w-0 flex flex-col">
        <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-[var(--primary)] animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest text-[var(--primary)] font-semibold">Indirect Cost Analytics</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <Scale className="w-8 h-8 text-[var(--primary)]" />
              Indirect Costs Portal
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Track business overheads and non-direct operating costs.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            {/* Period Dropdown Selection */}
            <div className="flex items-center border border-border/80 rounded-md px-2.5 bg-card h-8">
              <Calendar className="w-3 h-3 text-muted-foreground mr-2 shrink-0" />
              <select
                value={selectedPeriod}
                onChange={(e) => setSelectedPeriod(e.target.value)}
                className="text-xs bg-transparent text-foreground border-none outline-none pr-4 font-semibold cursor-pointer"
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

            <Button
              variant="outline"
              size="sm"
              onClick={loadIndirectCosts}
              className="text-xs border-[rgba(212,175,55,0.3)] hover:bg-[var(--sidebar-accent)]/20"
            >
              <Layers className="w-3.5 h-3.5 mr-1.5 text-[var(--primary)]" />
              Reload Ledger
            </Button>
          </div>
        </header>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {/* Card 1: Total Indirect Cost */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Indirect Cost</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5">
                {formatCurrency(stats.indirectTotalINR, "INR")}
              </div>
              <div className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1.5">
                <span className={cn(
                  "inline-block w-2 h-2 rounded-full", 
                  stats.indirectPercentOfOutflow < 25 
                    ? "bg-emerald-500 shadow-[0_0_6px_#10B981]" 
                    : stats.indirectPercentOfOutflow <= 35 
                    ? "bg-amber-500 shadow-[0_0_6px_#F59E0B]" 
                    : "bg-red-500 shadow-[0_0_6px_#EF4444]"
                )} />
                <span className={cn(
                  "font-semibold",
                  stats.indirectPercentOfOutflow < 25 
                    ? "text-emerald-400" 
                    : stats.indirectPercentOfOutflow <= 35 
                    ? "text-amber-400" 
                    : "text-red-400"
                )}>
                  {stats.indirectPercentOfOutflow.toFixed(1)}% of total business outflow
                </span>
              </div>
            </div>
          </div>

          {/* Card 2: Overhead Ratio with interactive floating tooltip */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className={cn(
              "p-3.5 rounded-lg",
              stats.overheadRatio < 25 
                ? "bg-emerald-500/8 text-emerald-500" 
                : stats.overheadRatio <= 35 
                ? "bg-amber-500/8 text-amber-500" 
                : "bg-red-500/8 text-red-500"
            )}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Overhead Ratio</span>
                <div className="relative group cursor-pointer inline-flex items-center">
                  <HelpCircle className="w-3.5 h-3.5 text-muted-foreground/60 hover:text-muted-foreground" />
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2.5 text-[10px] font-medium leading-relaxed bg-[#0E1629] border border-[rgba(212,175,55,0.4)] text-slate-200 rounded-lg shadow-[0_10px_25px_-5px_rgba(0,0,0,0.5)] z-50 text-center transition-all duration-200">
                    Healthy range for manufacturing: below 30%
                    <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#0E1629]" />
                  </div>
                </div>
              </div>
              <div className={cn(
                "text-2xl font-bold tracking-tight mt-0.5",
                stats.overheadRatio < 25 
                  ? "text-emerald-400" 
                  : stats.overheadRatio <= 35 
                  ? "text-amber-400" 
                  : "text-red-400"
              )}>
                {stats.overheadRatio.toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                Indirect ÷ (Direct + Indirect)
              </div>
            </div>
          </div>

          {/* Card 3: Month-on-Month Change */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className={cn(
              "p-3.5 rounded-lg",
              stats.indirectMomChangePercent <= 0 
                ? "bg-emerald-500/8 text-emerald-500" 
                : "bg-red-500/8 text-red-500"
            )}>
              <TrendingUp className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Month-on-Month Change</div>
              <div className={cn(
                "text-2xl font-bold tracking-tight mt-0.5",
                stats.indirectMomChangePercent <= 0 
                  ? "text-emerald-400" 
                  : "text-red-400"
              )}>
                {stats.indirectMomChangePercent >= 0 ? "+" : ""}{stats.indirectMomChangePercent.toFixed(1)}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-1">
                vs previous month
              </div>
            </div>
          </div>

          {/* Card 4: Dominant Overhead with red warning review flag badge */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px] min-w-0">
            <div className={cn(
              "p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]",
              stats.hasDominantWarning && "bg-red-500/8 text-red-500"
            )}>
              {stats.hasDominantWarning ? <Flag className="w-6 h-6 animate-pulse" /> : <Scale className="w-6 h-6" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground truncate">Dominant Overhead</div>
              <div className="text-sm font-semibold tracking-tight truncate mt-1 text-[var(--primary)]">
                {stats.dominantOverhead}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {formatCurrency(stats.dominantOverheadSpent, "INR")} ({stats.dominantOverheadPercent.toFixed(1)}%)
              </div>
              {stats.hasDominantWarning && (
                <div className="text-[9px] font-bold text-red-400 flex items-center gap-1 mt-1 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded w-max animate-pulse">
                  <Flag className="w-3 h-3" />
                  Review Required
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="card-luxury p-5 rounded-xl border bg-card space-y-4">
            <h3 className="font-semibold text-sm tracking-tight text-foreground flex items-center gap-2">
              <TrendingUp className="w-4.5 h-4.5 text-[var(--primary)]" />
              MoM Overhead Trends
            </h3>
            <div className="space-y-3.5">
              {momTrends.length === 0 ? <div className="text-xs text-muted-foreground py-8 text-center">No trend details found.</div> : 
                momTrends.map((trend) => (
                  <div key={trend.category} className="flex items-center justify-between gap-3 border-b border-[rgba(212,175,55,0.06)] pb-2.5">
                    <div className="text-xs font-semibold text-foreground truncate">{trend.category}</div>
                    <div className="text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${trend.percentChange > 0 ? "bg-red-500/10 text-red-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                        {trend.percentChange > 0 ? "+" : ""}{trend.percentChange.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          <div className="card-luxury p-5 rounded-xl border bg-card space-y-4">
            <h3 className="font-semibold text-sm tracking-tight text-foreground flex items-center gap-2 text-amber-500">
              <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
              Budget Alerts
            </h3>
            <div className="space-y-3">
              {stats.flaggedOverheadCategories.length === 0 ? (
                <div className="text-xs text-emerald-400 p-4 text-center bg-emerald-500/[0.02] border border-emerald-500/10 rounded-lg">✓ No categories exceed 20% limit.</div>
              ) : (
                stats.flaggedOverheadCategories.map((c: { name: string; spend: number; ratio: number }) => (
                  <div key={c.name} className="border border-red-500/20 bg-red-500/[0.015] p-3 rounded-lg flex justify-between text-xs">
                    <span className="font-bold truncate">{c.name}</span>
                    <span className="text-red-400 font-bold">{c.ratio.toFixed(0)}%</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card-luxury p-5 rounded-xl border bg-card space-y-4">
            <h3 className="font-semibold text-sm tracking-tight text-foreground flex items-center gap-2">
              <Layers className="w-4.5 h-4.5 text-[var(--primary)]" />
              Group Breakdown
            </h3>
            <div className="space-y-3.5 max-h-[300px] overflow-y-auto">
              {groupSummaries.map((summary) => (
                <div key={summary.group} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="truncate">{summary.group}</span>
                    <span>{formatCurrency(summary.totalSpent, "INR")}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card-luxury rounded-xl border bg-card flex-1 flex flex-col min-h-[400px]">
          <div className="p-5 border-b border-[rgba(212,175,55,0.18)] flex flex-col sm:flex-row justify-between gap-4">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[var(--primary)]" />
              Audit Log ({filteredRecords.length} records)
            </h3>
            <div className="flex flex-wrap items-center gap-2.5">
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 text-xs h-8"
              />
              <div className="flex items-center gap-1 border rounded-md px-2 h-8">
                {["KS", "TI", "CPM", "AAS"].map((ent) => (
                  <button
                    key={ent}
                    onClick={() => setSelectedEntities(prev => prev.includes(ent) ? prev.filter(e => e !== ent) : [...prev, ent])}
                    className={cn("px-2 py-0.5 rounded text-[10px] font-bold", selectedEntities.includes(ent) ? "bg-primary text-white" : "text-muted-foreground")}
                  >
                    {ent}
                  </button>
                ))}
              </div>
              <select value={selectedGroup} onChange={(e) => setSelectedGroup(e.target.value)} className="text-xs h-8 bg-card border rounded px-2">
                <option value="all">All Groups</option>
                {distinctGroups.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)]" />
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <Boxes className="w-8 h-8 mb-2" />
                <span className="text-xs">No records match your search.</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[rgba(212,175,55,0.15)] bg-[rgba(212,175,55,0.02)] text-muted-foreground text-[10px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-2.5">Date</th>
                    <th className="py-3 px-2.5">Vendor</th>
                    <th className="py-3 px-2.5">Expense Details</th>
                    <th className="py-3 px-2.5">Expense Category</th>
                    <th className="py-3 px-2.5">Overhead Group</th>
                    <th className="py-3 px-2.5 text-right">GST</th>
                    <th className="py-3 px-2.5 text-center">Entity</th>
                    <th className="py-3 px-2.5 text-right">Amount (Original)</th>
                    <th className="py-3 px-2.5 text-right">Amount (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(212,175,55,0.08)]">
                  {filteredRecords.map((record) => (
                    <tr key={record.id} onClick={() => void navigate({ to: "/transactions", search: { edit: record.id } })} className="hover:bg-[rgba(212,175,55,0.025)] transition-colors cursor-pointer">
                      <td className="py-3 px-2.5 text-muted-foreground whitespace-nowrap">
                        <div className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5 shrink-0" />{format(record.invoiceDate, "dd-MMM-yy")}</div>
                      </td>
                      <td className="py-3 px-2.5 font-medium text-foreground max-w-[120px] whitespace-normal break-words">{cleanVendorName(record.vendor)}</td>
                      <td className="py-3 px-2.5 text-muted-foreground text-[11px] max-w-[160px] whitespace-normal break-words">{record.parsed.materialType || "—"}</td>
                      <td className="py-3 px-2.5 max-w-[100px] whitespace-normal break-words">
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[rgba(212,175,55,0.06)] border border-[rgba(212,175,55,0.15)] inline-block">{record.expense_category || "Other"}</span>
                      </td>
                      <td className="py-3 px-2.5 font-medium max-w-[100px] whitespace-normal break-words">{record.overheadGroup}</td>
                      <td className="py-3 px-2.5 text-right font-mono whitespace-nowrap">{record.parsed.gstNum !== null ? formatCurrency(record.parsed.gstNum, record.currency) : "—"}</td>
                      <td className="py-3 px-2.5 text-center">
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted inline-block">{record.company_entity || "None"}</span>
                      </td>
                      <td className="py-3 px-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">{formatCurrency(record.amount, record.currency)}</td>
                      <td className="py-3 px-2.5 text-right font-bold text-foreground whitespace-nowrap">{formatCurrency(record.amountInINR, "INR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
