import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { formatCurrency } from "@/lib/currency";
import { convertAmount } from "@/lib/fx";

export const Route = createFileRoute("/_authenticated/reports")({
  component: ReportsPage,
  head: () => ({ meta: [{ title: "Reports — FinStream" }] }),
});

interface Row {
  amount: number;
  currency: string;
  category: string;
  created_at: string;
}

function ReportsPage() {
  const { user } = useAuth();
  const { currency: displayCurrency } = useCurrency();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("expenses")
        .select("amount,currency,category,created_at");
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, [user]);

  const summary = useMemo(() => {
    let total = 0,
      business = 0,
<truncated 1213 bytes>
    </div>
          <CurrencySwitcher />
        </header>

        <div className="p-6 md:p-10">
          {loading ? (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…
            </div>
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">No data yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={`Total (${displayCurrency})`} value={summary.total} currency={displayCurrency} primary />
              <Stat label="Business" value={summary.business} currency={displayCurrency} />
              <Stat label="Personal" value={summary.personal} currency={displayCurrency} />
              <Stat label="Investments" value={summary.investments} currency={displayCurrency} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Stat({
  label,
  value,
  currency,
  primary,
}: {
  label: string;
  value: number;
  currency: string;
  primary?: boolean;
}) {
  return (
    <div
      className={`card-luxury rounded-xl p-5 ${
        primary ? "ring-1 ring-[var(--crystal-teal)]/50" : ""
      }`}
    >
      <div className="text-xs uppercase tracking-widest text-[var(--midnight-navy)]/60 font-semibold">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-2 text-[var(--midnight-navy)] tabular-nums">
        <span className="text-teal mr-0.5">
          {formatCurrency(value, currency).match(/^[^\d\-]*/)?.[0] ?? ""}
        </span>
        {formatCurrency(value, currency).replace(/^[^\d\-]*/, "")}
      </div>
    </div>
  );
}
