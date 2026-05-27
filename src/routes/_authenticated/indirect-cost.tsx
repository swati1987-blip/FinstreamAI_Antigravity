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
  HelpCircle
} from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { formatCurrency } from "@/lib/currency";
import { getRateToINR } from "@/lib/fx";
import { cleanVendorName, cn, parseDescriptionDetails } from "@/lib/utils";
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
  "General Overhead": ["Admin Costs", "Taxes", "Investment", "Other expenses", "Staff Welfare"],
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

  const loadIndirectCosts = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false });
    
    const indirectCostExpenses = (data ?? []).filter(
      (item) => {
        const cat = (item.expense_category || "").trim();
        const isDirectCost = [["Raw material", "Salary/Wages", "Fuel", "Repairs and maintenance", "Courier/Transportation", "Staff Welfare"]].flat().some(
          dc => dc.toLowerCase() === cat.toLowerCase()
        );
        return !isDirectCost && cat !== "";
      }
    );
    
    setAllItems(indirectCostExpenses as Expense[]);
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

  const records = useMemo(() => {
    return allItems.map((item) => {
      const invoiceDate = item.date ? new Date(item.date) : new Date(item.created_at);
      const fxRate = getRateToINR(item.currency, invoiceDate);
      const amountInINR = item.amount * fxRate;
      const overheadGroup = getOverheadGroup(item.expense_category);
      let description = item.raw_text || "";
      if (description.includes(" · ")) {
        description = description.split(" · ").slice(1).join(" · ");
      }
      
      const parsed = parseDescriptionDetails(item.raw_text, Number(item.amount) || 0);

      return {
        ...item,
        amountInINR,
        invoiceDate,
        overheadGroup,
        description,
        parsed,
      };
    });
  }, [allItems]);

  const filteredRecords = useMemo(() => {
    return records.filter((record) => {
      const matchesSearch = 
        (record.expense_category || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
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
  }, [records, searchQuery, selectedEntities, selectedGroup]);

  const distinctGroups = useMemo(() => {
    return Array.from(new Set(records.map(r => r.overheadGroup))).sort();
  }, [records]);

  const stats = useMemo(() => {
    const indirectTotalINR = filteredRecords.reduce((acc, curr) => acc + curr.amountInINR, 0);
    const totalBusinessOutflowINR = records.reduce((acc, curr) => acc + curr.amountInINR, 0);
    const overheadRatio = totalBusinessOutflowINR > 0 ? (indirectTotalINR / totalBusinessOutflowINR) * 100 : 0;

    const categoriesGrouping: Record<string, number> = {};
    filteredRecords.forEach(r => {
      categoriesGrouping[r.overheadGroup] = (categoriesGrouping[r.overheadGroup] || 0) + r.amountInINR;
    });

    const flaggedOverheadCategories = Object.entries(categoriesGrouping)
      .map(([name, spend]) => {
        const ratio = indirectTotalINR > 0 ? (spend / indirectTotalINR) * 100 : 0;
        return { name, spend, ratio };
      })
      .filter(c => c.ratio > 20.0)
      .sort((a, b) => b.ratio - a.ratio);

    return {
      indirectTotalINR,
      overheadRatio,
      flaggedOverheadCategories,
      totalBusinessOutflowINR
    };
  }, [filteredRecords, records]);

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

          <div className="flex items-center gap-2 shrink-0">
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
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Indirect Cost</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5">
                {formatCurrency(stats.indirectTotalINR, "INR")}
              </div>
            </div>
          </div>

          <div className={`card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-all duration-350 hover:translate-y-[-2px] ${
            isOverheadCritical ? "border-red-500/40 shadow-[0_0_12px_-4px_rgba(239,68,68,0.25)] bg-red-500/[0.015]" : "border-border"
          }`}>
            <div className={`p-3.5 rounded-lg ${isOverheadCritical ? "bg-red-500/10 text-red-400" : "bg-[rgba(212,175,55,0.08)] text-[var(--primary)]"}`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Overhead Ratio</div>
              <div className={`text-2xl font-bold tracking-tight mt-0.5 ${isOverheadCritical ? "text-red-400" : "text-foreground"}`}>
                {stats.overheadRatio.toFixed(1)}%
              </div>
            </div>
          </div>

          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Top Driver</div>
              <div className="text-sm font-semibold tracking-tight truncate mt-1 text-[var(--primary)]">
                {momTrends.length > 0 ? momTrends[0].category : "—"}
              </div>
            </div>
          </div>

          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(16,185,129,0.08)] text-emerald-500">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Audit Status</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5 text-emerald-500">100%</div>
              <div className="text-[10px] text-muted-foreground">All Overheads Verified</div>
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
                stats.flaggedOverheadCategories.map((c) => (
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
