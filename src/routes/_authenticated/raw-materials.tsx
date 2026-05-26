import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { 
  Package, 
  Search, 
  Loader2, 
  TrendingUp, 
  DollarSign, 
  Filter, 
  FileSpreadsheet, 
  ChevronRight, 
  Boxes,
  Truck,
  Building2,
  Calendar,
  Layers,
  Percent
} from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { formatCurrency } from "@/lib/currency";
import { getRateToINR } from "@/lib/fx";
import { cleanVendorName } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/raw-materials")({
  component: RawMaterialsPage,
  head: () => ({
    meta: [{ title: "Raw Materials — FinStream" }],
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

// Utility to parse description into nature and rate
function parseRawMaterialDesc(rawText: string | null) {
  if (!rawText) return { nature: "Raw Material", rate: "—", cleanNature: "Raw Material", pureRateNum: 0, unit: "" };
  
  // Format usually looks like "Raw material · Precipitated Calcium Carbonate @ ₹12/kg" or "Raw material · Packaging boxes @ ₹3.96/box"
  const parts = rawText.split(/\s*[-·•/]\s*/);
  let content = rawText;
  
  // If first part is "Raw material", grab the rest
  if (parts.length > 1 && parts[0].toLowerCase().includes("raw")) {
    content = parts.slice(1).join(" · ").trim();
  }

  const atIndex = content.indexOf("@");
  if (atIndex !== -1) {
    const nature = content.substring(0, atIndex).trim();
    const rate = content.substring(atIndex + 1).trim();
    
    // Parse pure numeric rate for calculations
    const rateNumMatch = rate.replace(/,/g, "").match(/([\d.]+)/);
    const pureRateNum = rateNumMatch ? parseFloat(rateNumMatch[1]) : 0;
    
    // Extract unit like "/kg" or "/box"
    const unitPart = rate.includes("/") ? "/" + rate.split("/")[1].trim() : "";
    
    return { 
      nature, 
      rate: `₹${rate.replace(/[^\d./]/g, "")}`, 
      cleanNature: nature.replace(/\b(raw material|boxes|chemicals)\b/gi, "").trim(),
      pureRateNum,
      unit: unitPart
    };
  }

  return { 
    nature: content, 
    rate: "—", 
    cleanNature: content.replace(/\b(raw material|boxes|chemicals)\b/gi, "").trim(),
    pureRateNum: 0,
    unit: "" 
  };
}

function RawMaterialsPage() {
  const { user } = useAuth();
  const { currency: displayCurrency } = useCurrency();
  const navigate = useNavigate();
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<string>("all");
  const [selectedMaterial, setSelectedMaterial] = useState<string>("all");

  const loadRawMaterials = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("date", { ascending: false });
    
    // Filter specifically for Raw material expenses
    const rawMaterialExpenses = (data ?? []).filter(
      (item) => item.expense_category === "Raw material" || item.category === "Raw material" || (item.raw_text && item.raw_text.toLowerCase().includes("raw material"))
    );
    
    setItems(rawMaterialExpenses as Expense[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    loadRawMaterials();

    const channel = supabase
      .channel("raw_materials_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "expenses" },
        () => {
          loadRawMaterials();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Parse items into full raw material records
  const rawMaterialRecords = useMemo(() => {
    return items.map((item) => {
      const { nature, rate, cleanNature, pureRateNum, unit } = parseRawMaterialDesc(item.raw_text);
      const invoiceDate = item.date ? new Date(item.date) : new Date(item.created_at);
      const fxRate = getRateToINR(item.currency, invoiceDate);
      const amountInINR = item.amount * fxRate;
      
      // Calculate parsed volume if rate is present
      const estimatedVolume = pureRateNum > 0 ? Math.round(amountInINR / pureRateNum) : null;

      return {
        ...item,
        nature,
        rate,
        cleanNature,
        pureRateNum,
        unit,
        amountInINR,
        estimatedVolume,
        invoiceDate
      };
    });
  }, [items]);

  // Distinct material natures list for filter dropdown
  const distinctNatures = useMemo(() => {
    const natures = rawMaterialRecords.map(r => r.nature).filter(Boolean);
    return Array.from(new Set(natures));
  }, [rawMaterialRecords]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return rawMaterialRecords.filter((record) => {
      const matchesSearch = 
        record.nature.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (record.vendor && record.vendor.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (record.raw_text && record.raw_text.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesEntity = 
        selectedEntity === "all" || 
        record.company_entity?.toUpperCase() === selectedEntity.toUpperCase();

      const matchesMaterial =
        selectedMaterial === "all" ||
        record.nature === selectedMaterial;

      return matchesSearch && matchesEntity && matchesMaterial;
    });
  }, [rawMaterialRecords, searchQuery, selectedEntity, selectedMaterial]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalINR = filteredRecords.reduce((acc, curr) => acc + curr.amountInINR, 0);
    const uniqueVendors = new Set(filteredRecords.map(r => r.vendor).filter(Boolean)).size;
    const totalVolume = filteredRecords.reduce((acc, curr) => acc + (curr.estimatedVolume ?? 0), 0);
    
    // Group by material nature to find most expensive material type
    const grouping: Record<string, number> = {};
    filteredRecords.forEach(r => {
      grouping[r.nature] = (grouping[r.nature] || 0) + r.amountInINR;
    });
    
    let maxMaterial = "—";
    let maxSpent = 0;
    Object.entries(grouping).forEach(([nature, spent]) => {
      if (spent > maxSpent) {
        maxSpent = spent;
        maxMaterial = nature;
      }
    });

    return {
      totalINR,
      uniqueVendors,
      totalVolume,
      maxMaterial,
      maxSpent
    };
  }, [filteredRecords]);

  // Grouped cards displaying detailed analytics for each distinct material nature
  const materialSummaries = useMemo(() => {
    const summaryMap: Record<string, {
      nature: string;
      totalSpent: number;
      purchasesCount: number;
      rates: { rateStr: string; pureRate: number; unit: string; date: Date }[];
      vendors: Set<string>;
      totalVolume: number;
      entityShares: Record<string, number>;
    }> = {};

    rawMaterialRecords.forEach((record) => {
      const key = record.nature;
      if (!summaryMap[key]) {
        summaryMap[key] = {
          nature: record.nature,
          totalSpent: 0,
          purchasesCount: 0,
          rates: [],
          vendors: new Set(),
          totalVolume: 0,
          entityShares: {}
        };
      }

      const entry = summaryMap[key];
      entry.totalSpent += record.amountInINR;
      entry.purchasesCount += 1;
      if (record.pureRateNum > 0) {
        entry.rates.push({
          rateStr: record.rate,
          pureRate: record.pureRateNum,
          unit: record.unit,
          date: record.invoiceDate
        });
      }
      if (record.vendor) {
        entry.vendors.add(cleanVendorName(record.vendor));
      }
      if (record.estimatedVolume) {
        entry.totalVolume += record.estimatedVolume;
      }
      if (record.company_entity) {
        entry.entityShares[record.company_entity] = (entry.entityShares[record.company_entity] || 0) + record.amountInINR;
      }
    });

    return Object.values(summaryMap).map(summary => {
      // Sort rates by invoice date to find newest & trends
      const sortedRates = [...summary.rates].sort((a, b) => b.date.getTime() - a.date.getTime());
      const latestRate = sortedRates[0]?.rateStr || "—";
      const avgRate = sortedRates.length > 0 
        ? Math.round(sortedRates.reduce((acc, c) => acc + c.pureRate, 0) / sortedRates.length) 
        : 0;
      const unit = sortedRates[0]?.unit || "";

      return {
        ...summary,
        latestRate,
        avgRate: avgRate > 0 ? `₹${avgRate}${unit}` : "—",
        primaryVendor: Array.from(summary.vendors)[0] || "—",
        ratesCount: summary.rates.length
      };
    }).sort((a, b) => b.totalSpent - a.totalSpent);

  }, [rawMaterialRecords]);

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
              <span className="text-[10px] uppercase tracking-widest text-[var(--primary)] font-semibold">Raw Material Analytics</span>
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <Package className="w-8 h-8 text-[var(--primary)]" />
              Raw Materials Portal
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Secure ledger extraction, manufacturing price logs, and rate audits direct from invoices.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={loadRawMaterials}
              className="text-xs border-[rgba(212,175,55,0.3)] hover:bg-[var(--sidebar-accent)]/20"
            >
              <Layers className="w-3.5 h-3.5 mr-1.5 text-[var(--primary)]" />
              Reload Ledger
            </Button>
          </div>
        </header>

        {/* Stats Grid */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {/* Card 1: Total Spent */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Total Material Cost</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5">
                {formatCurrency(stats.totalINR, "INR")}
              </div>
            </div>
          </div>

          {/* Card 2: Material Types */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Material Categories</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5">
                {distinctNatures.length} <span className="text-xs text-muted-foreground font-normal">Active Types</span>
              </div>
            </div>
          </div>

          {/* Card 3: Supply Chain */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <Truck className="w-6 h-6" />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Audited Suppliers</div>
              <div className="text-2xl font-bold tracking-tight mt-0.5">
                {stats.uniqueVendors} <span className="text-xs text-muted-foreground font-normal">Vendors</span>
              </div>
            </div>
          </div>

          {/* Card 4: Top Inflow */}
          <div className="card-luxury p-5 rounded-xl bg-card border flex items-center gap-4 transition-transform hover:translate-y-[-2px]">
            <div className="p-3.5 rounded-lg bg-[rgba(212,175,55,0.08)] text-[var(--primary)]">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Top Spent Category</div>
              <div className="text-sm font-semibold tracking-tight truncate mt-1 text-[var(--primary)]">
                {stats.maxMaterial}
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {formatCurrency(stats.maxSpent, "INR")} total spent
              </div>
            </div>
          </div>
        </section>

        {/* Dynamic Material Summary Showcases */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold tracking-tight mb-4 text-foreground flex items-center gap-2">
            <Layers className="w-4 h-4 text-[var(--primary)]" />
            Procurement Catalog & Audited Prices
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {loading ? (
              <div className="col-span-full h-32 flex items-center justify-center border rounded-lg border-dashed bg-card/20">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--primary)] mr-2" />
                <span className="text-sm text-muted-foreground">Analyzing raw material records...</span>
              </div>
            ) : materialSummaries.length === 0 ? (
              <div className="col-span-full h-32 flex flex-col items-center justify-center border rounded-lg border-dashed bg-card/20 text-center p-6">
                <Package className="w-8 h-8 text-muted-foreground/40 mb-2" />
                <span className="text-sm font-medium text-foreground">No raw materials recorded in ledger</span>
                <span className="text-xs text-muted-foreground mt-0.5">Upload a manufacturer bill or receipt marked as Raw Material to index.</span>
              </div>
            ) : (
              materialSummaries.map((summary) => {
                const totalINR = summary.totalSpent;
                const percentage = stats.totalINR > 0 ? (totalINR / stats.totalINR) * 100 : 0;
                
                return (
                  <div 
                    key={summary.nature}
                    className="card-luxury p-5 rounded-xl border bg-card flex flex-col justify-between transition-all duration-300 hover:shadow-[0_12px_24px_-10px_rgba(212,175,55,0.12)]"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold text-sm tracking-tight text-foreground truncate min-w-0">
                          {summary.nature}
                        </h3>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[rgba(212,175,55,0.08)] text-[var(--primary)] shrink-0">
                          {summary.purchasesCount} Invoice{summary.purchasesCount > 1 ? "s" : ""}
                        </span>
                      </div>
                      
                      <div className="mt-4 space-y-2">
                        {/* Latest audited rate */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Percent className="w-3.5 h-3.5 text-[var(--primary)]/60" /> Latest Audited Rate
                          </span>
                          <span className="font-semibold text-foreground">{summary.latestRate}</span>
                        </div>

                        {/* Average rate */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <TrendingUp className="w-3.5 h-3.5 text-[var(--primary)]/60" /> Average Logged Rate
                          </span>
                          <span className="font-semibold text-foreground">{summary.avgRate}</span>
                        </div>

                        {/* Estimated volume */}
                        {summary.totalVolume > 0 && (
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Boxes className="w-3.5 h-3.5 text-[var(--primary)]/60" /> Total Est. Volume
                            </span>
                            <span className="font-semibold text-foreground">
                              {summary.totalVolume.toLocaleString()} {summary.nature.toLowerCase().includes("box") ? "boxes" : "kg"}
                            </span>
                          </div>
                        )}

                        {/* Primary Vendor */}
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Truck className="w-3.5 h-3.5 text-[var(--primary)]/60" /> Primary Supplier
                          </span>
                          <span className="font-semibold text-foreground truncate max-w-[120px]">{summary.primaryVendor}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 border-t border-[rgba(212,175,55,0.1)] pt-4">
                      <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1.5">
                        <span>Total Purchases Cost</span>
                        <span>{formatCurrency(summary.totalSpent, "INR")}</span>
                      </div>
                      
                      {/* Gold Progress Bar */}
                      <div className="h-1.5 w-full bg-[rgba(212,175,55,0.06)] rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-gradient-to-r from-[rgba(212,175,55,0.6)] to-[var(--primary)] rounded-full transition-all duration-500" 
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <div className="text-[9px] text-muted-foreground mt-1 text-right">
                        {percentage.toFixed(1)}% of raw materials budget
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        {/* Procurement List / Ledger Grid */}
        <section className="card-luxury rounded-xl border bg-card flex-1 flex flex-col min-h-[400px]">
          {/* Filtering Header bar */}
          <div className="p-5 border-b border-[rgba(212,175,55,0.18)] flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[rgba(212,175,55,0.01)]">
            <h3 className="font-semibold text-sm tracking-tight text-foreground flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[var(--primary)]" />
              Procurement Audit Log ({filteredRecords.length} records)
            </h3>
            
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Search */}
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

              {/* Entity Filter */}
              <div className="flex items-center border border-[rgba(212,175,55,0.2)] rounded-md px-2.5 bg-card h-8">
                <Filter className="w-3 h-3 text-muted-foreground mr-2 shrink-0" />
                <select
                  value={selectedEntity}
                  onChange={(e) => setSelectedEntity(e.target.value)}
                  className="text-xs bg-transparent text-foreground border-none outline-none pr-4 font-medium"
                >
                  <option value="all">All Entities</option>
                  <option value="KS">KS</option>
                  <option value="TI">TI</option>
                  <option value="CPM">CPM</option>
                  <option value="AAS">AAS</option>
                </select>
              </div>

              {/* Material Nature Filter */}
              <div className="flex items-center border border-[rgba(212,175,55,0.2)] rounded-md px-2.5 bg-card h-8">
                <Package className="w-3 h-3 text-muted-foreground mr-2 shrink-0" />
                <select
                  value={selectedMaterial}
                  onChange={(e) => setSelectedMaterial(e.target.value)}
                  className="text-xs bg-transparent text-foreground border-none outline-none pr-4 font-medium max-w-[150px]"
                >
                  <option value="all">All Materials</option>
                  {distinctNatures.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-x-auto min-w-full">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin text-[var(--primary)] mb-2" />
                <span className="text-xs">Analyzing procurement tables...</span>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center text-muted-foreground text-center p-6">
                <Boxes className="w-8 h-8 text-muted-foreground/30 mb-2" />
                <span className="text-xs font-semibold text-foreground">No matches found</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">Try refining your search terms or entity filters.</span>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[rgba(212,175,55,0.15)] bg-[rgba(212,175,55,0.02)] text-muted-foreground text-[10px] uppercase tracking-wider font-semibold">
                    <th className="py-3.5 px-5">Date</th>
                    <th className="py-3.5 px-5">Material Nature</th>
                    <th className="py-3.5 px-5">Audited Rate</th>
                    <th className="py-3.5 px-5">Supplier</th>
                    <th className="py-3.5 px-5 text-center">Entity</th>
                    <th className="py-3.5 px-5 text-right">Est. Volume</th>
                    <th className="py-3.5 px-5 text-right">Amount (Original)</th>
                    <th className="py-3.5 px-5 text-right">Amount (INR)</th>
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
                      <td className="py-4 px-5 whitespace-nowrap text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-[var(--primary)]/60" />
                          {format(record.invoiceDate, "dd-MMM-yy")}
                        </div>
                      </td>

                      {/* Material Nature */}
                      <td className="py-4 px-5 font-semibold text-foreground max-w-[200px] truncate">
                        {record.nature}
                      </td>

                      {/* Audited Rate */}
                      <td className="py-4 px-5 whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-[rgba(212,175,55,0.06)] text-[var(--primary)] border border-[rgba(212,175,55,0.15)]">
                          {record.rate}
                        </span>
                      </td>

                      {/* Supplier */}
                      <td className="py-4 px-5 text-foreground max-w-[150px] truncate font-medium">
                        {cleanVendorName(record.vendor)}
                      </td>

                      {/* Entity */}
                      <td className="py-4 px-5 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-semibold tracking-wider uppercase ${
                          record.company_entity && record.company_entity !== "None"
                            ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] border border-[rgba(212,175,55,0.3)] shadow-sm"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {record.company_entity || "None"}
                        </span>
                      </td>

                      {/* Est. Volume */}
                      <td className="py-4 px-5 text-right font-semibold text-foreground whitespace-nowrap">
                        {record.estimatedVolume ? (
                          <>
                            {record.estimatedVolume.toLocaleString()}{" "}
                            <span className="text-[9px] text-muted-foreground font-normal">
                              {record.nature.toLowerCase().includes("box") ? "boxes" : "kg"}
                            </span>
                          </>
                        ) : (
                          <span className="text-muted-foreground font-normal">—</span>
                        )}
                      </td>

                      {/* Amount Original */}
                      <td className="py-4 px-5 text-right font-medium text-muted-foreground whitespace-nowrap">
                        {formatCurrency(record.amount, record.currency)}
                      </td>

                      {/* Amount INR */}
                      <td className="py-4 px-5 text-right font-bold text-foreground whitespace-nowrap">
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
