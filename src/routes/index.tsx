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
    if (!loading) {
      if (user) {
        navigate({ to: "/dashboard" });
      } else {
        navigate({ to: "/login" });
      }
    }
  }, [loading, user, navigate]);

  return null;
}

