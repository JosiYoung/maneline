import { cn } from "@/lib/utils";
import type { BusinessPeriod } from "@/lib/trainerBusiness";
import { periodLabel } from "@/lib/trainerBusiness";

const OPTIONS: BusinessPeriod[] = ["last_30d", "last_90d", "ytd"];

interface Props {
  value: BusinessPeriod;
  onChange: (p: BusinessPeriod) => void;
}

export function PeriodToggle({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Business period"
      className="inline-flex rounded-md border bg-card p-1"
    >
      {OPTIONS.map((p) => (
        <button
          key={p}
          role="tab"
          aria-selected={p === value}
          onClick={() => onChange(p)}
          className={cn(
            "rounded px-3 py-1.5 text-xs font-medium transition-colors",
            p === value
              ? "bg-secondary text-primary"
              : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
          )}
        >
          {periodLabel(p)}
        </button>
      ))}
    </div>
  );
}
