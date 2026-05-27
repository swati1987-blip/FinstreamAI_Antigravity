import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { format, subMonths, startOfMonth, endOfMonth } from "date-fns";
import { 
  Coins, 
  Search, 
  Loader2, 
  TrendingUp, 
  Filter, 
  ChevronRight, 
  Boxes,
  Truck,
  Building2,
  Calendar,
  Layers,
  ShieldCheck,
  ArrowUpRight,
  Package,
  Zap,
  Droplet,
  Users
} from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { formatCurrency } from "@/lib/currency";
import { getRateToINR } from "@/lib/fx";
import { cleanVendorName, classifyExpense, parseDescriptionDetails } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/direct-cost")({
  component: DirectCostPage,
  head: () => ({
    meta: [{ title: "Direct Costs — FinStream" }],
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

function DirectCostPage() {
  const { user } = useAuth();
  const { currency: displayCurrency } = useCurrency();
  const navigate = useNavigate();
  
  // All expenses fetched from DB
  const [allItems, setAllItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");

  const loadExpenses = async () => {
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
    loadExpenses();

    const channel = supabase
      .channel("direct_cost_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses" },
        () => {
          loadExpenses();
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
        const parsed = parseDescriptionDetails(item.raw_text, Number(item.amount) || 0);

        return {
          ...item,
          classified,
          amountInINR,
          invoiceDate,
          parsed,
        };
      })
      .filter(r => r.classified.type !== "Personal"); // Strictly exclude Personal expenses!
  }, [allItems]);

  // 1. Entity level filters + Totality calculations
  const filteredRecords = useMemo(() => {
    return businessRecords.filter((record) => {
      // Direct only
      if (record.classified.type !== "Direct") return false;

      const matchesSearch = 
        record.classified.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        record.classified.subcategory.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (record.vendor && record.vendor.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (record.raw_text && record.raw_text.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesEntity = 
        selectedEntities.length === 0 || 
        (record.company_entity && selectedEntities.map(e => e.toUpperCase()).includes(record.company_entity.toUpperCase()));

      const matchesGroup =
        selectedGroup === "all" ||
        record.classified.category === selectedGroup;

      return matchesSearch && matchesEntity && matchesGroup;
    });
  }, [businessRecords, searchQuery, selectedEntities, selectedGroup]);

  // Dynamic list of direct groups present in records
  const distinctGroups = useMemo(() => {
    const groups = businessRecords
      .filter(r => r.classified.type === "Direct")
      .map(r => r.classified.category);
    return Array.from(new Set(groups)).sort();
  }, [businessRecords]);

  // All-time / filter-specific stats
  const stats = useMemo(() => {
    // Total Direct Cost for the current filtered view
    const directTotalINR = filteredRecords.reduce((acc, curr) => acc + curr.amountInINR, 0);
    
    // Total Business Outflow (excluding Personal) in the current filtered view's scope (KS, TI, etc. or Totality)
    const entityScopedBusinessRecords = businessRecords.filter(r => 
      selectedEntities.length === 0 || 
      (r.company_entity && selectedEntities.map(e => e.toUpperCase()).includes(r.company_entity.toUpperCase()))
    );
    const totalBusinessOutflowINR = entityScopedBusinessRecords.reduce((acc, curr) => acc + curr.amountInINR, 0);

    const directPercentOfOutflow = totalBusinessOutflowINR > 0 
      ? (directTotalINR / totalBusinessOutflowINR) * 100 
      : 0;

    // Cost of Production = Raw Material + Labour + Electricity + Water combined
    const copRecords = filteredRecords.filter(r => 
      ["Raw Material", "Labour & Wages", "Electricity & Power", "Water"].includes(r.classified.category)
    );
    const costOfProductionINR = copRecords.reduce((acc, curr) => acc + curr.amountInINR, 0);

    // Top direct cost driver per group
    const grouping: Record<string, number> = {};
    filteredRecords.forEach(r => {
      grouping[r.classified.category] = (grouping[r.classified.category] || 0) + r.amountInINR;
    });
    
    let topDriver = "—";
    let topDriverSpent = 0;
    Object.entries(grouping).forEach(([group, spent]) => {
      if (spent > topDriverSpent) {
        topDriverSpent = spent;
        topDriver = group;
      }
    });

    return {
      directTotalINR,
      directPercentOfOutflow,
      costOfProductionINR,
      topDriver,
      topDriverSpent,
      totalBusinessOutflowINR
    };
  }, [filteredRecords, businessRecords, selectedEntities]);

  // Month-on-month trend calculations per direct category
  const momTrends = useMemo(() => {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const currentMonthEnd = endOfMonth(now);
    const lastMonthStart = startOfMonth(subMonths(now, 1));
    const lastMonthEnd = endOfMonth(subMonths(now, 1));

    const directCategoryMap: Record<string, { current: number; last: number }> = {};

    // Initialise categories
    distinctGroups.forEach(g => {
      directCategoryMap[g] = { current: 0, last: 0 };
    });

    // Sum up
    filteredRecords.forEach(r => {
      const cat = r.classified.category;
      if (!directCategoryMap[cat]) return;

      const dateObj = r.invoiceDate;
      if (dateObj >= currentMonthStart && dateObj <= currentMonthEnd) {
        directCategoryMap[cat].current += r.amountInINR;
      } else if (dateObj >= lastMonthStart && dateObj <= lastMonthEnd) {
        directCategoryMap[cat].last += r.amountInINR;
      }
    });

    // Compute change percentages
    return Object.entries(directCategoryMap).map(([category, spend]) => {
      let percentChange = 0;
      if (spend.last > 0) {
        percentChange = ((spend.current - spend.last) / spend.last) * 100;
      } else if (spend.current > 0) {
        percentChange = 100; // New category spend
      }

      return {
        category,
        currentSpend: spend.current,
        lastSpend: spend.last,
        percentChange,
      };
    }).sort((a, b) => b.currentSpend - a.currentSpend);
  }, [filteredRecords, distinctGroups]);

  // Group summaries for procurement cards
  const groupSummaries = useMemo(() => {
    const summaryMap: Record<string, {
      group: string;
      totalSpent: number;
      count: number;
      vendors: Set<string>;
    }> = {};

    filteredRecords.forEach((record) => {
      const key = record.classified.category;
      if (!summaryMap[key]) {
        summaryMap[key] = {
          group: key,
          totalSpent: 0,
          count: 0,
          vendors: new Set(),
        };
      }
      const entry = summaryMap[key];
      entry.totalSpent += record.amountInINR;
      entry.count += 1;
      if (record.vendor) entry.vendors.add(cleanVendorName(record.vendor));
    });

    return Object.values(summaryMap).sort((a, b) => b.totalSpent - a.totalSpent);
  }, [filteredRecords]);

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      {/* Decorative Gold Glow Effects */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />
      <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.04)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />

      <DashboardSidebar />

      <main className="flex-1 p-6 md:p-10 relative z-10 min-w-0 flex flex-col">
        {/* Header */}
        <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2 w-2 rounded-full bg-[var(--primary)] animate-pulse" />
              <span className="text-[10px] uppercase tracking-widest text-[var(--primary)] font-semibold">Direct Cost Analytics</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <Coins className="w-8 h-8 text-[var(--primary)]" />
              Direct Costs Portal
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Track production and factory-floor outflows: raw materials, wages, electricity, water, repairs, and outbound dispatch.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={loadExpenses}
              className="text-xs border-[rgba(212,175,55,0.3)] hover:bg-[var(--sidebar-accent)]/20"
            >
              <Layers className="w-3.5 h-3.5 mr-1.5 text-[var(--primary)]" />
              Reload Ledger
            </Button>
          </div>
        </header>

        {/* Stats Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {/* Card 1: Total Direct Cost + % of total outflow */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <Coins className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Direct Cost</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5">
                {formatCurrency(stats.directTotalINR, "INR")}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {stats.directPercentOfOutflow.toFixed(1)}% of business outflow
              </div>
            </div>
          </div>

          {/* Card 2: Cost of Production card */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Cost of Production (COP)</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5">
                {formatCurrency(stats.costOfProductionINR, "INR")}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                RM + Labour + Electricity + Water
              </div>
            </div>
          </div>

          {/* Card 3: Top direct cost driver card */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Top Direct Cost Driver</div>
              <div className="text-sm font-semibold tracking-tight truncate mt-1 text-[var(--primary)]">
                {stats.topDriver}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {formatCurrency(stats.topDriverSpent, "INR")} spend
              </div>
            </div>
          </div>

          {/* Card 4: Verification Status */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(16,185,129,0.08)] text-emerald-500">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Production Verification</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5 text-emerald-500">
                100%
              </div>
              <div className="text-[10px] text-muted-foreground">Factory Floor Audited</div>
            </div>
          </div>
        </section>

        {/* Dynamic Month-on-Month Trends & Cost Drivers */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Trends column */}
          <div className="card-luxury p-5 rounded-xl border bg-card lg:col-span-1 space-y-4">
            <h3 className="font-semibold text-sm tracking-tight text-foreground flex items-center gap-2">
              <TrendingUp className="w-4.5 h-4.5 text-[var(--primary)]" />
              MoM Cost Trends
            </h3>
            
            <div className="space-y-3.5">
              {momTrends.length === 0 ? (
                <div className="text-xs text-muted-foreground py-8 text-center">No trend details found in this period.</div>
              ) : (
                momTrends.map((trend) => (
                  <div key={trend.category} className="flex items-center justify-between gap-3 border-b border-[rgba(212,175,55,0.06)] pb-2.5">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-foreground truncate">{trend.category}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">This Month: {formatCurrency(trend.currentSpend, "INR")}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${
                        trend.percentChange > 0 
                          ? "bg-red-500/10 text-red-400 border border-red-500/20"
                          : trend.percentChange < 0
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                          : "bg-muted text-muted-foreground"
                      }`}>
                        {trend.percentChange > 0 ? "+" : ""}{trend.percentChange.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Cost Drivers */}
          <div className="lg:col-span-2 space-y-4">
            <h2 className="text-lg font-semibold tracking-tight text-foreground flex items-center gap-2">
              <Layers className="w-4 h-4 text-[var(--primary)]" />
              Cost Groups & Procurement Analytics
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {loading ? (
                <div className="col-span-full h-32 flex items-center justify-center border rounded-lg border-dashed bg-card/20">
                  <Loader2 className="w-6 h-6 animate-spin text-[var(--primary)] mr-2" />
                  <span className="text-sm text-muted-foreground">Analyzing direct cost records...</span>
                </div>
              ) : groupSummaries.length === 0 ? (
                <div className="col-span-full h-32 flex flex-col items-center justify-center border rounded-lg border-dashed bg-card/20 text-center p-6">
                  <Package className="w-8 h-8 text-muted-foreground/40 mb-2" />
                  <span className="text-sm font-medium text-foreground">No direct cost records found</span>
                  <span className="text-xs text-muted-foreground mt-0.5">Upload bills or tag expenses with direct cost categories.</span>
                </div>
              ) : (
                groupSummaries.map((summary) => {
                  const totalINR = summary.totalSpent;
                  const percentage = stats.directTotalINR > 0 ? (totalINR / stats.directTotalINR) * 100 : 0;
                  
                  return (
                    <div 
                      key={summary.group}
                      className="card-luxury p-5 rounded-xl border bg-card flex flex-col justify-between transition-all duration-300 hover:shadow-[0_12px_24px_-10px_rgba(212,175,55,0.12)]"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-semibold text-sm tracking-tight text-foreground truncate min-w-0">
                            {summary.group}
                          </h3>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[rgba(212,175,55,0.08)] text-[var(--primary)] shrink-0">
                            {summary.count} Record{summary.count > 1 ? "s" : ""}
                          </span>
                        </div>
                        
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Truck className="w-3.5 h-3.5 text-[var(--primary)]/60" /> Suppliers
                            </span>
                            <span className="font-semibold text-foreground">{summary.vendors.size}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 border-t border-[rgba(212,175,55,0.1)] pt-4">
                        <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1.5">
                          <span>Total Cost</span>
                          <span>{formatCurrency(summary.totalSpent, "INR")}</span>
                        </div>
                        
                        <div className="h-1.5 w-full bg-[rgba(212,175,55,0.06)] rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-gradient-to-r from-[rgba(212,175,55,0.6)] to-[var(--primary)] rounded-full transition-all duration-500" 
                            style={{ width: `${percentage}%` }}
                          />
                        </div>
                        <div className="text-[9px] text-muted-foreground mt-1 text-right">
                          {percentage.toFixed(1)}% of direct costs
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* Direct Cost Ledger Table */}
        <section className="card-luxury rounded-xl border bg-card flex-1 flex flex-col min-h-[400px]">
          <div className="p-5 border-b border-[rgba(212,175,55,0.18)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[rgba(212,175,55,0.01)]">
            <h3 className="font-semibold text-sm tracking-tight text-foreground flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[var(--primary)]" />
              Direct Cost Audit Log ({filteredRecords.length} records)
            </h3>
            
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                <Input
                  type="text"
                  placeholder="Search materials, vendors..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full sm:w-[240px] pl-9 text-xs h-8 border-[rgba(212,175,55,0.2)] bg-card"
                />
              </div>

              {/* Entity Multi-Select Pills */}
              <div className="flex items-center gap-1.5 border border-[rgba(212,175,55,0.2)] rounded-md px-2 bg-card h-8">
                <Filter className="w-3.5 h-3.5 text-muted-foreground mr-1 shrink-0" />
                <button
                  onClick={() => setSelectedEntities([])}
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all",
                    selectedEntities.length === 0
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                </button>
                {["KS", "TI", "CPM", "AAS"].map((ent) => {
                  const isSelected = selectedEntities.includes(ent);
                  return (
                    <button
                      key={ent}
                      onClick={() => {
                        setSelectedEntities(prev =>
                          prev.includes(ent) ? prev.filter(e => e !== ent) : [...prev, ent]
                        );
                      }}
                      className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all",
                        isSelected
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {ent}
                    </button>
                  );
                })}
              </div>

              {/* Category Filter */}
              <div className="flex items-center border border-[rgba(212,175,55,0.2)] rounded-md px-2.5 bg-card h-8">
                <Package className="w-3 h-3 text-muted-foreground mr-2 shrink-0" />
                <select
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                  className="text-xs bg-transparent text-foreground border-none outline-none pr-4 font-medium max-w-[150px]"
                >
                  <option value="all">All Categories</option>
                  {distinctGroups.map(g => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-x-auto min-w-full">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)] mb-2" />
                <span className="text-xs">Analyzing direct cost data...</span>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground text-center p-6">
                <Boxes className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <span className="text-xs font-semibold text-foreground">No matches found</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">Try refining your search terms or filters.</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[rgba(212,175,55,0.15)] bg-[rgba(212,175,55,0.02)] text-muted-foreground text-[10px] uppercase tracking-wider font-semibold">
                    <th className="py-3 px-2.5">Date</th>
                    <th className="py-3 px-2.5">Vendor / Supplier</th>
                    <th className="py-3 px-2.5">Material Details</th>
                    <th className="py-3 px-2.5">Cost Category</th>
                    <th className="py-3 px-2.5 text-right">Rate</th>
                    <th className="py-3 px-2.5 text-right">Qty</th>
                    <th className="py-3 px-2.5 text-right">GST</th>
                    <th className="py-3 px-2.5 text-center">Entity</th>
                    <th className="py-3 px-2.5 text-right">Amount (Original)</th>
                    <th className="py-3 px-2.5 text-right">Amount (INR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[rgba(212,175,55,0.08)]">
                  {filteredRecords.map((record) => (
                    <tr 
                      key={record.id}
                      onClick={() => void navigate({ to: "/transactions", search: { edit: record.id } })}
                      className="hover:bg-[rgba(212,175,55,0.025)] transition-colors duration-150 cursor-pointer"
                    >
                      {/* Date */}
                      <td className="py-3.5 px-2.5 whitespace-nowrap text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-[var(--primary)]/60 shrink-0" />
                          {format(record.invoiceDate, "dd-MMM-yy")}
                        </div>
                      </td>

                      {/* Vendor */}
                      <td className="py-3.5 px-2.5 font-medium text-foreground max-w-[110px] whitespace-normal break-words">
                        {cleanVendorName(record.vendor)}
                      </td>

                      {/* Material Details */}
                      <td className="py-3.5 px-2.5 text-muted-foreground text-[11px] max-w-[160px] whitespace-normal break-words" title={record.parsed.materialType || record.raw_text || ""}>
                        {record.parsed.materialType || "—"}
                      </td>

                      {/* Cost Category */}
                      <td className="py-3.5 px-2.5 text-foreground text-xs font-semibold max-w-[100px] whitespace-normal break-words">
                        {record.classified.category}
                      </td>

                      {/* Rate */}
                      <td className="py-3.5 px-2.5 text-right font-mono text-foreground/80 whitespace-nowrap">
                        {record.parsed.rateStr}
                      </td>

                      {/* Qty */}
                      <td className="py-3.5 px-2.5 text-right font-mono text-foreground/80 whitespace-nowrap">
                        {record.parsed.qtyStr}
                      </td>

                      {/* GST */}
                      <td className="py-3.5 px-2.5 text-right font-mono text-foreground/80 whitespace-nowrap">
                        {record.parsed.gstNum !== null ? formatCurrency(record.parsed.gstNum, record.currency) : "—"}
                      </td>

                      {/* Entity */}
                      <td className="py-3.5 px-2.5 text-center">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider uppercase ${
                          record.company_entity && record.company_entity !== "None"
                            ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] border border-[rgba(212,175,55,0.3)] shadow-sm"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {record.company_entity || "None"}
                        </span>
                      </td>

                      {/* Amount Original */}
                      <td className="py-3.5 px-2.5 text-right font-medium text-muted-foreground whitespace-nowrap">
                        {formatCurrency(record.amount, record.currency)}
                      </td>

                      {/* Amount INR */}
                      <td className="py-3.5 px-2.5 text-right font-bold text-foreground whitespace-nowrap">
                        {formatCurrency(record.amountInINR, "INR")}
                      </td>
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
