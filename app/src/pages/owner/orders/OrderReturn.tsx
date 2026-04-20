import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock, ShoppingBag, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  ORDER_QUERY_KEY,
  getOrder,
  type OrderDetailResponse,
} from "@/lib/orders";
import { formatPrice } from "@/lib/shop";
import { clearCart } from "@/lib/cart";
import { OrderStatusBadge } from "@/components/owner/OrderStatusBadge";
import OrderDetail from "./OrderDetail";

// OrderReturn — /app/orders/:id
//
// Stripe Checkout redirects back to us via ?checkout=success or
// ?checkout=cancel. This dispatcher picks the matching card. When
// no ?checkout is present (future OrderDetail from 3.6), we show a
// minimal "coming soon" placeholder.
export default function OrderReturn() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const mode = params.get("checkout");

  if (mode === "success") return <OrderSuccess orderId={id} />;
  if (mode === "cancel")  return <OrderCancel  orderId={id} />;
  return <OrderDetail orderId={id} />;
}

// ---------------------------------------------------------------
// Success — polls until the webhook flips status=paid, then shows
// the full receipt card. If 6 polls (≈12s) elapse without the flip
// we drop into a "we're still confirming" state but keep rendering
// the rest of the order.
// ---------------------------------------------------------------
const MAX_POLLS = 6;
const POLL_INTERVAL_MS = 2000;

function OrderSuccess({ orderId }: { orderId: string }) {
  const [pollCount, setPollCount] = useState(0);

  // One-shot clear of the SPA cart when we land on the success page.
  // We already do this in CartSheet when checkout starts, but Stripe
  // redirects can happen hours later on delayed methods.
  useEffect(() => {
    clearCart();
  }, []);

  const query = useQuery<OrderDetailResponse>({
    queryKey: [...ORDER_QUERY_KEY, orderId],
    queryFn: () => getOrder(orderId),
    enabled: orderId.length > 0,
    refetchInterval: (q) => {
      const data = q.state.data;
      if (data?.order.status === "paid" || data?.order.status === "refunded") {
        return false;
      }
      if (pollCount >= MAX_POLLS) return false;
      return POLL_INTERVAL_MS;
    },
  });

  useEffect(() => {
    if (query.isFetched && query.data?.order.status !== "paid") {
      setPollCount((n) => n + 1);
    }
  }, [query.isFetched, query.data, query.dataUpdatedAt]);

  const order = query.data?.order;
  const lines = query.data?.line_items ?? [];
  const stillWaiting =
    !order ||
    (order.status !== "paid" &&
      order.status !== "refunded" &&
      pollCount < MAX_POLLS);
  const timedOut =
    order &&
    order.status !== "paid" &&
    order.status !== "refunded" &&
    pollCount >= MAX_POLLS;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/app/shop">
            <ArrowLeft size={16} />
            Back to shop
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <div className="rounded-full bg-accent/20 p-2">
            {stillWaiting ? (
              <Clock size={20} className="text-accent" aria-hidden="true" />
            ) : (
              <CheckCircle2 size={20} className="text-accent" aria-hidden="true" />
            )}
          </div>
          <div className="space-y-1">
            <CardTitle>
              {stillWaiting
                ? "Finalizing your order…"
                : timedOut
                  ? "We're still confirming with your bank"
                  : "Your order is confirmed"}
            </CardTitle>
            <CardDescription>
              {stillWaiting
                ? "Hang tight — we're waiting for Stripe to confirm the charge."
                : timedOut
                  ? "You'll get an email once it clears. Safe to close this page."
                  : "A receipt is on its way to your inbox."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {stillWaiting && !order ? (
            <OrderSummarySkeleton />
          ) : order ? (
            <OrderSummary order={order} lines={lines} />
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1">
              <Link to="/app/shop">
                <ShoppingBag size={16} />
                Back to shop
              </Link>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link to="/app/orders">View all orders</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------
// Cancel — cart is preserved (we don't clear it). Friendly copy;
// the order row stays `pending_payment` and is hidden from the
// owner orders list (3.6 filters to terminal statuses).
// ---------------------------------------------------------------
function OrderCancel({ orderId }: { orderId: string }) {
  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/app/shop">
            <ArrowLeft size={16} />
            Back to shop
          </Link>
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start gap-3 space-y-0">
          <div className="rounded-full bg-muted p-2">
            <XCircle size={20} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <CardTitle>Checkout canceled</CardTitle>
            <CardDescription>
              No charge was made. Your cart is still saved — pick up where you
              left off when you're ready.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button asChild className="flex-1">
              <Link to="/app/shop">
                <ShoppingBag size={16} />
                Back to shop
              </Link>
            </Button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Order ref: <span className="font-mono">{orderId.slice(0, 8)}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function OrderSummary({
  order,
  lines,
}: {
  order: NonNullable<OrderDetailResponse["order"]>;
  lines: OrderDetailResponse["line_items"];
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Status</span>
        <OrderStatusBadge status={order.status} />
      </div>

      {lines.length > 0 && (
        <div className="rounded-md border border-border">
          <ul className="divide-y divide-border">
            {lines.map((li) => (
              <li
                key={li.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {li.title_snapshot}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Qty {li.quantity} × {formatPrice(li.unit_price_cents)}
                  </p>
                </div>
                <p className="whitespace-nowrap font-display text-sm text-foreground">
                  {formatPrice(li.line_total_cents)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Separator />

      <dl className="space-y-1 text-sm">
        <Row label="Subtotal" value={formatPrice(order.subtotal_cents)} />
        {order.shipping_cents > 0 && (
          <Row label="Shipping" value={formatPrice(order.shipping_cents)} />
        )}
        {order.tax_cents > 0 && (
          <Row label="Tax" value={formatPrice(order.tax_cents)} />
        )}
        <Row
          label="Total"
          value={formatPrice(order.total_cents)}
          emphasized
        />
      </dl>
    </div>
  );
}

function Row({
  label,
  value,
  emphasized,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={emphasized ? "font-medium text-foreground" : "text-muted-foreground"}>
        {label}
      </dt>
      <dd
        className={
          emphasized
            ? "font-display text-base text-foreground"
            : "tabular-nums text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function OrderSummarySkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-4 w-1/3 animate-pulse rounded bg-muted/40" />
      <div className="h-16 w-full animate-pulse rounded bg-muted/40" />
      <div className="h-4 w-1/4 animate-pulse rounded bg-muted/40" />
    </div>
  );
}
