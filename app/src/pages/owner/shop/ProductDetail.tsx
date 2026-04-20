import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Minus, Plus, ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  SHOP_PRODUCT_QUERY_KEY,
  formatPrice,
  getProduct,
  type ShopProduct,
} from "@/lib/shop";
import { useCart } from "@/lib/cart";
import { CartButton } from "@/components/shop/CartButton";
import { notify } from "@/lib/toast";

// ProductDetail — /app/shop/:handle
//
// Image, title, price, description, qty stepper, and "Add to cart".
// Cart itself lands in Prompt 3.4 (CartProvider). For now, the button
// is wired but toasts a placeholder until the provider is mounted.
export default function ProductDetail() {
  const { handle = "" } = useParams();
  const [qty, setQty] = useState(1);

  const query = useQuery<ShopProduct>({
    queryKey: [...SHOP_PRODUCT_QUERY_KEY, handle],
    queryFn: () => getProduct(handle),
    enabled: handle.length > 0,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/app/shop">
            <ArrowLeft size={16} />
            Back to shop
          </Link>
        </Button>
        <CartButton />
      </div>

      {query.isLoading ? (
        <ProductDetailSkeleton />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load this product</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              It may have been removed from the catalog. Head back to the shop
              to browse what's available.
            </p>
          </CardContent>
        </Card>
      ) : query.data ? (
        <ProductView product={query.data} qty={qty} onQtyChange={setQty} />
      ) : null}
    </div>
  );
}

function ProductView({
  product,
  qty,
  onQtyChange,
}: {
  product: ShopProduct;
  qty: number;
  onQtyChange: (next: number) => void;
}) {
  const cart = useCart();
  const outOfStock = !product.available;
  const maxQty =
    product.inventory_qty != null && product.inventory_qty > 0
      ? product.inventory_qty
      : 99;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="aspect-square w-full overflow-hidden rounded-lg border border-border bg-muted">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            No image
          </div>
        )}
      </div>

      <div className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display text-2xl text-primary">
              {product.title}
            </h1>
            {outOfStock ? (
              <Badge variant="outline">Out of stock</Badge>
            ) : (
              <Badge variant="secondary">In stock</Badge>
            )}
          </div>
          <p className="font-display text-2xl text-foreground">
            {formatPrice(product.price_cents)}
          </p>
          {product.category && (
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {product.category}
            </p>
          )}
        </div>

        {product.description && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
            {product.description}
          </p>
        )}

        <div className="flex items-center gap-3">
          <div
            className="flex items-center rounded-md border border-border"
            role="group"
            aria-label="Quantity"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Decrease quantity"
              disabled={outOfStock || qty <= 1}
              onClick={() => onQtyChange(Math.max(1, qty - 1))}
            >
              <Minus size={16} />
            </Button>
            <span
              className="w-10 text-center text-sm tabular-nums"
              aria-live="polite"
            >
              {qty}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Increase quantity"
              disabled={outOfStock || qty >= maxQty}
              onClick={() => onQtyChange(Math.min(maxQty, qty + 1))}
            >
              <Plus size={16} />
            </Button>
          </div>
          <Button
            type="button"
            className="flex-1"
            disabled={outOfStock}
            onClick={() => {
              cart.addItem(product.shopify_variant_id, qty);
              notify.success(
                `Added ${qty} × ${product.title} to cart.`
              );
            }}
          >
            <ShoppingBag size={16} />
            Add to cart
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProductDetailSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="aspect-square w-full animate-pulse rounded-lg bg-muted/40" />
      <div className="space-y-4">
        <div className="h-8 w-3/4 animate-pulse rounded bg-muted/40" />
        <div className="h-6 w-1/4 animate-pulse rounded bg-muted/40" />
        <div className="h-20 w-full animate-pulse rounded bg-muted/40" />
        <div className="h-10 w-full animate-pulse rounded bg-muted/40" />
      </div>
    </div>
  );
}
