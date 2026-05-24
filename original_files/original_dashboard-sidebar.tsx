import { LayoutDashboard, Receipt, BarChart3, Settings, LogOut } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/finstream-logo.png";

const items = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/" as const },
  { label: "Transactions", icon: Receipt, to: "/transactions" as const },
  { label: "Reports", icon: BarChart3, to: "/reports" as const },
  { label: "Settings", icon: Settings, to: "/settings" as const },
];

export function DashboardSidebar() {
  const { user, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground border-r border-[var(--rose-copper)]/40">
      <div className="px-5 py-5 border-b border-[var(--rose-copper)]/30">
        <div className="flex items-center gap-3">
          <img
            src={logo}
            alt="FinStream logo"
            className="w-11 h-11 rounded-md object-cover ring-1 ring-[var(--rose-copper)]/50 shadow-md"
          />
          <div>
            <div className="font-semibold tracking-tight text-[var(--marble-white)] leading-tight">FinStream</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--rose-copper)]">Smart Expense Flow</div>
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
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active
                  ? "bg-sidebar-accent text-[var(--marble-white)] border border-[var(--rose-copper)]/40"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              }`}
            >
              <item.icon className={`w-4 h-4 ${active ? "text-[var(--crystal-teal)]" : "text-[var(--rose-copper)]"}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border space-y-2">
        <div className="rounded-lg bg-sidebar-accent/40 p-3">
          <div className="text-xs text-sidebar-foreground/70">Signed in as</div>
          <div className="text-sm font-medium text-sidebar-accent-foreground truncate">
            {user?.email ?? "—"}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
        >
          <LogOut className="w-4 h-4 mr-2" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
