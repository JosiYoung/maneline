import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrderStatusBadge } from "@/components/owner/OrderStatusBadge";
import {
  ORDER_QUERY_KEY,
  getOrder,
  type OrderDetailResponse,
} from "@/lib/orders";
import { formatPrice } from "@/lib/shop";

// OrderDetail — the `/app/orders/:id` content when there's no
// ?checkout= query param (i.e. the owner navigated from the
// OrdersIndex table rather than from Stripe's redirect).
//
// Reads go through the Worker which forwards to PostgREST with
// the owner's JWT — RLS enforces auth on both orders and
// order_line_items.
export default function OrderDetail({ orderId }: { orderId: string }) {
  const query = useQuery<OrderDetailResponse>({
    queryKey: [...ORDER_QUERY_KEY, orderId],
    queryFn: () => getOrder(orderId),
    enabled: orderId.length > 0,
  });

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/app/orders">
            <ArrowLeft size={16} />
            Back to orders
          </Link>
        </Button>
      </div>

      {query.isLoading ? (
        <OrderDetailSkeleton />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load this order</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              It may have been removed, or the link may be stale. Head back to
              your orders.
            </p>
          </CardContent>
        </Card>
      ) : query.data ? (
        <OrderDetailView data={query.data} />
      ) : null}
    </div>
  );
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function OrderDetailView({ data }: { data: OrderDetailResponse }) {
  const { order, line_items: lines, refunds } = data;
  const refundedCents = refunds
    .filter((r) => r.stripe_status === "succeeded")
    .reduce((s, r) => s + r.amount_cents, 0);
  const date = new Date(order.created_at);
  const label = Number.isFinite(date.valueOf())
    ? DATE_FORMATTER.format(date)
    : "—";

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Order #{order.id.slice(0, 8)}</CardTitle>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
        <OrderStatusBadge status={order.status} />
      </CardHeader>
      <CardContent className="space-y-5">
        {lines.length > 0 ? (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit</TableHead>
                  <TableHead className="text-right">Line total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((li) => (
                  <TableRow key={li.id}>
                    <TableCell className="text-sm">
                      <p className="font-medium text-foreground">
                        {li.title_snapshot}
                      </p>
                      {li.sku_snapshot && (
                        <p className="text-xs text-muted-foreground">
                          SKU {li.sku_snapshot}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {li.quantity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatPrice(li.unit_price_cents)}
                    </TableCell>
                    <TableCell className="text-right font-display tabular-nums">
                      {formatPrice(li.line_total_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {order.status === "awaiting_merchant_setup"
              ? "We saved your order. You'll see line items here once it's processed."
              : "No line items on this order."}
          </p>
        )}

        <Separator />

        <dl className="space-y-1 text-sm">
          <Row
            label="Subtotal"
            value={formatPrice(order.subtotal_cents)}
          />
          {order.shipping_cents > 0 && (
            <Row
              label="Shipping"
              value={formatPrice(order.shipping_cents)}
            />
          )}
          {order.tax_cents > 0 && (
            <Row label="Tax" value={formatPrice(order.tax_cents)} />
          )}
          <Row
            label="Total"
            value={formatPrice(order.total_cents)}
            emphasized
          />
          {refundedCents > 0 && (
            <Row
              label="Refunded"
              value={`− ${formatPrice(refundedCents)}`}
            />
          )}
        </dl>

        {order.status === "failed" && order.failure_message && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {order.failure_message}
          </p>
        )}

        {order.stripe_receipt_url && (
          <Button asChild variant="outline" className="w-full sm:w-auto">
            <a
              href={order.stripe_receipt_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} />
              View Stripe receipt
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
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
      <dt
        className={
          emphasized ? "font-medium text-foreground" : "text-muted-foreground"
        }
      >
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

function OrderDetailSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-4 py-6">
        <div className="h-6 w-1/3 animate-pulse rounded bg-muted/40" />
        <div className="h-32 w-full animate-pulse rounded bg-muted/40" />
        <div className="h-20 w-full animate-pulse rounded bg-muted/40" />
      </CardContent>
    </Card>
  );
}
