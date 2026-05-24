import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCurrency } from "@/hooks/use-currency";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { SUPPORTED_CURRENCIES } from "@/lib/expense-shared";

export function CurrencySwitcher() {
  const { currency, setCurrency } = useCurrency();
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Display</span>
      <Select
        value={currency}
        onValueChange={(v) => setCurrency(v as (typeof SUPPORTED_CURRENCIES)[number])}
      >
        <SelectTrigger className="h-8 w-[95px] border-border bg-card text-foreground font-semibold shadow-sm hover:bg-muted/50 cursor-pointer transition-colors duration-150">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {CURRENCY_OPTIONS.map((c) => (
            <SelectItem key={c.code} value={c.code}>{c.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
