import { createFileRoute } from "@tanstack/react-router";
import { Settings as SettingsIcon } from "lucide-react";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Settings — FinStream" }] }),
});

function SettingsPage() {
  const { user, signOut } = useAuth();
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

        <div className="rounded-lg border border-border p-5 bg-card space-y-3">
          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Account</div>
            <div className="text-sm mt-1">{user?.email ?? "—"}</div>
          </div>
          <Button variant="outline" onClick={signOut}>Sign out</Button>
        </div>
      </main>
    </div>
  );
}
