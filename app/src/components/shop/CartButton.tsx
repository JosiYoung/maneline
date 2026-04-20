import { useState } from "react";
import { ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { CartSheet } from "./CartSheet";

// CartButton — header widget on shop surfaces. Badge shows total
// line-item quantity (not unique SKUs) so "5" means "5 bottles".
export function CartButton() {
  const [open, setOpen] = useState(false);
  const { lineCount } = useCart();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label={`Open cart (${lineCount} item${lineCount === 1 ? "" : "s"})`}
        className="relative"
      >
        <ShoppingBag size={16} />
        <span>Cart</span>
        {lineCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            {lineCount}
          </span>
        )}
      </Button>
      <CartSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
