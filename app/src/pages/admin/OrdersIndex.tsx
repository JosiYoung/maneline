import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { OrderStatusBadge } from "@/components/owner/OrderStatusBadge";
import { mapSupabaseError } from "@/lib/errors";
import {
  ADMIN_ORDERS_LIST_QUERY_KEY,
  listAdminOrders,
  type AdminOrderListRow,
  type OrderStatus,
} from "@/lib/orders";
import { formatPrice } from "@/lib/shop";

type StatusFilter = "" | OrderStatus;

// OrdersIndex — /admin/orders
//
// Shop + in-expense orders. Refund action lives on the detail page so
// the admin always sees the current refund history + remaining balance
// before confirming.

export default function OrdersIndex() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [page, setPage] = useState(0);

  const ordersQ = useQuery({
    queryKey: [...ADMIN_ORDERS_LIST_QUERY_KEY, { q, status, page }] as const,
    queryFn: () => listAdminOrders({ q, status, page }),
    placeholderData: (previous) => previous,
  });

  const rows = ordersQ.data?.rows ?? [];
  const total = ordersQ.data?.total ?? 0;
  const limit = ordersQ.data?.limit ?? 50;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Orders</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Shop orders and in-expense charges. Search by owner email; refunds
          issue from the order detail page.
        </p>
      </div>

      <Card>
        <CardContent className="py-4">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(0);
            }}
          >
            <div className="min-w-[240px] flex-1">
              <label className="text-xs text-muted-foreground">Owner email</label>
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="cedric@…"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value as StatusFilter);
                  setPage(0);
                }}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All statuses</option>
                <option value="paid">Paid</option>
                <option value="pending_payment">Pending payment</option>
                <option value="awaiting_merchant_setup">Awaiting setup</option>
                <option value="refunded">Refunded</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <Button type="submit">Search</Button>
          </form>
        </CardContent>
      </Card>

      {ordersQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn't load orders. {mapSupabaseError(ordersQ.error as Error)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersQ.isLoading && rows.length === 0 ? (
                  <LoadingRow />
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      No orders match.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((o) => <OrderRow key={o.id} o={o} />)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <div>
          {total.toLocaleString()} {total === 1 ? "order" : "orders"}
          {pages > 1 ? ` · page ${page + 1} of ${pages}` : ""}
        </div>
        {pages > 1 ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              disabled={page + 1 >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function OrderRow({ o }: { o: AdminOrderListRow }) {
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">
        <Link
          to={`/admin/orders/${o.id}`}
          className="text-foreground underline-offset-2 hover:underline"
        >
          {o.id.slice(0, 8)}
        </Link>
      </TableCell>
      <TableCell className="text-xs">
        <div className="font-mono">{o.owner_email ?? "—"}</div>
        {o.owner_display_name ? (
          <div className="text-muted-foreground">{o.owner_display_name}</div>
        ) : null}
      </TableCell>
      <TableCell>
        <OrderStatusBadge status={o.status} />
      </TableCell>
      <TableCell className="capitalize text-xs text-muted-foreground">
        {o.source.replace("_", " ")}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatPrice(o.total_cents)}
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {new Date(o.created_at).toLocaleDateString()}
      </TableCell>
    </TableRow>
  );
}

function LoadingRow() {
  return (
    <TableRow>
      <TableCell colSpan={6} className="py-6">
        <div className="h-6 w-full animate-pulse rounded bg-muted/50" />
      </TableCell>
    </TableRow>
  );
}
