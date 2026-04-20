import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  SHOP_PRODUCTS_QUERY_KEY,
  createCheckout,
  formatPrice,
  listProducts,
  type ShopListResponse,
  type ShopProduct,
} from "@/lib/shop";
import { useCart, type CartItem } from "@/lib/cart";
import { notify } from "@/lib/toast";

// CartSheet — shadcn Sheet listing cart items with qty steppers +
// subtotal + hosted-Checkout CTA. Re-resolves each cart item against
// the cached /api/shop/products list (so prices always match the
// server view; the Worker re-validates too before minting the session).
export function CartSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const cart = useCart();
  const [redirecting, setRedirecting] = useState(false);

  const catalog = useQuery<ShopListResponse>({
    queryKey: SHOP_PRODUCTS_QUERY_KEY,
    queryFn: () => listProducts(),
    staleTime: 5 * 60 * 1000,
  });

  const resolved = useMemo(() => {
    const byVariant = new Map<string, ShopProduct>();
    for (const p of catalog.data?.products ?? []) {
      byVariant.set(p.shopify_variant_id, p);
    }
    return cart.items.map((item) => ({
      item,
      product: byVariant.get(item.variantId) ?? null,
    }));
  }, [catalog.data, cart.items]);

  const subtotalCents = resolved.reduce(
    (sum, r) => sum + (r.product?.price_cents ?? 0) * r.item.qty,
    0
  );
  const hasOutOfStock = resolved.some(
    (r) => r.product != null && !r.product.available
  );
  const hasUnresolved = resolved.some((r) => r.product == null);
  const empty = cart.items.length === 0;
  const disabled =
    empty || hasOutOfStock || hasUnresolved || redirecting || catalog.isLoading;

  async function handleCheckout() {
    if (disabled) return;
    setRedirecting(true);
    try {
      const res = await createCheckout(
        cart.items.map((i) => ({ variant_id: i.variantId, qty: i.qty }))
      );
      if (res.status === "awaiting_merchant_setup") {
        notify.info(
          "Silver Lining hasn't finished payment setup yet — we saved your order and will email you when it's ready."
        );
        cart.clear();
        onOpenChange(false);
        return;
      }
      window.location.assign(res.url);
    } catch (err) {
      setRedirecting(false);
      notify.error(
        err instanceof Error ? err.message : "Couldn't start checkout."
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Your cart</SheetTitle>
          <SheetDescription>
            Tax + shipping calculated at checkout.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex-1 overflow-y-auto">
          {empty ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Your cart is empty.
            </div>
          ) : (
            <ul className="space-y-3">
              {resolved.map(({ item, product }) => (
                <CartRow
                  key={item.variantId}
                  item={item}
                  product={product}
                  onInc={() =>
                    cart.setQty(item.variantId, item.qty + 1)
                  }
                  onDec={() => cart.setQty(item.variantId, item.qty - 1)}
                  onRemove={() => cart.removeItem(item.variantId)}
                />
              ))}
            </ul>
          )}
        </div>

        <Separator className="my-4" />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-display text-lg text-foreground">
              {formatPrice(subtotalCents)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Tax + shipping calculated at checkout.
          </p>
          {hasOutOfStock && (
            <p className="text-xs text-destructive">
              Remove out-of-stock items to continue.
            </p>
          )}
          <Button
            type="button"
            className="w-full"
            disabled={disabled}
            onClick={handleCheckout}
          >
            {redirecting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Redirecting…
              </>
            ) : (
              "Checkout"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function CartRow({
  item,
  product,
  onInc,
  onDec,
  onRemove,
}: {
  item: CartItem;
  product: ShopProduct | null;
  onInc: () => void;
  onDec: () => void;
  onRemove: () => void;
}) {
  const outOfStock = product != null && !product.available;
  const maxQty =
    product?.inventory_qty != null && product.inventory_qty > 0
      ? product.inventory_qty
      : 99;
  const lineTotal = (product?.price_cents ?? 0) * item.qty;

  return (
    <li className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-muted">
        {product?.image_url ? (
          <img
            src={product.image_url}
            alt={product.title}
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-medium text-foreground">
              {product?.title ?? "Unavailable item"}
            </p>
            <p className="text-xs text-muted-foreground">
              {outOfStock
                ? "Out of stock"
                : product
                  ? formatPrice(product.price_cents)
                  : "Price unknown"}
            </p>
          </div>
          <p className="whitespace-nowrap font-display text-sm text-foreground">
            {formatPrice(lineTotal)}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center rounded-md border border-border">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Decrease quantity"
              onClick={onDec}
              disabled={item.qty <= 1}
            >
              <Minus size={14} />
            </Button>
            <span className="w-8 text-center text-sm tabular-nums">
              {item.qty}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Increase quantity"
              onClick={onInc}
              disabled={outOfStock || item.qty >= maxQty}
            >
              <Plus size={14} />
            </Button>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove from cart"
            onClick={onRemove}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </li>
  );
}
