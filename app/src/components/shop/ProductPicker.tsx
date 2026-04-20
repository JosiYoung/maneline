import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Check } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  SHOP_PRODUCTS_QUERY_KEY,
  formatPrice,
  listProducts,
  type ShopProduct,
} from "@/lib/shop";

// ProductPicker — inline supplement picker used by ExpenseForm when
// category === 'supplement'. Shadcn Command + Popover aren't installed
// in this project yet, so we render a search Input + scrollable result
// list directly in the form. Selecting a product:
//   - sets picker state in the parent
//   - parent prefills amount / vendor / product_id on the expense form
//
// Data comes from listProducts('supplement') — filtered client-side
// for available=true. The shop endpoint is already KV-cached at the
// edge (5-min TTL), so re-opening the picker after a page reload is
// effectively instant.

export interface ProductPickerProps {
  selectedVariantId: string | null;
  onSelect: (product: ShopProduct | null) => void;
  disabled?: boolean;
}

export function ProductPicker({
  selectedVariantId,
  onSelect,
  disabled,
}: ProductPickerProps) {
  const [term, setTerm] = useState("");

  const query = useQuery({
    queryKey: [...SHOP_PRODUCTS_QUERY_KEY, "supplement"],
    queryFn: () => listProducts("supplement"),
    staleTime: 5 * 60 * 1000,
  });

  const all = query.data?.products ?? [];
  const available = useMemo(
    () => all.filter((p) => p.available !== false),
    [all],
  );

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    if (!t) return available;
    return available.filter((p) => {
      const hay =
        `${p.title} ${p.sku} ${p.description ?? ""}`.toLowerCase();
      return hay.includes(t);
    });
  }, [available, term]);

  const selected =
    selectedVariantId
      ? all.find((p) => p.shopify_variant_id === selectedVariantId) ?? null
      : null;

  return (
    <div
      className="rounded-md border border-border bg-card"
      aria-label="Silver Lining product picker"
    >
      <div className="border-b border-border p-2.5">
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute inset-y-0 left-3 my-auto text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search Silver Lining supplements…"
            className="pl-8"
            disabled={disabled}
          />
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {query.isLoading ? (
          <ListSkeleton />
        ) : query.isError ? (
          <p className="p-4 text-sm text-destructive">
            Couldn't load the catalog. Try reopening this form.
          </p>
        ) : available.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No Silver Lining supplements are in stock right now.
          </p>
        ) : filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No matches for "{term.trim()}".
          </p>
        ) : (
          <ul role="listbox" className="divide-y divide-border">
            {filtered.map((p) => {
              const isSelected =
                selected?.shopify_variant_id === p.shopify_variant_id;
              return (
                <li key={p.shopify_variant_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => onSelect(isSelected ? null : p)}
                    disabled={disabled}
                    className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:outline-none ${
                      isSelected ? "bg-secondary" : ""
                    }`}
                  >
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt=""
                        className="h-10 w-10 flex-shrink-0 rounded border border-border object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <div
                        className="h-10 w-10 flex-shrink-0 rounded border border-border bg-muted/40"
                        aria-hidden="true"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {p.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {p.sku}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="font-display text-sm tabular-nums text-foreground">
                        {formatPrice(p.price_cents)}
                      </p>
                      {isSelected && (
                        <span className="mt-1 inline-flex items-center gap-1 text-xs text-accent">
                          <Check size={12} aria-hidden="true" />
                          Selected
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-0 divide-y divide-border">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex animate-pulse items-center gap-3 px-3 py-2.5"
        >
          <div className="h-10 w-10 rounded bg-muted/40" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-2/3 rounded bg-muted/40" />
            <div className="h-2 w-1/3 rounded bg-muted/40" />
          </div>
          <div className="h-4 w-10 rounded bg-muted/40" />
        </div>
      ))}
    </div>
  );
}
