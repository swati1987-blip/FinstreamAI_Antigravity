import { LayoutDashboard, Receipt, BarChart3, Settings, Sun, Moon } from "lucide-react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useTheme } from "@/hooks/use-theme";
import { useAuth } from "@/hooks/use-auth";

const items = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard" as const },
  { label: "Transactions", icon: Receipt, to: "/transactions" as const },
  { label: "Reports", icon: BarChart3, to: "/reports" as const },
  { label: "Settings", icon: Settings, to: "/settings" as const },
];

export function MobileNav() {
  const { user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Only show if user is signed in
  if (!user) return null;

  return (
    <div className="md:hidden fixed bottom-4 left-4 right-4 z-50">
      <nav className="flex items-center justify-around bg-card/85 backdrop-blur-xl border border-border/60 rounded-2xl py-2 px-3 shadow-[0_8px_32px_rgba(0,0,0,0.12)]">
        {items.map((item) => {
          const active = pathname === item.to;
          return (
            <Link
              key={item.label}
              to={item.to}
              className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all duration-200 ${
                active
                  ? "text-primary font-bold scale-105"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.icon className="w-5 h-5" />
              <span className="text-[9px] uppercase tracking-wider font-semibold">{item.label}</span>
            </Link>
          );
        })}

        <button
          onClick={toggleTheme}
          className="flex flex-col items-center gap-1 p-2 rounded-xl text-muted-foreground hover:text-primary transition-all duration-200 cursor-pointer"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <>
              <Sun className="w-5 h-5 text-primary" />
              <span className="text-[9px] uppercase tracking-wider font-semibold text-primary">Light</span>
            </>
          ) : (
            <>
              <Moon className="w-5 h-5 text-slate-700" />
              <span className="text-[9px] uppercase tracking-wider font-semibold text-slate-700">Dark</span>
            </>
          )}
        </button>
      </nav>
    </div>
  );
}
