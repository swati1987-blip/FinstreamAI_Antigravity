import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sparkles, UploadCloud, ShieldCheck, ArrowRight, Lock, Building, Layers } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "FinStream AI — Elite Financial Intelligence" },
      {
        name: "description",
        content: "Experience FinStream AI, the premium ledger system with automated bank statement parsing and multi-entity tracking.",
      },
    ],
  }),
});

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate({ to: "/dashboard" });
    }
  }, [loading, user, navigate]);

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] selection:bg-[var(--primary)] selection:text-[var(--background)] flex flex-col justify-between relative overflow-hidden">
      {/* Decorative Golden Glows */}
      <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-[radial-gradient(circle,rgba(197,160,89,0.08)_0%,transparent_70%)] pointer-events-none blur-3xl" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[radial-gradient(circle,rgba(197,160,89,0.05)_0%,transpare
<truncated 8283 bytes>
        description="Cleanly segment records under corporate entities like KS, TI, CPM, AAS, or mark them as Personal expense models."
          />
          <FeatureCard
            icon={Layers}
            title="Dynamic Ledgers & Analytics"
            description="Examine transaction ledgers split by Business or Personal streams, with unified currency aggregations and reports."
          />
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--border)] py-6 text-center text-xs text-[var(--slate-gray)] relative z-10 bg-[var(--card)]/10 backdrop-blur-sm">
        <p>&copy; {new Date().getFullYear()} FinStream AI. Designed for elite wealth ledger management. All rights reserved.</p>
      </footer>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/30 p-6 backdrop-blur-sm hover:border-[var(--primary)]/60 transition-all duration-300 group shadow-lg flex flex-col justify-between">
      <div>
        <div className="w-10 h-10 rounded-lg bg-[var(--muted)] flex items-center justify-center text-[var(--primary)] border border-[var(--border)]/40 mb-4 group-hover:bg-[var(--primary)]/10 group-hover:text-[var(--primary)] transition-all">
          <Icon className="w-5 h-5" />
        </div>
        <h3 className="text-base font-semibold tracking-tight text-[var(--foreground)] mb-2">
          {title}
        </h3>
        <p className="text-xs text-[var(--slate-gray)] font-light leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
