import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatPrice, type ShopProduct } from "@/lib/shop";

// ProductCard — reusable tile for the Silver Lining catalog grid.
// Image, title, price, in-stock chip. Tapping the whole card navigates
// to /app/shop/:handle.
export function ProductCard({ product }: { product: ShopProduct }) {
  const outOfStock = !product.available;
  return (
    <Link
      to={`/app/shop/${encodeURIComponent(product.handle)}`}
      className={cn(
        "group block rounded-lg transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      <Card
        className={cn(
          "h-full overflow-hidden border-border bg-card",
          "group-hover:border-primary"
        )}
      >
        <div className="aspect-square w-full overflow-hidden bg-muted">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.title}
              loading="lazy"
              className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
              No image
            </div>
          )}
        </div>
        <CardContent className="space-y-2 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-sm font-medium text-foreground">
              {product.title}
            </p>
            {outOfStock ? (
              <Badge variant="outline" className="shrink-0">
                Out
              </Badge>
            ) : (
              <Badge variant="secondary" className="shrink-0">
                In stock
              </Badge>
            )}
          </div>
          <p className="font-display text-lg text-primary">
            {formatPrice(product.price_cents)}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}
