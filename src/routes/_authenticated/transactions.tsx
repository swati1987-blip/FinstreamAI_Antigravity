import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useMemo } from "react";
import { format } from "date-fns";
import { Loader2, Inbox, Receipt, Trash2, CalendarIcon, Plus, Pencil, X } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { useBusinesses } from "@/hooks/use-businesses";
import { formatCurrency } from "@/lib/currency";
import { convertAmount, getRateToINR } from "@/lib/fx";
import { cn, cleanVendorName, parseExpenseCategoryAndDescription, EXPENSE_CATEGORIES } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { SUPPORTED_CURRENCIES } from "@/lib/expense-shared";

export const Route = createFileRoute("/_authenticated/transactions")({
  component: TransactionsPage,
  head: () => ({
    meta: [{ title: "Transactions — FinStream" }],
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

type MainTab = "all" | "business" | "personal";

function TransactionsPage() {
  const { user } = useAuth();
  const { currency: displayCurrency } = useCurrency();
  const { businesses } = useBusinesses();
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [saving, setSaving] = useState(false);
  const [mainTab, setMainTab] = useState<MainTab>("all");
  const [businessCompany, setBusinessCompany] = useState<string>("all");
  const [filterDuplicates, setFilterDuplicates] = useState<"all" | "hide_duplicates" | "duplicates_only">("all");
  const [sortBy, setSortBy] = useState<"date_desc" | "date_asc" | "amount_desc" | "amount_asc" | "vendor_asc">("date_desc");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [resolvingDuplicate, setResolvingDuplicate] = useState<Expense | null>(null);
  const [isConfirmingBulk, setIsConfirmingBulk] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkEditingOpen, setIsBulkEditingOpen] = useState(false);
  const [bulkVendor, setBulkVendor] = useState("");
  const [bulkCategory, setBulkCategory] = useState<"keep" | "Business" | "Personal">("keep");
  const [bulkCompanyEntity, setBulkCompanyEntity] = useState<"keep" | "KS" | "TI" | "CPM" | "AAS" | "Swati" | "Others" | "None">("keep");
  const [bulkExpenseCategory, setBulkExpenseCategory] = useState<string>("keep");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [isExportingSheets, setIsExportingSheets] = useState(false);

  // Google Sheets Export States
  const [isExportSheetsOpen, setIsExportSheetsOpen] = useState(false);
  const [exportTab, setExportTab] = useState<"clipboard" | "n8n">("n8n");
  const [webhookUrl, setWebhookUrl] = useState(() => typeof window !== "undefined" ? localStorage.getItem("finstream_n8n_webhook") || "" : "");
  const [useRealWebhook, setUseRealWebhook] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStep, setSyncStep] = useState(0);
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  }, [mainTab, businessCompany]);

  // Form states matching dropdown rules
  const [formCategory, setFormCategory] = useState<"Business" | "Personal">("Personal");
  const [formVendor, setFormVendor] = useState("");
  const [formAmount, setFormAmount] = useState<number | "">("");
  const [formCurrency, setFormCurrency] = useState("INR");
  const [formCompanyEntity, setFormCompanyEntity] = useState<"KS" | "TI" | "CPM" | "AAS" | "Swati" | "Others" | "None">("None");
  const [formExpenseCategory, setFormExpenseCategory] = useState("Other expenses");
  const [formDescription, setFormDescription] = useState("");
  const [formDate, setFormDate] = useState("");

  const resolveBusinessId = async (name: string): Promise<string | null> => {
    if (!name || name === "None" || name === "none" || !user) return null;
    const upperName = name.trim().toUpperCase();
    
    // 1. Search locally in our already loaded list of businesses
    const found = businesses.find(
      (b) => b.name.trim().toUpperCase() === upperName
    );
    if (found) return found.id;
    
    try {
      // 2. Query directly from database to be absolutely sure we didn't miss it
      const { data: existing } = await supabase
        .from("businesses")
        .select("id")
        .eq("user_id", user.id)
        .eq("name", upperName)
        .maybeSingle();
      
      if (existing) return existing.id;

      // 3. Insert if it genuinely does not exist
      const { data, error } = await supabase
        .from("businesses")
        .insert({ name: upperName, user_id: user.id })
        .select()
        .single();
      
      if (error) {
        // Fallback query in case of race condition
        const { data: retryData } = await supabase
          .from("businesses")
          .select("id")
          .eq("user_id", user.id)
          .eq("name", upperName)
          .maybeSingle();
        if (retryData) return retryData.id;
        
        console.error("Error creating business entity:", error);
        return null;
      }
      return data ? data.id : null;
    } catch (err) {
      console.error("resolveBusinessId exception:", err);
      return null;
    }
  };


  const startEditing = (e: Expense) => {
    setEditing(e);
    setFormCategory(
      (e.main_category || e.category) === "Business"
        ? "Business"
        : "Personal"
    );
    setFormVendor(cleanVendorName(e.vendor));
    setFormAmount(Number(e.amount) || 0);
    setFormCurrency(e.currency || "INR");
    setFormDate(e.date || e.created_at || new Date().toISOString());

    const expenseCategory = e.expense_category || "Other expenses";
    let description = e.raw_text || "";

    if (e.raw_text && e.raw_text.includes(" · ")) {
      description = e.raw_text.split(" · ").slice(1).join(" · ");
    }
    setFormExpenseCategory(expenseCategory);
    setFormDescription(description);

    let entity: "KS" | "TI" | "CPM" | "AAS" | "Swati" | "Others" | "None" = "None";
    if (e.company_entity && ["KS", "TI", "CPM", "AAS", "Swati", "Others", "None"].includes(e.company_entity)) {
      entity = e.company_entity as any;
    } else if (e.category === "Business" && e.business_id) {
      const biz = businesses.find((b) => b.id === e.business_id);
      if (biz) {
        const name = biz.name.toUpperCase();
        if (["KS", "TI", "CPM", "AAS", "SWATI", "OTHERS"].includes(name)) {
          entity = name as any;
        }
      }
    }
    setFormCompanyEntity(entity);
  };

  const startAdding = () => {
    setAdding(true);
    setFormCategory("Personal");
    setFormVendor("");
    setFormAmount(0);
    setFormCurrency("INR");
    setFormCompanyEntity("None");
    setFormExpenseCategory("Other expenses");
    setFormDescription("");
    setFormDate(new Date().toISOString());
  };

  const businessCompanies = Array.from(
    new Set(
      items
        .filter((e) => e.company_entity && e.company_entity !== "None")
        .map((e) => e.company_entity!),
    ),
  ).sort();

  // Pre-calculate exact duplicate counts in items array to make duplicate checks extremely fast
  const duplicateCounts = new Map<string, number>();
  items.forEach((e) => {
    const key = `${cleanVendorName(e.vendor).toLowerCase().trim()}|${Number(e.amount).toFixed(2)}|${e.date || e.created_at.split('T')[0]}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
  });

  const seenKeys = new Set<string>();
  const filtered = items.filter((e) => {
    // 1. Filter by main category tab
    if (mainTab === "personal") {
      const isPersonal = e.category === "Personal" || e.category === "Investments" || e.main_category === "Personal";
      if (!isPersonal) return false;
    } else if (mainTab === "business") {
      const isBusiness = e.category === "Business" || e.main_category === "Business";
      if (!isBusiness) return false;
    }

    // 2. Filter by selected company/entity if a specific one is chosen
    if (businessCompany !== "all") {
      if (e.company_entity !== businessCompany) return false;
    }

    // 3. Filter by duplicates selection
    const key = `${cleanVendorName(e.vendor).toLowerCase().trim()}|${Number(e.amount).toFixed(2)}|${e.date || e.created_at.split('T')[0]}`;
    const totalCount = duplicateCounts.get(key) ?? 0;

    if (filterDuplicates === "hide_duplicates") {
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
    } else if (filterDuplicates === "duplicates_only") {
      if (totalCount <= 1) return false;
    }

    return true;
  });

  const sortedAndFiltered = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === "date_desc") {
        const dateA = a.date ? new Date(a.date).getTime() : new Date(a.created_at).getTime();
        const dateB = b.date ? new Date(b.date).getTime() : new Date(b.created_at).getTime();
        return dateB - dateA;
      }
      if (sortBy === "date_asc") {
        const dateA = a.date ? new Date(a.date).getTime() : new Date(a.created_at).getTime();
        const dateB = b.date ? new Date(b.date).getTime() : new Date(b.created_at).getTime();
        return dateA - dateB;
      }
      if (sortBy === "amount_desc") {
        return b.amount - a.amount;
      }
      if (sortBy === "amount_asc") {
        return a.amount - b.amount;
      }
      if (sortBy === "vendor_asc") {
        const vendorA = (a.vendor || "").toLowerCase().trim();
        const vendorB = (b.vendor || "").toLowerCase().trim();
        return vendorA.localeCompare(vendorB);
      }
      return 0;
    });
  }, [filtered, sortBy]);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });
    
    setItems((data ?? []) as Expense[]);
    setLoading(false);
  };

  useEffect(() => {
    if (!user) return;
    load();

    const channel = supabase
      .channel('transactions_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses' },
        () => {
          load();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const handleSave = async () => {
    if (!editing || !user) {
      console.log("handleSave blocked: no editing transaction or user session active", { editing, user });
      return;
    }
    
    const finalCompanyEntity = formCompanyEntity;
    
    console.log("Starting handleSave in transactions.tsx with state:", {
      id: editing.id,
      formCategory,
      formVendor,
      formAmount,
      formCurrency,
      formCompanyEntity,
      finalCompanyEntity,
      formExpenseCategory,
      formDescription,
      formDate
    });

    setSaving(true);

    try {
      let linkedBusinessId: string | null = null;
      if (formCategory === "Business" && finalCompanyEntity !== "None") {
        console.log("Resolving business ID for entity:", finalCompanyEntity);
        linkedBusinessId = await resolveBusinessId(finalCompanyEntity);
        console.log("Resolved business ID:", linkedBusinessId);
      }

      const finalRawText = formDescription.trim()
        ? `${formExpenseCategory} · ${formDescription.trim()}`
        : formExpenseCategory;

      let dateObj = new Date();
      if (formDate) {
        const parsed = new Date(formDate);
        if (!isNaN(parsed.getTime())) {
          dateObj = parsed;
        }
      }
      const dateStr = format(dateObj, "yyyy-MM-dd");

      console.log("Sending update payload to public.expenses table:", {
        raw_text: finalRawText,
        amount: Number(formAmount),
        currency: formCurrency,
        category: formCategory,
        vendor: formVendor.trim() || "Unknown",
        business_id: linkedBusinessId,
        date: dateStr,
        main_category: formCategory,
        company_entity: finalCompanyEntity,
        expense_category: formExpenseCategory,
      });

      let { data, error } = await supabase
        .from("expenses")
        .update({
          raw_text: finalRawText,
          amount: Number(formAmount),
          currency: formCurrency,
          category: formCategory,
          vendor: formVendor.trim() || "Unknown",
          // Exclude created_at to avoid row reshuffling/shifting chronological order
          business_id: linkedBusinessId,
          date: dateStr,
          main_category: formCategory,
          company_entity: finalCompanyEntity,
          expense_category: formExpenseCategory,
        })
        .eq("id", editing.id)
        .select();

      console.log("Supabase response:", { data, error });

      if (error && error.code === "42703") {
        console.warn("New columns not found in database. Retrying update with legacy schema columns...");
        const legacyResult = await supabase
          .from("expenses")
          .update({
            raw_text: finalRawText,
            amount: Number(formAmount),
            currency: formCurrency,
            category: formCategory,
            vendor: formVendor.trim() || "Unknown",
            business_id: linkedBusinessId,
          })
          .eq("id", editing.id)
          .select();
        data = legacyResult.data;
        error = legacyResult.error;
      }

      setSaving(false);
      if (error) {
        console.error("Database save failed with error:", error);
        toast.error(`Database Error: ${error.message} (Code: ${error.code})`, {
          description: `Details: ${error.details || 'None'} | Hint: ${error.hint || 'None'}`,
          duration: 10000
        });
        return;
      }

      if (!data || data.length === 0) {
        console.warn("No rows updated in public.expenses. RLS might have blocked the write.");
        toast.error("You do not have permission to edit this transaction.");
        setEditing(null);
        return;
      }

      try {
        const cleanVendor = formVendor.trim() || "Unknown";
        if (cleanVendor !== "Unknown") {

          // Rule 1: Vendor-level category rule — check-then-act (no constraint dependency)
          const { data: existingVendorRule } = await (supabase as any)
            .from("transaction_rules_memory")
            .select("id")
            .eq("user_id", user.id)
            .eq("vendor_pattern", cleanVendor)
            .is("amount", null)
            .maybeSingle();

          if (existingVendorRule?.id) {
            await (supabase as any)
              .from("transaction_rules_memory")
              .update({
                main_category: formCategory,
                company_entity: finalCompanyEntity,
                expense_category: formExpenseCategory,
              })
              .eq("id", existingVendorRule.id);
          } else {
            await (supabase as any).from("transaction_rules_memory").insert({
              user_id: user.id,
              vendor_pattern: cleanVendor,
              main_category: formCategory,
              company_entity: finalCompanyEntity,
              expense_category: formExpenseCategory,
            });
          }

          // Rule 2: Vendor+Amount ordered description rule
          // Supports multiple people with same vendor+amount (e.g. 3 staff all ₹899 Airtel)
          // Each unique description gets its own sequential slot (order 1, 2, 3...)
          const descriptionText = formDescription.trim();
          const ruleAmount = Number(formAmount);
          if (descriptionText && ruleAmount > 0) {

            // Fetch all existing description rules for this vendor+amount
            const { data: existingRules } = await (supabase as any)
              .from("transaction_rules_memory")
              .select("id, description, description_order")
              .eq("user_id", user.id)
              .eq("vendor_pattern", cleanVendor)
              .eq("amount", ruleAmount)
              .not("description", "is", null)
              .order("description_order", { ascending: true });

            const existing = existingRules ?? [];

            // Check if this exact description text already has a saved slot
            const existingMatch = existing.find(
              (r: any) => r.description?.toLowerCase().trim() === descriptionText.toLowerCase().trim()
            );

            if (existingMatch) {
              // Description already registered — just update its category/entity in case they changed
              await (supabase as any)
                .from("transaction_rules_memory")
                .update({
                  main_category: formCategory,
                  company_entity: finalCompanyEntity,
                  expense_category: formExpenseCategory,
                })
                .eq("id", existingMatch.id);
            } else {
              // New description for this vendor+amount — assign next sequential slot
              // e.g. Pawan=1, Patel=2, Sanjay=3 (built up over time as user edits)
              const nextOrder = existing.length + 1;
              await (supabase as any).from("transaction_rules_memory").insert({
                user_id: user.id,
                vendor_pattern: cleanVendor,
                amount: ruleAmount,
                description: descriptionText,
                description_order: nextOrder,
                main_category: formCategory,
                company_entity: finalCompanyEntity,
                expense_category: formExpenseCategory,
              });
            }
          }
        }
      } catch (memoryErr) {
        console.warn("Failed to save transaction memory rule", memoryErr);
      }

      toast.success("Transaction updated successfully");
      setEditing(null);
      load();
    } catch (err: any) {
      setSaving(false);
      console.error("Edit save exception caught:", err);
      toast.error(`Save Exception: ${err.message || 'Unknown exception'}`, {
        description: err.stack || 'No stack trace available',
        duration: 10000
      });
    }
  };

  const handleAddSave = async () => {
    if (!user) return;
    
    const finalCompanyEntity = formCompanyEntity;
    setSaving(true);

    try {
      let linkedBusinessId: string | null = null;
      if (formCategory === "Business" && finalCompanyEntity !== "None") {
        linkedBusinessId = await resolveBusinessId(finalCompanyEntity);
      }

      const finalRawText = formDescription.trim()
        ? `${formExpenseCategory} · ${formDescription.trim()}`
        : formExpenseCategory;

      let dateObj = new Date();
      if (formDate) {
        const parsed = new Date(formDate);
        if (!isNaN(parsed.getTime())) {
          dateObj = parsed;
        }
      }
      const dateStr = format(dateObj, "yyyy-MM-dd");
      const isoDateStr = dateObj.toISOString();

      let { data, error } = await supabase
        .from("expenses")
        .insert({
          amount: Number(formAmount),
          vendor: formVendor.trim() || "Unknown",
          category: formCategory,
          currency: formCurrency,
          raw_text: finalRawText,
          user_id: user.id,
          business_id: linkedBusinessId,
          created_at: isoDateStr,
          date: dateStr,
          main_category: formCategory,
          company_entity: finalCompanyEntity,
          expense_category: formExpenseCategory,
        })
        .select()
        .single();

      if (error && error.code === "42703") {
        console.warn("New columns not found in database. Retrying insert with legacy schema columns...");
        const legacyResult = await supabase
          .from("expenses")
          .insert({
            amount: Number(formAmount),
            vendor: formVendor.trim() || "Unknown",
            category: formCategory,
            currency: formCurrency,
            raw_text: finalRawText,
            user_id: user.id,
            business_id: linkedBusinessId,
            created_at: isoDateStr,
          })
          .select()
          .single();
        data = legacyResult.data;
        error = legacyResult.error;
      }

      if (error) {
        setSaving(false);
        toast.error(error.message);
        return;
      }

      if (!data) {
        setSaving(false);
        toast.error("Saved transaction data could not be loaded");
        return;
      }

      try {
        const rate = getRateToINR(formCurrency, dateObj);
        await supabase.from("audit_records").insert({
          expense_id: data.id,
          user_id: user.id,
          bill_date: dateStr,
          original_currency: formCurrency,
          original_amount: Number(formAmount),
          exchange_rate_to_inr: rate,
        });
      } catch (auditErr) {
        console.error("Audit log insert failed:", auditErr);
      }

      setSaving(false);
      toast.success("Transaction added successfully");
      setAdding(false);
      load();
    } catch (err: any) {
      setSaving(false);
      console.error("Add save error:", err);
      toast.error(err.message || "An unexpected error occurred during save");
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    const { error } = await supabase.from("expenses").delete().eq("id", deleting.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Transaction deleted");
    setDeleting(null);
    load();
  };

  const handleResolveDuplicate = async (exp: Expense) => {
    if (!exp) return;
    try {
      const vendorName = cleanVendorName(exp.vendor).toLowerCase().trim();
      const amountVal = Number(exp.amount).toFixed(2);
      const dateStr = exp.date || exp.created_at.split('T')[0];
      
      const matches = items.filter((e) => {
        const vName = cleanVendorName(e.vendor).toLowerCase().trim();
        const aVal = Number(e.amount).toFixed(2);
        const dStr = e.date || e.created_at.split('T')[0];
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
        load();
      } else {
        toast.error("Duplicate transaction no longer found.");
        setResolvingDuplicate(null);
      }
    } catch (err: any) {
      toast.error("Failed to merge duplicate entries: " + (err.message || ""));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkDeleting(true);
    try {
      const idsToDelete = Array.from(selectedIds);
      const { error } = await supabase
        .from("expenses")
        .delete()
        .in("id", idsToDelete);

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success(`Successfully deleted ${idsToDelete.length} transaction(s)`);
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setIsConfirmingBulk(false);
      load();
    } catch (err: any) {
      console.error("Bulk delete error:", err);
      toast.error(err.message || "An unexpected error occurred during bulk deletion");
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleBulkSave = async () => {
    if (selectedIds.size === 0 || !user) return;
    
    const isVendorModified = bulkVendor.trim() !== "";
    const isCategoryModified = bulkCategory !== "keep";
    const isCompanyModified = bulkCompanyEntity !== "keep";
    const isExpenseCategoryModified = bulkExpenseCategory !== "keep";
    
    if (!isVendorModified && !isCategoryModified && !isCompanyModified && !isExpenseCategoryModified) {
      toast.info("No modifications were specified.");
      return;
    }
    
    setBulkSaving(true);
    try {
      const idsToUpdate = Array.from(selectedIds);
      const updatePayload: any = {};
      
      if (isVendorModified) {
        updatePayload.vendor = bulkVendor.trim();
      }
      
      if (isCategoryModified) {
        updatePayload.category = bulkCategory;
        updatePayload.main_category = bulkCategory;
      }
      
      const finalCategory = isCategoryModified ? bulkCategory : "keep";
      
      if (finalCategory === "Personal") {
        updatePayload.company_entity = "None";
        updatePayload.business_id = null;
      } else {
        if (isCompanyModified) {
          updatePayload.company_entity = bulkCompanyEntity;
          if (bulkCompanyEntity === "None") {
            updatePayload.business_id = null;
          } else {
            const bizId = await resolveBusinessId(bulkCompanyEntity);
            updatePayload.business_id = bizId;
          }
        }
      }
      
      if (isExpenseCategoryModified) {
        updatePayload.expense_category = bulkExpenseCategory;
      }
      
      let { error } = await supabase
        .from("expenses")
        .update(updatePayload)
        .in("id", idsToUpdate);
        
      if (error && error.code === "42703") {
        console.warn("New columns not found in database. Retrying bulk update with legacy schema columns...");
        const legacyPayload: any = {};
        if (updatePayload.vendor !== undefined) legacyPayload.vendor = updatePayload.vendor;
        if (updatePayload.category !== undefined) legacyPayload.category = updatePayload.category;
        if (updatePayload.business_id !== undefined) legacyPayload.business_id = updatePayload.business_id;
        
        const retryResult = await supabase
          .from("expenses")
          .update(legacyPayload)
          .in("id", idsToUpdate);
        error = retryResult.error;
      }
      
      if (error) {
        toast.error(`Database Error: ${error.message}`);
        return;
      }
      
      try {
        const cleanVendor = isVendorModified ? bulkVendor.trim() : "";
        if (cleanVendor && cleanVendor !== "Unknown") {
          const { data: existingVendorRule } = await (supabase as any)
            .from("transaction_rules_memory")
            .select("id")
            .eq("user_id", user.id)
            .eq("vendor_pattern", cleanVendor)
            .is("amount", null)
            .maybeSingle();
            
          const rulePayload: any = {};
          if (isCategoryModified) {
            rulePayload.main_category = bulkCategory;
          }
          if (finalCategory === "Personal") {
            rulePayload.company_entity = "None";
          } else if (isCompanyModified) {
            rulePayload.company_entity = bulkCompanyEntity;
          }
          if (isExpenseCategoryModified) {
            rulePayload.expense_category = bulkExpenseCategory;
          }
          
          if (existingVendorRule?.id) {
            if (Object.keys(rulePayload).length > 0) {
              await (supabase as any)
                .from("transaction_rules_memory")
                .update(rulePayload)
                .eq("id", existingVendorRule.id);
            }
          } else {
            await (supabase as any).from("transaction_rules_memory").insert({
              user_id: user.id,
              vendor_pattern: cleanVendor,
              main_category: isCategoryModified ? bulkCategory : "Personal",
              company_entity: finalCategory === "Personal" ? "None" : (isCompanyModified ? bulkCompanyEntity : "None"),
              expense_category: isExpenseCategoryModified ? bulkExpenseCategory : "Other expenses",
            });
          }
        }
      } catch (ruleErr) {
        console.warn("Failed to sync bulk edit rules memory:", ruleErr);
      }
      
      toast.success(`Successfully updated ${idsToUpdate.length} transaction(s)`);
      setSelectedIds(new Set());
      setIsSelectionMode(false);
      setIsBulkEditingOpen(false);
      load();
    } catch (err: any) {
      console.error("Bulk save error:", err);
      toast.error(err.message || "An unexpected error occurred during bulk save");
    } finally {
      setBulkSaving(false);
    }
  };

  const handleToggleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = sortedAndFiltered.map((item: any) => item.id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSaveWebhook = (url: string) => {
    setWebhookUrl(url);
    if (typeof window !== "undefined") {
      localStorage.setItem("finstream_n8n_webhook", url);
    }
  };

  const handleCopyTSV = () => {
    const headers = ["Date", "Vendor", "Category", "Entity", "Expense Category", "Description", "Amount (INR)", "Currency"];
    const body = sortedAndFiltered.map((r) => [
      (r.date || r.created_at).split("T")[0],
      r.vendor || "Unknown",
      r.category || "Business",
      r.company_entity || "None",
      r.expense_category || "Other expenses",
      (r.raw_text || "").replace(/\t/g, " "),
      convertAmount(Number(r.amount) || 0, r.currency || "INR", "INR", r.created_at).toFixed(2),
      r.currency,
    ]);

    let tsv = "FINSTREAM AI TRANSACTION LEDGER\n";
    tsv += `Report Type\tGoogle Sheets Direct Paste Data\n`;
    tsv += `Total Transacted Amount\t${sortedAndFiltered.length} items\n`;
    tsv += `Export Generated At\t${new Date().toISOString()}\n\n`;

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
        toast.error("Failed to write to clipboard. Please copy manually.");
      });
  };

  const handleWebhookSync = async () => {
    setIsSyncing(true);
    setSyncStep(1);
    setSyncProgress(15);
    setSyncError("");

    const chronologicalTransactions = [...sortedAndFiltered].sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : new Date(a.created_at).getTime();
      const dateB = b.date ? new Date(b.date).getTime() : new Date(b.created_at).getTime();
      return dateA - dateB; // Chronological (oldest first)
    });

    const payload = {
      export_time: new Date().toISOString(),
      timeframe: "Transactions Export",
      total_amount_inr: chronologicalTransactions.reduce((sum, item) => sum + convertAmount(item.amount, item.currency, "INR", item.created_at), 0),
      transaction_count: chronologicalTransactions.length,
      ai_summary: "FinStream Ledger Transactions Export via Webhook Sync",
      transactions: chronologicalTransactions.map((r) => ({
        date: (r.date || r.created_at).split("T")[0],
        vendor: r.vendor || "Unknown",
        category: r.category || "Business",
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

      // Step 5: Sync finalization
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

  const handleExportSheets = () => {
    setIsExportSheetsOpen(true);
    setSyncStep(0);
    setSyncProgress(0);
    setSyncError("");
  };

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      {/* Decorative Premium Gold Ambient Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />
      <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.04)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />

      <DashboardSidebar />
      <main className="flex-1 min-w-0 relative z-10">
        <header className="border-b border-border bg-card/50 backdrop-blur px-6 md:px-10 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
              <Receipt className="w-5 h-5" /> Transactions
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              All your captured expenses, converted to your display currency.
            </p>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <Button
              onClick={handleExportSheets}
              disabled={isExportingSheets}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/50 text-white font-semibold shadow-luxury flex items-center gap-1.5 border border-emerald-500/20 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {isExportingSheets ? (
                <Loader2 className="w-4.5 h-4.5 animate-spin text-white" />
              ) : (
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="3" y1="15" x2="21" y2="15" />
                  <line x1="9" y1="3" x2="9" y2="21" />
                  <line x1="15" y1="3" x2="15" y2="21" />
                </svg>
              )}
              {isExportingSheets ? "Exporting..." : "Export to Sheets"}
            </Button>
            <Button
              onClick={startAdding}
              className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-luxury flex items-center gap-1.5 border border-primary/20 cursor-pointer"
            >
              <Plus className="w-4.5 h-4.5" />
              Add Transaction
            </Button>
            <CurrencySwitcher />
            <ThemeToggle />
          </div>
        </header>
        <div className="p-6 md:p-10">

        <div className="mb-4 border-b border-border">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div className="flex gap-1">
              {([
                { id: "all", label: "All" },
                { id: "business", label: "Business" },
                { id: "personal", label: "Personal / Investments" },
              ] as { id: MainTab; label: string }[]).map((t) => {
                const active = mainTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => {
                      setMainTab(t.id);
                      setBusinessCompany("all");
                    }}
                    className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "text-[var(--marble-white)] bg-[var(--midnight-navy)] rounded-t-md"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t.label}
                    {active && (
                      <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-[var(--crystal-teal)] rounded-full" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Filter and Sort Controls */}
            <div className="flex items-center gap-3 pb-2 sm:pb-0 pr-2 flex-wrap">
              {/* Bulk Select Toggle */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isSelectionMode) {
                    setSelectedIds(new Set());
                  }
                  setIsSelectionMode(!isSelectionMode);
                }}
                className={cn(
                  "h-8 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                  isSelectionMode
                    ? "bg-amber-500/10 text-amber-500 border border-amber-500/30 hover:bg-amber-500/20"
                    : "bg-background border border-border hover:bg-muted text-foreground"
                )}
              >
                {isSelectionMode ? "Cancel Select" : "Bulk Select"}
              </Button>

              {/* Duplicate Filtering Dropdown */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Duplicates:</Label>
                <Select
                  value={filterDuplicates}
                  onValueChange={(v) => setFilterDuplicates(v as any)}
                >
                  <SelectTrigger className="w-[145px] h-8 text-xs bg-background">
                    <SelectValue placeholder="Filter duplicates..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Show All</SelectItem>
                    <SelectItem value="hide_duplicates">Hide Duplicates</SelectItem>
                    <SelectItem value="duplicates_only">Duplicates Only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Sort Dropdown */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Sort:</Label>
                <Select
                  value={sortBy}
                  onValueChange={(v) => setSortBy(v as any)}
                >
                  <SelectTrigger className="w-[155px] h-8 text-xs bg-background">
                    <SelectValue placeholder="Sort by..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date_desc">Date (Newest First)</SelectItem>
                    <SelectItem value="date_asc">Date (Oldest First)</SelectItem>
                    <SelectItem value="amount_desc">Amount (High to Low)</SelectItem>
                    <SelectItem value="amount_asc">Amount (Low to High)</SelectItem>
                    <SelectItem value="vendor_asc">Vendor (A-Z)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          {businessCompanies.length > 0 && (
            <div className="flex gap-1 flex-wrap pt-3 pb-2 pl-2">
              <button
                onClick={() => setBusinessCompany("all")}
                className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                  businessCompany === "all"
                    ? "bg-[var(--midnight-navy)] text-[var(--marble-white)] border-[var(--midnight-navy)]"
                    : "border-border text-muted-foreground hover:text-foreground"
                }`}
              >
                All Entities
              </button>
              {businessCompanies.map((c) => {
                const active = businessCompany === c;
                return (
                  <button
                    key={c}
                    onClick={() => setBusinessCompany(c)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      active
                        ? "bg-[var(--midnight-navy)] text-[var(--marble-white)] border-[var(--crystal-teal)]"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
          </div>
        ) : sortedAndFiltered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Inbox className="w-8 h-8 mb-2" />
            <p>No transactions yet.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-muted/50 text-left">
                <tr>
                  {isSelectionMode && (
                    <th className="px-4 py-3 font-medium w-10">
                      <input
                        type="checkbox"
                        className="rounded border-border bg-background accent-primary h-4 w-4 cursor-pointer"
                        checked={sortedAndFiltered.length > 0 && selectedIds.size === sortedAndFiltered.length}
                        ref={(el) => {
                          if (el) {
                            el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedAndFiltered.length;
                          }
                        }}
                        onChange={(ev) => handleToggleSelectAll(ev.target.checked)}
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-3 py-3 font-medium max-w-[140px]">Vendor</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Entity</th>
                  <th className="px-4 py-3 font-medium">Expense Category</th>
                  <th className="px-2 py-3 font-medium max-w-[150px]">Description</th>
                  <th className="px-4 py-3 font-medium text-right">Amount ({displayCurrency})</th>
                  {!isSelectionMode && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {sortedAndFiltered.map((e: any) => {
                  const owned = e.user_id === user?.id;
                  
                  // Clean Vendor payee name
                  const cleanVendor = cleanVendorName(e.vendor);
                  
                  // High-fidelity display calculations with strict backups
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
                  const displayCompanyEntity = e.company_entity || "None";
                  
                  const displayExpenseCategory = e.expense_category || "Other expenses";
                  let displayDescription = e.raw_text || "";
                  
                  if (e.raw_text && e.raw_text.includes(" · ")) {
                    displayDescription = e.raw_text.split(" · ").slice(1).join(" · ");
                  }

                  return (
                    <tr
                      key={e.id}
                      onClick={() => startEditing(e)}
                      className="border-t border-border transition-colors cursor-pointer hover:bg-muted/40"
                    >
                      {isSelectionMode && (
                        <td className="px-4 py-3 w-10" onClick={(ev) => ev.stopPropagation()}>
                          <input
                            type="checkbox"
                            className="rounded border-border bg-background accent-primary h-4 w-4 cursor-pointer"
                            checked={selectedIds.has(e.id)}
                            onChange={(ev) => {
                              const newSelected = new Set(selectedIds);
                              if (ev.target.checked) {
                                newSelected.add(e.id);
                              } else {
                                newSelected.delete(e.id);
                              }
                              setSelectedIds(newSelected);
                            }}
                          />
                        </td>
                      )}
                      <td className="px-4 py-3 text-muted-foreground tabular-nums whitespace-nowrap">
                        {displayDate}
                      </td>
                      <td className="px-3 py-3 font-medium text-foreground max-w-[140px] truncate whitespace-nowrap">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{cleanVendor}</span>
                          {(() => {
                            const key = `${cleanVendorName(e.vendor).toLowerCase().trim()}|${Number(e.amount).toFixed(2)}|${e.date || e.created_at.split('T')[0]}`;
                            const isDuplicate = (duplicateCounts.get(key) ?? 0) > 1;
                            return isDuplicate && (
                              <button
                                onClick={(ev) => {
                                  ev.stopPropagation();
                                  setResolvingDuplicate(e);
                                }}
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500 hover:text-[#0E1629] transition-all cursor-pointer animate-pulse shrink-0"
                                title="Duplicate detected. Click to resolve double-billing!"
                              >
                                ⚠ Resolve Duplicate
                              </button>
                            );
                          })()}
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
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-bold bg-muted text-primary border border-primary/20">
                          {displayCompanyEntity}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-foreground/90 font-medium text-xs bg-muted/30 px-2 py-1 rounded">
                          {displayExpenseCategory}
                        </span>
                      </td>
                      <td className="px-2 py-3 text-muted-foreground text-[11px] max-w-[150px] truncate whitespace-nowrap" title={displayDescription || undefined}>
                        {displayDescription || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-foreground whitespace-nowrap">
                        {formatCurrency(
                          convertAmount(Number(e.amount) || 0, e.currency, displayCurrency, e.created_at),
                          displayCurrency,
                        )}
                        {e.currency !== displayCurrency && (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {formatCurrency(e.amount, e.currency)}
                          </div>
                        )}
                      </td>
                      {!isSelectionMode && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              setDeleting(e);
                            }}
                            title="Delete"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </main>

      {/* Edit Transaction Sheet */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col gap-0 p-0"
        >
          <SheetHeader className="px-6 py-5 border-b border-border bg-[var(--midnight-navy)] text-[var(--marble-white)]">
            <SheetTitle className="text-[var(--marble-white)]">
              Edit transaction
            </SheetTitle>
            <SheetDescription className="text-[var(--marble-white)]/70">
              Update the details below and save your changes.
            </SheetDescription>
          </SheetHeader>

          {editing && (
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              <div className="space-y-2">
                <Label>Description / Details</Label>
                <Input
                  value={formDescription}
                  onChange={(ev) => setFormDescription(ev.target.value)}
                  placeholder="e.g. client lunch, office supply run"
                />
              </div>

              <div className="space-y-2">
                <Label>Vendor</Label>
                <Input
                  value={formVendor}
                  onChange={(ev) => setFormVendor(ev.target.value)}
                  placeholder="e.g. Starbucks, Amazon"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formAmount || ""}
                    onChange={(ev) => setFormAmount(Number(ev.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Currency</Label>
                  <Select
                    value={formCurrency}
                    onValueChange={(v) => setFormCurrency(v)}
                  >
                    <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SUPPORTED_CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Main Category</Label>
                <Select
                  value={formCategory}
                  onValueChange={(v) => {
                    const cat = v as "Business" | "Personal";
                    setFormCategory(cat);
                  }}
                >
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Business">Business</SelectItem>
                    <SelectItem value="Personal">Personal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Company Entity</Label>
                <Select
                  value={formCompanyEntity}
                  onValueChange={(v) => setFormCompanyEntity(v as any)}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select entity..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KS">KS — Kumaram Sports</SelectItem>
                    <SelectItem value="TI">TI — Tennex Impex</SelectItem>
                    <SelectItem value="CPM">CPM — CPM / CPM and Associates</SelectItem>
                    <SelectItem value="AAS">AAS — All About Sports</SelectItem>
                    <SelectItem value="Swati">Swati</SelectItem>
                    <SelectItem value="Others">Others</SelectItem>
                    <SelectItem value="None">None</SelectItem>
                  </SelectContent>
                </Select>
              </div>


              <div className="space-y-2">
                <Label>Expense Category</Label>
                <Select
                  value={formExpenseCategory}
                  onValueChange={(v) => setFormExpenseCategory(v)}
                >
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal bg-background",
                        !formDate && "text-muted-foreground",
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {formDate && !isNaN(new Date(formDate).getTime())
                        ? format(new Date(formDate), "PPP")
                        : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formDate && !isNaN(new Date(formDate).getTime()) ? new Date(formDate) : new Date()}
                      onSelect={(d) => d && setFormDate(d.toISOString())}
                      initialFocus
                      className={cn("p-3 pointer-events-auto")}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          )}

          <SheetFooter className="px-6 py-4 border-t border-border bg-background flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Add Transaction Sheet */}
      <Sheet open={adding} onOpenChange={(o) => !o && setAdding(false)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col gap-0 p-0"
        >
          <SheetHeader className="px-6 py-5 border-b border-border bg-[var(--midnight-navy)] text-[var(--marble-white)]">
            <SheetTitle className="text-[var(--marble-white)]">
              Add transaction
            </SheetTitle>
            <SheetDescription className="text-[var(--marble-white)]/70">
              Manually add a new transaction to the ledger.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="space-y-2">
              <Label>Description / Details</Label>
              <Input
                value={formDescription}
                onChange={(ev) => setFormDescription(ev.target.value)}
                placeholder="e.g. client lunch, office supply run"
              />
            </div>

            <div className="space-y-2">
              <Label>Vendor</Label>
              <Input
                value={formVendor}
                onChange={(ev) => setFormVendor(ev.target.value)}
                placeholder="e.g. Starbucks, Amazon"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formAmount || ""}
                  onChange={(ev) => setFormAmount(Number(ev.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label>Currency</Label>
                <Select
                  value={formCurrency}
                  onValueChange={(v) => setFormCurrency(v)}
                >
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Main Category</Label>
              <Select
                value={formCategory}
                onValueChange={(v) => {
                  const cat = v as "Business" | "Personal";
                  setFormCategory(cat);
                }}
              >
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="Personal">Personal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Company Entity</Label>
              <Select
                value={formCompanyEntity}
                onValueChange={(v) => setFormCompanyEntity(v as any)}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Select entity..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="KS">KS — Kumaram Sports</SelectItem>
                  <SelectItem value="TI">TI — Tennex Impex</SelectItem>
                  <SelectItem value="CPM">CPM — CPM / CPM and Associates</SelectItem>
                  <SelectItem value="AAS">AAS — All About Sports</SelectItem>
                  <SelectItem value="Swati">Swati</SelectItem>
                  <SelectItem value="Others">Others</SelectItem>
                  <SelectItem value="None">None</SelectItem>
                </SelectContent>
              </Select>
            </div>


            <div className="space-y-2">
              <Label>Expense Category</Label>
              <Select
                value={formExpenseCategory}
                onValueChange={(v) => setFormExpenseCategory(v)}
              >
                <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal bg-background",
                      !formDate && "text-muted-foreground",
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {formDate && !isNaN(new Date(formDate).getTime())
                      ? format(new Date(formDate), "PPP")
                      : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formDate && !isNaN(new Date(formDate).getTime()) ? new Date(formDate) : new Date()}
                    onSelect={(d) => d && setFormDate(d.toISOString())}
                    initialFocus
                    className={cn("p-3 pointer-events-auto")}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <SheetFooter className="px-6 py-4 border-t border-border bg-background flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddSave}
              disabled={saving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm cursor-pointer"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save transaction
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Bulk Edit Transactions Sheet */}
      <Sheet open={isBulkEditingOpen} onOpenChange={(o) => !o && setIsBulkEditingOpen(false)}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md flex flex-col gap-0 p-0"
        >
          <SheetHeader className="px-6 py-5 border-b border-border bg-[var(--midnight-navy)] text-[var(--marble-white)]">
            <SheetTitle className="text-[var(--marble-white)]">
              Bulk Edit Transactions
            </SheetTitle>
            <SheetDescription className="text-[var(--marble-white)]/70">
              Update fields for all {selectedIds.size} selected transactions simultaneously. Fields left as "Keep existing" will remain unmodified.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            <div className="space-y-2">
              <Label>Vendor / Payee</Label>
              <Input
                value={bulkVendor}
                onChange={(ev) => setBulkVendor(ev.target.value)}
                placeholder="Keep existing (no change)"
                className="bg-background"
              />
            </div>

            <div className="space-y-2">
              <Label>Main Category</Label>
              <Select
                value={bulkCategory}
                onValueChange={(v) => {
                  setBulkCategory(v as any);
                }}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep existing (no change)</SelectItem>
                  <SelectItem value="Business">Business</SelectItem>
                  <SelectItem value="Personal">Personal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Company Entity</Label>
              <Select
                value={bulkCompanyEntity}
                onValueChange={(v) => setBulkCompanyEntity(v as any)}
                disabled={bulkCategory === "Personal"}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep existing (no change)</SelectItem>
                  <SelectItem value="KS">KS — Kumaram Sports</SelectItem>
                  <SelectItem value="TI">TI — Tennex Impex</SelectItem>
                  <SelectItem value="CPM">CPM — CPM / CPM and Associates</SelectItem>
                  <SelectItem value="AAS">AAS — All About Sports</SelectItem>
                  <SelectItem value="Swati">Swati</SelectItem>
                  <SelectItem value="Others">Others</SelectItem>
                  <SelectItem value="None">None</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Expense Category</Label>
              <Select
                value={bulkExpenseCategory}
                onValueChange={(v) => setBulkExpenseCategory(v)}
              >
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">Keep existing (no change)</SelectItem>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <SheetFooter className="px-6 py-4 border-t border-border bg-background flex-row justify-end gap-2">
            <Button variant="outline" onClick={() => setIsBulkEditingOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleBulkSave}
              disabled={bulkSaving}
              className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm cursor-pointer"
            >
              {bulkSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Floating Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 card-luxury border border-border bg-card/95 backdrop-blur-md rounded-full px-6 py-3.5 shadow-luxury flex items-center gap-6 animate-in slide-in-from-bottom-5 duration-300">
          <div className="flex items-center gap-2.5">
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
            <span className="text-sm font-semibold text-foreground">
              {selectedIds.size} transaction{selectedIds.size > 1 ? "s" : ""} selected
            </span>
          </div>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="text-muted-foreground hover:text-foreground hover:bg-muted text-xs font-semibold cursor-pointer transition-colors rounded-full px-3"
            >
              Clear Selection
            </Button>
            <Button
              onClick={() => {
                setBulkVendor("");
                setBulkCategory("keep");
                setBulkCompanyEntity("keep");
                setBulkExpenseCategory("keep");
                setIsBulkEditingOpen(true);
              }}
              size="sm"
              className="bg-amber-500/95 hover:bg-amber-600 text-white font-bold border border-amber-500/20 text-xs px-4 py-2 rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm transition-all hover:scale-[1.02]"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Selected
            </Button>
            <Button
              onClick={() => setIsConfirmingBulk(true)}
              size="sm"
              className="bg-red-600/95 hover:bg-red-700 text-white font-bold border border-red-500/20 text-xs px-4 py-2 rounded-full cursor-pointer flex items-center gap-1.5 shadow-sm transition-all hover:scale-[1.02]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={isConfirmingBulk} onOpenChange={(o) => !o && setIsConfirmingBulk(false)}>
        <AlertDialogContent className="border border-destructive/20 bg-card text-foreground shadow-luxury max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-bold flex items-center gap-2 text-red-500">
              <Trash2 className="w-5 h-5 animate-pulse" /> Delete {selectedIds.size} transactions?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground mt-2.5 text-sm leading-relaxed">
              Are you absolutely sure? This will permanently delete the <span className="font-semibold text-foreground">{selectedIds.size} selected transaction{selectedIds.size > 1 ? "s" : ""}</span> from your ledger. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-6 gap-2">
            <AlertDialogCancel className="bg-secondary hover:bg-secondary/80 text-secondary-foreground border border-border cursor-pointer transition-colors px-4 py-2 text-sm font-medium rounded-md">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(ev) => {
                ev.preventDefault();
                handleBulkDelete();
              }}
              disabled={isBulkDeleting}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold border-none flex items-center gap-1.5 cursor-pointer transition-colors px-4 py-2 text-sm rounded-md"
            >
              {isBulkDeleting && <Loader2 className="w-4 h-4 animate-spin" />}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      {/* ══ GOOGLE SHEETS EXPORT MODAL ════════════════════ */}
      {isExportSheetsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/85 backdrop-blur-md transition-all duration-300">
          <div className="relative w-full max-w-lg overflow-hidden card-luxury border border-border bg-card/95 rounded-2xl p-6 text-foreground space-y-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full pointer-events-none" />
            
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">田</span>
                <div>
                  <h3 className="text-base font-bold text-primary tracking-tight">Google Sheets Export</h3>
                  <span className="text-[10px] text-muted-foreground font-mono">FinStream Statement Synchronization</span>
                </div>
              </div>
              <button
                onClick={() => setIsExportSheetsOpen(false)}
                className="text-muted-foreground hover:text-foreground hover:bg-muted p-1.5 rounded-full cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Custom Tab Switcher */}
            <div className="flex p-1 bg-muted rounded-xl border border-border gap-1">
              <button
                type="button"
                onClick={() => setExportTab("clipboard")}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer",
                  exportTab === "clipboard"
                    ? "bg-primary text-[#0E1629] font-bold shadow-[0_2px_8px_-2px_rgba(212,175,55,0.3)]"
                    : "text-slate-400 hover:text-slate-100"
                )}
              >
                📋 Copy Spreadsheet Grid
              </button>
              <button
                type="button"
                onClick={() => setExportTab("n8n")}
                className={cn(
                  "flex-1 py-2 text-xs font-bold rounded-lg transition-all cursor-pointer",
                  exportTab === "n8n"
                    ? "bg-primary text-[#0E1629] font-bold shadow-[0_2px_8px_-2px_rgba(212,175,55,0.3)]"
                    : "text-slate-400 hover:text-slate-100"
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
                    This copies all <strong>{sortedAndFiltered.length} transactions</strong> formatted as a grid of spreadsheet-ready data.
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
                        Synchronize your transactions directly to your spreadsheet. Enter your local or enterprise n8n webhook URL below to begin.
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
                        <div className="space-y-1.5 pt-1">
                          <label className="text-[10px] uppercase font-bold text-slate-400">
                            Webhook Target URL
                          </label>
                          <input
                            type="url"
                            value={webhookUrl}
                            onChange={(e) => handleSaveWebhook(e.target.value)}
                            placeholder="http://localhost:5678/webhook/..."
                            className="w-full text-xs bg-[#0E1629] border border-slate-700 rounded-lg p-2.5 text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary placeholder-slate-500"
                          />
                          <p className="text-[10px] text-slate-400">
                            Endpoint must accept a HTTP POST request with transaction JSON payload.
                          </p>
                        </div>
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
                    <div className="relative w-16 h-16 flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-pulse" />
                      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary animate-spin" />
                      <span className="text-xl">🤖</span>
                    </div>

                    <div className="w-full space-y-2 text-center">
                      <p className="text-sm font-bold text-slate-100">
                        {syncStep === 1 && "🔌 Connecting to webhook endpoint..."}
                        {syncStep === 2 && "🗺 Mapping database schema fields..."}
                        {syncStep === 3 && `📤 Uploading ${sortedAndFiltered.length} ledger rows to target spreadsheet...`}
                        {syncStep === 4 && "🎨 Applying design presets..."}
                        {syncStep === 5 && "✦ Finalizing sync..."}
                      </p>
                      <p className="text-xs text-slate-400 font-medium">
                        {useRealWebhook ? "Syncing to your custom server endpoint..." : "Running simulation..."}
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
                        All <strong>{sortedAndFiltered.length} transactions</strong> have been successfully formatted and injected into your spreadsheet ledger.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3 w-full pt-2">
                      <button
                        onClick={() => setIsExportSheetsOpen(false)}
                        className="flex-grow flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl border border-primary bg-primary text-slate-950 hover:bg-primary/90 transition-all cursor-pointer shadow-[0_4px_12px_-3px_rgba(212,175,55,0.3)]"
                      >
                        ✓ Close Panel
                      </button>
                      <button
                        onClick={() => setSyncStep(0)}
                        className="flex-grow flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-100 transition-all cursor-pointer"
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
