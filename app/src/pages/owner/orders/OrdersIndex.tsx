import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  ORDERS_LIST_QUERY_KEY,
  listMyOrders,
  type OrderListRow,
} from "@/lib/orders";
import { formatPrice } from "@/lib/shop";

// OrdersIndex — /app/orders
//
// Owner-only order history. RLS on `orders` scopes rows to
// auth.uid(). Pending_payment rows from canceled Stripe sessions
// are filtered client-side so the table shows only actionable
// rows (paid / refunded / failed / awaiting_merchant_setup).
export default function OrdersIndex() {
  const query = useQuery<OrderListRow[]>({
    queryKey: ORDERS_LIST_QUERY_KEY,
    queryFn: listMyOrders,
    staleTime: 30 * 1000,
  });

  const all = query.data ?? [];
  const visible = all.filter((o) => o.status !== "pending_payment");

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl text-primary">Your orders</h1>
        <p className="text-sm text-muted-foreground">
          Receipts and history from the shop.
        </p>
      </header>

      {query.isLoading ? (
        <OrdersSkeleton />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load your orders</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Please refresh the page or try again in a moment.</p>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <EmptyState />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((o) => (
                  <OrderRowView key={o.id} order={o} />
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

function OrderRowView({ order }: { order: OrderListRow }) {
  const date = new Date(order.created_at);
  const label = Number.isFinite(date.valueOf())
    ? DATE_FORMATTER.format(date)
    : "—";
  const itemsLabel =
    order.unit_count > 0
      ? `${order.unit_count} item${order.unit_count === 1 ? "" : "s"}`
      : "—";

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-sm">{label}</TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {itemsLabel}
      </TableCell>
      <TableCell className="font-display text-sm tabular-nums">
        {formatPrice(order.total_cents)}
      </TableCell>
      <TableCell>
        <OrderStatusBadge status={order.status} />
      </TableCell>
      <TableCell className="text-right">
        <Button asChild size="sm" variant="outline">
          <Link to={`/app/orders/${order.id}`}>View</Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No orders yet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>Head to the shop to browse Silver Lining's catalog.</p>
        <Button asChild>
          <Link to="/app/shop">
            <ShoppingBag size={16} />
            Go to shop
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function OrdersSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 w-full animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}
