import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// CategoryPills — horizontal scrollable row of category filters.
// `null` selected value means "All". Uses shadcn Button variant="outline"
// with bg-secondary on the active pill.
export function CategoryPills({
  categories,
  selected,
  onSelect,
}: {
  categories: string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <div
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
      role="tablist"
      aria-label="Product categories"
    >
      <Pill active={selected === null} onClick={() => onSelect(null)}>
        All
      </Pill>
      {categories.map((cat) => (
        <Pill
          key={cat}
          active={selected === cat}
          onClick={() => onSelect(cat)}
        >
          {titleCase(cat)}
        </Pill>
      ))}
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full",
        active && "bg-secondary text-secondary-foreground hover:bg-secondary"
      )}
    >
      {children}
    </Button>
  );
}

function titleCase(s: string): string {
  return s
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}
