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

import { useState, useRef } from "react";

export function DashboardSidebar() {
  const { user, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [particles, setParticles] = useState<{ id: number; angle: number; distance: number; duration: number; size: number; color: string }[]>([]);
  const [isAnimating, setIsAnimating] = useState(false);
  const particleIdRef = useRef(0);

  const handleLogoClick = () => {
    if (isAnimating) return;
    setIsAnimating(true);
    
    // Reset isAnimating state after 1.2s (matching zoom-spin animation duration)
    setTimeout(() => setIsAnimating(false), 1200);

    // Create a high-density 24-particle radial burst of gold, teal, cyan, and white sparkles
    const newParticles = Array.from({ length: 24 }).map(() => {
      const angle = Math.random() * Math.PI * 2; // Random 360-degree direction
      const distance = 60 + Math.random() * 85; // Pushed further outward (60px to 145px)
      const duration = 700 + Math.random() * 500; // Animation duration (700ms to 1200ms)
      const size = 3 + Math.random() * 6; // Sparkle size (3px to 9px)
      const colors = ["#D4AF37", "#C5A059", "#00F2FE", "#00C6FF", "#FFFFFF"]; // Gold, Teal, Cyan, White
      const color = colors[Math.floor(Math.random() * colors.length)];
      
      particleIdRef.current += 1;
      return {
        id: particleIdRef.current,
        angle,
        distance,
        duration,
        size,
        color,
      };
    });

    setParticles((prev) => [...prev, ...newParticles]);

    // Clean up particles array when they fade out (1.2s)
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.find((np) => np.id === p.id)));
    }, 1200);
  };

  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)] border-r border-[var(--border)]">
      <div className="px-5 py-6 border-b border-[var(--border)] flex flex-col items-center text-center">
        <div 
          onClick={handleLogoClick}
          className="flex flex-col items-center gap-3 cursor-pointer select-none group relative"
        >
          <div className="relative w-20 h-20 flex items-center justify-center shrink-0">
            <div className="relative w-20 h-20 rounded-xl overflow-hidden ring-2 ring-[var(--primary)]/60 shadow-lg group-hover:shadow-[0_0_15px_rgba(212,175,55,0.4)] transition-all duration-500">
              <img
                src={logo}
                alt="FinStream logo"
                className={`w-20 h-20 object-cover transition-all duration-500 group-hover:scale-105 ${
                  isAnimating ? "animate-logo-pulse-sway" : ""
                }`}
              />
              <div className={`logo-shine-effect ${isAnimating ? "animate-logo-shine" : ""}`} />
            </div>
            {/* Concentric expanding shockwave ring */}
            {isAnimating && <div className="logo-ripple-ring animate-logo-ripple" />}
            {particles.map((p) => (
              <div
                key={p.id}
                className="absolute pointer-events-none animate-particle rounded-full"
                style={{
                  '--tx': `${Math.cos(p.angle) * p.distance}px`,
                  '--ty': `${Math.sin(p.angle) * p.distance}px`,
                  '--duration': `${p.duration}ms`,
                  left: '50%',
                  top: '50%',
                  width: `${p.size}px`,
                  height: `${p.size}px`,
                  backgroundColor: p.color,
                  boxShadow: `0 0 8px ${p.color}`,
                  transform: 'translate(-50%, -50%)',
                } as React.CSSProperties}
              />
            ))}
          </div>
          <div className="flex flex-col items-center">
            <div className={`font-semibold tracking-tight text-[var(--sidebar-accent-foreground)] text-base leading-tight transition-all duration-300 ${
              isAnimating ? "animate-text-shimmer" : ""
            }`}>
              FinStream AI
            </div>
            <div className={`text-[9px] uppercase tracking-[0.2em] text-[var(--primary)] leading-none mt-1.5 transition-all duration-300 ${
              isAnimating ? "animate-subtitle-pulse" : ""
            }`}>
              Smart Expense Flow
            </div>
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
