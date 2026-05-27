import { LayoutDashboard, Receipt, BarChart3, Settings, LogOut, Coins, Scale } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import logo from "@/assets/finstream-logo.png";

const items = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard" as const },
  { label: "Transactions", icon: Receipt, to: "/transactions" as const },
  { label: "Direct Cost", icon: Coins, to: "/direct-cost" as const },
  { label: "Indirect Cost", icon: Scale, to: "/indirect-cost" as const },
  { label: "Reports", icon: BarChart3, to: "/reports" as const },
  { label: "Settings", icon: Settings, to: "/settings" as const },
];

export function DashboardSidebar() {
  const { user, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)] border-r border-[var(--border)]">
      <div className="px-5 py-5 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt="FinStream logo"
            className="w-11 h-11 rounded-md object-cover ring-1 ring-[var(--primary)]/50 shadow-md transition-all duration-300 hover:scale-105 hover:rotate-1"
          />
          <div>
            <div className="font-semibold tracking-tight text-[var(--sidebar-accent-foreground)] leading-tight">FinStream AI</div>
            <div className="text-[8px] uppercase tracking-[0.2em] text-[var(--primary)] leading-none mt-1">Smart Expense Flow</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.label}
              to={item.to}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-all duration-200 border ${
                active
                  ? "bg-[var(--sidebar-accent)] text-[var(--sidebar-accent-foreground)] border-[var(--primary)]/40 shadow-[0_0_10px_-4px_rgba(197,160,89,0.3)] font-semibold"
                  : "text-[var(--sidebar-foreground)]/80 hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--sidebar-accent-foreground)] border-transparent"
              }`}
            >
              <item.icon className={`w-4 h-4 transition-colors ${active ? "text-[var(--primary)]" : "text-[var(--sidebar-foreground)]/50"}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[var(--border)] space-y-2">
        <div className="rounded-lg bg-[var(--sidebar-accent)]/40 p-3 border border-[var(--border)]/20 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-[var(--sidebar-foreground)]/70 uppercase tracking-wider">Signed in as</div>
            <div className="text-xs font-semibold text-[var(--sidebar-accent-foreground)] truncate mt-0.5">
              {user?.email ?? "—"}
            </div>
          </div>
          <div className="shrink-0 scale-90 origin-right">
            <ThemeToggle />
          </div>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="w-full justify-start text-[var(--sidebar-foreground)]/80 hover:bg-[var(--sidebar-accent)]/60 hover:text-[var(--sidebar-accent-foreground)] text-xs"
        >
          <LogOut className="w-3.5 h-3.5 mr-2 text-[var(--primary)]" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
