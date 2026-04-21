import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADMIN_SUBSCRIPTIONS_QUERY_KEY,
  listAdminSubscriptions,
  type SubscriptionRow,
  type SubscriptionStatus,
  type SubscriptionTab,
} from "@/lib/subscriptions";
import { mapSupabaseError } from "@/lib/errors";

// /admin/subscriptions — Phase 6.5.
//
// Read-through cache of stripe_subscriptions, refreshed by
// customer.subscription.* + invoice.payment_succeeded/failed webhooks.
// Source of truth is Stripe; this table is a snapshot for the panel.
// Subscription creation is OUT OF SCOPE for v1 — SLH emails Checkout
// links manually to the 20 beta owners.

const TAB_ORDER: SubscriptionTab[] = ["active", "past_due", "canceled", "all"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export function formatCents(cents: number | null, currency: string | null): string {
  if (cents == null) return "—";
  const ccy = (currency || "usd").toUpperCase();
  return `${(cents / 100).toFixed(2)} ${ccy}`;
}

function statusVariant(status: SubscriptionStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active" || status === "trialing") return "default";
  if (status === "past_due" || status === "unpaid") return "destructive";
  if (status === "canceled" || status === "incomplete_expired") return "outline";
  return "secondary";
}

function describeItems(row: SubscriptionRow): string {
  if (!row.items?.length) return "—";
  return row.items
    .map((i) => {
      const label = i.sku || i.product_id || i.price_id || "item";
      const qty = i.quantity ?? 1;
      const interval = i.interval ? `/${i.interval}` : "";
      return `${label} × ${qty}${interval}`;
    })
    .join(", ");
}

export default function SubscriptionsIndex() {
  const [tab, setTab] = useState<SubscriptionTab>("active");

  const q = useQuery({
    queryKey: [...ADMIN_SUBSCRIPTIONS_QUERY_KEY, { tab }] as const,
    queryFn: () => listAdminSubscriptions(tab),
    refetchInterval: 60_000,
  });

  const rows = q.data ?? [];
  const errorMessage = useMemo(
    () => (q.isError ? mapSupabaseError(q.error as Error) : null),
    [q.isError, q.error],
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Subscriptions</h1>
        <p className="text-sm text-muted-foreground">
          Auto-ship subscriptions mirrored from Stripe. Use the row to cancel at
          period end or pause collection.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as SubscriptionTab)}>
        <TabsList>
          {TAB_ORDER.map((t) => (
            <TabsTrigger key={t} value={t}>
              {labelForTab(t)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Current period</TableHead>
                <TableHead>Renews</TableHead>
                <TableHead className="text-right">Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    Loading subscriptions…
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-destructive">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground">
                    No subscriptions in this view.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {row.owner_display_name || row.owner_email || "(no owner)"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {row.owner_email || row.customer_id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <span className="text-xs text-muted-foreground">
                        {describeItems(row)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.status)}>
                        {row.status.replace(/_/g, " ")}
                      </Badge>
                      {row.cancel_at_period_end ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          cancels at period end
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(row.current_period_start)} →{" "}
                        {formatDate(row.current_period_end)}
                      </span>
                    </TableCell>
                    <TableCell>
                      {row.status === "canceled"
                        ? "—"
                        : formatDate(row.current_period_end)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/admin/subscriptions/${encodeURIComponent(row.id)}`}
                        className="text-sm text-primary hover:underline"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function labelForTab(t: SubscriptionTab): string {
  switch (t) {
    case "active":    return "Active";
    case "past_due":  return "Past due";
    case "canceled":  return "Cancelled";
    case "all":       return "All";
    default:          return t.replace(/_/g, " ");
  }
}
