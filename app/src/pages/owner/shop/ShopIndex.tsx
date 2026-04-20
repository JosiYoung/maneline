import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProductCard } from "@/components/shop/ProductCard";
import { CategoryPills } from "@/components/shop/CategoryPills";
import { CartButton } from "@/components/shop/CartButton";
import {
  SHOP_PRODUCTS_QUERY_KEY,
  listProducts,
  type ShopListResponse,
} from "@/lib/shop";

// ShopIndex — /app/shop
//
// Silver Lining Herbs catalog. Category pills filter in-memory once the
// full list is loaded (the Worker returns everything; KV-cached 5min).
export default function ShopIndex() {
  const [category, setCategory] = useState<string | null>(null);

  const query = useQuery<ShopListResponse>({
    queryKey: SHOP_PRODUCTS_QUERY_KEY,
    queryFn: () => listProducts(),
    staleTime: 5 * 60 * 1000,
  });

  const products = useMemo(() => {
    const all = query.data?.products ?? [];
    return category ? all.filter((p) => p.category === category) : all;
  }, [query.data, category]);

  const categories = query.data?.categories ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl text-primary">
            Silver Lining Herbs
          </h1>
          <p className="text-sm text-muted-foreground">
            Herbal supplements from our partner. Orders ship directly to you.
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <CartButton />
        </div>
      </header>

      {categories.length > 0 && (
        <CategoryPills
          categories={categories}
          selected={category}
          onSelect={setCategory}
        />
      )}

      {query.isLoading ? (
        <ProductGridSkeleton />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load the catalog</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Please refresh or check your internet connection.</p>
          </CardContent>
        </Card>
      ) : products.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {category ? "No products in this category." : "No products yet."}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              {category
                ? "Try another category — the full catalog is still there."
                : "Check back soon — the catalog syncs hourly from Silver Lining Herbs."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <li key={p.handle}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductGridSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li
          key={i}
          className="h-[280px] animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </ul>
  );
}
