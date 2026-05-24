import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2,
  Sparkles,
  TrendingUp,
  Briefcase,
  User,
  AlertCircle,
  Inbox,
  Image as ImageIcon,
  FileText,
  Mic,
  Square,
  X,
  Paperclip,
  Building2,
  CalendarIcon,
  Layers,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { CurrencySwitcher } from "@/components/currency-switcher";
import { MasterUpload } from "@/components/master-upload";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { parseExpenseWithAI } from "@/lib/expenses.functions";
import { useAuth } from "@/hooks/use-auth";
import { useCurrency } from "@/hooks/use-cur
<truncated 34273 bytes>
       </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Toaster />
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  currency,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  currency: string;
  tone: "default" | "primary" | "muted";
}) {
  const accent =
    tone === "primary"
      ? "bg-gradient-to-tr from-[var(--metallic-gold-dark)] to-[var(--primary)] text-[var(--background)] shadow-md"
      : tone === "muted"
        ? "bg-[var(--muted)] text-[var(--primary)] border border-[var(--border)]/40"
        : "bg-[var(--primary)]/15 text-[var(--primary)] border border-[var(--primary)]/30";

  const formatted = formatCurrency(value, currency);
  const match = formatted.match(/^([^\d\-]*)(.*)$/);
  const symbol = match?.[1] ?? "";
  const rest = match?.[2] ?? formatted;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]/40 p-5 shadow-[var(--shadow-luxury)] backdrop-blur-sm hover:border-[var(--primary)]/50 transition-all">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-[var(--slate-gray)] font-bold">
          {label}
        </span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${accent}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <div className="mt-4 text-3xl font-extrabold tracking-tight text-[var(--foreground)] font-mono">
        <span className="text-[var(--primary)] mr-0.5">{symbol}</span>{rest}
      </div>
    </div>
  );
}
