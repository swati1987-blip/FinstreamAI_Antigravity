import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon, Coins } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-currency";
import { SUPPORTED_CURRENCIES } from "@/lib/expense-shared";
import { convertAmount } from "@/lib/fx";
import { formatCurrency } from "@/lib/currency";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — FinStream" }] }),
});

function SettingsPage() {
  const { user, signOut } = useAuth();
  const { ratesVersion } = useCurrency();

  // FX Converter states
  const [convAmount, setConvAmount] = useState<string>("100");
  const [convFrom, setConvFrom] = useState<string>("USD");
  const [convTo, setConvTo] = useState<string>("INR");

  const numAmount = parseFloat(convAmount) || 0;
  const result = convertAmount(numAmount, convFrom, convTo, new Date());
  
  // Rate of 1 from to 1 to
  const currentRate = convertAmount(1, convFrom, convTo, new Date());

  return (
    <div className="flex min-h-screen bg-background relative overflow-hidden">
      {/* Decorative Premium Gold Ambient Glows */}
      <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />
      <div className="absolute bottom-[-10%] left-[20%] w-[40%] h-[40%] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.04)_0%,transparent_70%)] pointer-events-none blur-3xl z-0" />

      <DashboardSidebar />
      <main className="flex-1 p-6 md:p-10 max-w-2xl relative z-10 min-w-0">
        <header className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-5 h-5" /> Settings
          </h1>
          <ThemeToggle />
        </header>

        <div className="rounded-lg border border-border p-5 bg-card space-y-3 shadow-sm">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Account</div>
            <div className="text-sm mt-1">{user?.email ?? "—"}</div>
          </div>
          <Button variant="outline" onClick={signOut}>Sign out</Button>
        </div>

        {/* Premium FX Converter & Live Rates Widget */}
        <div className="rounded-lg border border-border p-6 bg-card space-y-5 mt-6 relative overflow-hidden shadow-sm">
          {/* Subtle gold decoration */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-[radial-gradient(circle,rgba(212,175,55,0.06)_0%,transparent_70%)] pointer-events-none" />
          
          <div>
            <h2 className="text-lg font-medium text-foreground tracking-tight flex items-center gap-2">
              <Coins className="w-5 h-5 text-[var(--primary)]" />
              FX Converter & Live Rates
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Convert amounts using live exchange rates relative to INR.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Amount</label>
              <input
                type="number"
                value={convAmount}
                onChange={(e) => setConvAmount(e.target.value)}
                className="w-full h-9 px-3 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-[var(--primary)] text-foreground tabular-nums"
                placeholder="100.00"
              />
            </div>

            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">From</label>
                <Select value={convFrom} onValueChange={setConvFrom}>
                  <SelectTrigger className="h-9 border-border bg-background text-foreground cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground">To</label>
                <Select value={convTo} onValueChange={setConvTo}>
                  <SelectTrigger className="h-9 border-border bg-background text-foreground cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-[rgba(212,175,55,0.02)] border border-[rgba(212,175,55,0.1)] flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Converted Value</div>
              <div className="text-xl font-bold text-[var(--primary)] tracking-tight mt-1 tabular-nums">
                {formatCurrency(result, convTo)}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Exchange Rate</div>
              <div className="text-xs text-foreground font-mono mt-1">
                1 {convFrom} = {currentRate.toFixed(6)} {convTo}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
