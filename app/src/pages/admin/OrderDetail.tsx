import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { OrderStatusBadge } from "@/components/owner/OrderStatusBadge";
import { parseDollarsToCents } from "@/lib/expenses";
import { mapSupabaseError } from "@/lib/errors";
import {
  ADMIN_ORDER_QUERY_KEY,
  ADMIN_ORDERS_LIST_QUERY_KEY,
  getAdminOrder,
  refundAdminOrder,
  type AdminOrderDetailResponse,
  type AdminOrderRefundRow,
} from "@/lib/orders";
import { formatPrice } from "@/lib/shop";
import { notify } from "@/lib/toast";

// OrderDetail — /admin/orders/:id
//
// Phase 5.5. Refund flow calls POST /api/admin/orders/:id/refund with
// an Idempotency-Key server-side. Partial refunds allowed; the order
// row flips to status='refunded' once the sum of succeeded refunds
// covers total_cents. If Stripe isn't configured the Worker returns
// 501 stripe_not_configured and we surface a friendly toast.

const DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function AdminOrderDetail() {
  const { id } = useParams();
  const orderId = id ?? "";
  const query = useQuery<AdminOrderDetailResponse>({
    queryKey: [...ADMIN_ORDER_QUERY_KEY, orderId],
    queryFn: () => getAdminOrder(orderId),
    enabled: orderId.length > 0,
  });

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/admin/orders">
            <ArrowLeft size={16} />
            Back to orders
          </Link>
        </Button>
      </div>

      {query.isLoading ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            <div className="h-6 w-1/3 animate-pulse rounded bg-muted/40" />
            <div className="h-32 w-full animate-pulse rounded bg-muted/40" />
          </CardContent>
        </Card>
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load this order</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {mapSupabaseError(query.error as Error)}
          </CardContent>
        </Card>
      ) : query.data ? (
        <AdminOrderView data={query.data} />
      ) : null}
    </div>
  );
}

function AdminOrderView({ data }: { data: AdminOrderDetailResponse }) {
  const { order, line_items: lines, refunds } = data;
  const refundedCents = useMemo(
    () =>
      refunds
        .filter((r) => r.stripe_status === "succeeded" || r.stripe_status === "pending")
        .reduce((s, r) => s + r.amount_cents, 0),
    [refunds]
  );
  const remainingCents = Math.max(0, order.total_cents - refundedCents);
  const canRefund =
    (order.status === "paid" || order.status === "refunded") &&
    remainingCents >= 100 &&
    Boolean(order.stripe_payment_intent_id || order.stripe_charge_id);

  const date = new Date(order.created_at);
  const label = Number.isFinite(date.valueOf()) ? DATE_FORMATTER.format(date) : "—";

  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Order #{order.id.slice(0, 8)}</CardTitle>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">
            Owner:{" "}
            <span className="font-mono">{order.owner_email ?? order.owner_id}</span>
            {order.owner_display_name ? ` · ${order.owner_display_name}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          <OrderStatusBadge status={order.status} />
          <Button
            variant="destructive"
            size="sm"
            disabled={!canRefund}
            onClick={() => setDialogOpen(true)}
          >
            Refund…
          </Button>
        </div>
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
          <p className="text-sm text-muted-foreground">No line items on this order.</p>
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
          <Row label="Total" value={formatPrice(order.total_cents)} emphasized />
          {refundedCents > 0 && (
            <Row
              label="Refunded"
              value={`− ${formatPrice(refundedCents)}`}
              muted
            />
          )}
          {refundedCents > 0 && (
            <Row label="Remaining" value={formatPrice(remainingCents)} />
          )}
        </dl>

        {refunds.length > 0 && (
          <>
            <Separator />
            <div>
              <h3 className="mb-2 text-sm font-medium text-foreground">
                Refund history
              </h3>
              <div className="rounded-md border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reason</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {refunds.map((r) => (
                      <RefundRow key={r.id} r={r} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </>
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

      <RefundDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        orderId={order.id}
        remainingCents={remainingCents}
      />
    </Card>
  );
}

function RefundRow({ r }: { r: AdminOrderRefundRow }) {
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {new Date(r.created_at).toLocaleDateString()}
      </TableCell>
      <TableCell className="tabular-nums">{formatPrice(r.amount_cents)}</TableCell>
      <TableCell className="capitalize text-xs">
        {r.stripe_status}
        {r.last_error ? (
          <span className="block text-destructive">{r.last_error}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-xs">{r.reason || "—"}</TableCell>
    </TableRow>
  );
}

function RefundDialog({
  open,
  onOpenChange,
  orderId,
  remainingCents,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  orderId: string;
  remainingCents: number;
}) {
  const qc = useQueryClient();
  const defaultDollars = (remainingCents / 100).toFixed(2);
  const [amountInput, setAmountInput] = useState(defaultDollars);
  const [reason, setReason] = useState("");

  const parsedCents = parseDollarsToCents(amountInput);
  const amountOk =
    parsedCents !== null &&
    parsedCents >= 100 &&
    parsedCents <= remainingCents;
  const reasonOk = reason.trim().length > 0;

  const refundM = useMutation({
    mutationFn: () =>
      refundAdminOrder(orderId, {
        amount_cents: parsedCents!,
        reason: reason.trim(),
      }),
    onSuccess: () => {
      notify.success("Refund issued.");
      qc.invalidateQueries({ queryKey: ADMIN_ORDER_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ADMIN_ORDERS_LIST_QUERY_KEY });
      setReason("");
      onOpenChange(false);
    },
    onError: (err: Error & { code?: string; message_from_stripe?: string | null }) => {
      if (err.code === "stripe_not_configured") {
        notify.error("Stripe keys are not configured in this environment.");
      } else if (err.code === "amount_below_minimum") {
        notify.error("Minimum refund is $1.00.");
      } else if (err.code === "exceeds_remaining") {
        notify.error("Amount exceeds the remaining refundable balance.");
      } else {
        notify.error(err.message_from_stripe || err.message || "Refund failed.");
      }
    },
  });

  function handleOpenChange(next: boolean) {
    if (refundM.isPending) return;
    if (next) {
      setAmountInput(defaultDollars);
      setReason("");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Refund order</DialogTitle>
          <DialogDescription>
            Issues a refund through Stripe. Minimum $1.00. Remaining refundable
            balance: {formatPrice(remainingCents)}.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!amountOk || !reasonOk || refundM.isPending) return;
            refundM.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="refund-amount">Amount (USD)</Label>
            <Input
              id="refund-amount"
              inputMode="decimal"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              placeholder="0.00"
            />
            {!amountOk && amountInput.trim() !== "" ? (
              <p className="text-xs text-destructive">
                Enter an amount between $1.00 and {formatPrice(remainingCents)}.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="refund-reason">Reason</Label>
            <Textarea
              id="refund-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Why is this refund being issued?"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={refundM.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={!amountOk || !reasonOk || refundM.isPending}
            >
              {refundM.isPending ? "Refunding…" : "Issue refund"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  emphasized,
  muted,
}: {
  label: string;
  value: string;
  emphasized?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt
        className={
          emphasized
            ? "font-medium text-foreground"
            : muted
              ? "text-muted-foreground"
              : "text-muted-foreground"
        }
      >
        {label}
      </dt>
      <dd
        className={
          emphasized
            ? "font-display text-base text-foreground"
            : muted
              ? "tabular-nums text-muted-foreground"
              : "tabular-nums text-foreground"
        }
      >
        {value}
      </dd>
    </div>
  );
}
