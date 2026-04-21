import { Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiTileProps {
  label: string;
  value: string;
  tone?: "default" | "positive" | "negative" | "muted";
  sublabel?: string;
  /** Optional hover-tooltip content, rendered only when provided. */
  tooltip?: React.ReactNode;
}

export function KpiTile({ label, value, tone = "default", sublabel, tooltip }: KpiTileProps) {
  const toneClass =
    tone === "positive" ? "text-emerald-600"
    : tone === "negative" ? "text-destructive"
    : tone === "muted" ? "text-muted-foreground"
    : "text-foreground";

  return (
    <Card>
      <CardContent className="group relative space-y-1 py-4">
        <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <span>{label}</span>
          {tooltip && (
            <Info
              size={12}
              aria-label={`${label} details`}
              className="cursor-help text-muted-foreground/70"
            />
          )}
        </div>
        <div className={cn("font-display text-2xl", toneClass)}>{value}</div>
        {sublabel && <div className="text-xs text-muted-foreground">{sublabel}</div>}
        {tooltip && (
          <div
            role="tooltip"
            className={cn(
              "pointer-events-none absolute left-0 top-full z-10 mt-1 w-64 rounded-md border bg-popover p-3 text-xs text-popover-foreground shadow-lg",
              "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
            )}
          >
            {tooltip}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
