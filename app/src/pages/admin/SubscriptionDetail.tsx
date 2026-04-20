import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ADMIN_SUBSCRIPTIONS_QUERY_KEY,
  ADMIN_SUBSCRIPTION_DETAIL_QUERY_KEY,
  cancelAdminSubscription,
  getAdminSubscription,
  pauseAdminSubscription,
  resumeAdminSubscription,
  type SubscriptionStatus,
} from "@/lib/subscriptions";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";

// /admin/subscriptions/:id — Phase 6.5 detail view.
//
// Reuses the /admin/orders/:id layout vibe: metadata panel on top,
// line items + invoice history below. Cancel-at-period-end and
// pause/resume fire through the Worker, which routes to
// stripe.subscriptions.update then webhook-upserts the cache row.

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch { return iso; }
}

function formatCents(cents: number | null, currency: string): string {
  if (cents == null) return "—";
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}

function statusVariant(status: SubscriptionStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active" || status === "trialing") return "default";
  if (status === "past_due" || status === "unpaid") return "destructive";
  if (status === "canceled" || status === "incomplete_expired") return "outline";
  return "secondary";
}

export default function SubscriptionDetail() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumesAt, setResumesAt] = useState("");

  const q = useQuery({
    queryKey: [...ADMIN_SUBSCRIPTION_DETAIL_QUERY_KEY, id] as const,
    queryFn: () => getAdminSubscription(id),
    enabled: !!id,
    refetchInterval: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [...ADMIN_SUBSCRIPTION_DETAIL_QUERY_KEY, id] });
    qc.invalidateQueries({ queryKey: ADMIN_SUBSCRIPTIONS_QUERY_KEY });
  };

  const cancelM = useMutation({
    mutationFn: () => cancelAdminSubscription(id),
    onSuccess: () => {
      notify.success("Subscription will cancel at period end.");
      invalidate();
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  const pauseM = useMutation({
    mutationFn: (resumes?: string) => pauseAdminSubscription(id, resumes),
    onSuccess: () => {
      notify.success("Subscription paused.");
      setPauseOpen(false);
      setResumesAt("");
      invalidate();
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  const resumeM = useMutation({
    mutationFn: () => resumeAdminSubscription(id),
    onSuccess: () => { notify.success("Subscription resumed."); invalidate(); },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  if (q.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading subscription…</div>;
  }
  if (q.isError || !q.data) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-destructive">
          {mapSupabaseError(q.error as Error | null) || "Subscription not found."}
        </p>
        <Link className="text-sm text-primary hover:underline" to="/admin/subscriptions">
          ← Back to subscriptions
        </Link>
      </div>
    );
  }

  const sub = q.data.subscription;
  const invoices = q.data.invoices ?? [];
  const invoicesError = q.data.invoices_error;
  const canCancel = sub.status !== "canceled" && !sub.cancel_at_period_end;
  const canPause = sub.status === "active" || sub.status === "past_due";
  const canResume = sub.status === "paused";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/admin/subscriptions" className="text-sm text-primary hover:underline">
          ← Subscriptions
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="font-mono text-sm text-muted-foreground">{sub.id}</span>
        <Badge variant={statusVariant(sub.status)}>{sub.status.replace(/_/g, " ")}</Badge>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 md:grid-cols-2">
          <Detail label="Owner" value={sub.owner_display_name || sub.owner_email || "(no owner)"} sub={sub.owner_email || sub.customer_id} />
          <Detail label="Stripe customer" value={sub.customer_id} />
          <Detail
            label="Current period"
            value={`${formatDate(sub.current_period_start)} → ${formatDate(sub.current_period_end)}`}
          />
          <Detail
            label="Renews"
            value={sub.status === "canceled" ? "—" : formatDate(sub.current_period_end)}
            sub={sub.cancel_at_period_end ? "will cancel at period end" : undefined}
          />
          <Detail label="Last synced" value={formatDate(sub.last_synced_at)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU / price</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Interval</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sub.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    No line items cached yet.
                  </TableCell>
                </TableRow>
              ) : (
                sub.items.map((it, i) => (
                  <TableRow key={it.id || `${it.price_id}-${i}`}>
                    <TableCell>
                      <div className="font-medium text-foreground">{it.sku || it.product_id || "—"}</div>
                      <div className="font-mono text-xs text-muted-foreground">{it.price_id || "—"}</div>
                    </TableCell>
                    <TableCell>{it.quantity}</TableCell>
                    <TableCell>{formatCents(it.unit_amount_cents, it.currency || "usd")}</TableCell>
                    <TableCell>{it.interval || "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h2 className="text-base font-medium text-foreground">Invoice history</h2>
        {invoicesError ? (
          <p className="text-xs text-muted-foreground">
            {invoicesError === "stripe_not_configured"
              ? "Live invoice history is unavailable until Stripe keys are configured."
              : `Stripe invoice lookup failed: ${invoicesError}`}
          </p>
        ) : null}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Paid</TableHead>
                  <TableHead className="text-right">Links</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">
                      {invoicesError ? "—" : "No invoices yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">
                          {inv.number || inv.id}
                        </span>
                      </TableCell>
                      <TableCell>{formatDate(inv.created)}</TableCell>
                      <TableCell>{inv.status || "—"}</TableCell>
                      <TableCell>{formatCents(inv.amount_paid, inv.currency)}</TableCell>
                      <TableCell className="text-right text-xs">
                        {inv.hosted_url ? (
                          <a href={inv.hosted_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            hosted
                          </a>
                        ) : null}
                        {inv.hosted_url && inv.pdf_url ? " · " : null}
                        {inv.pdf_url ? (
                          <a href={inv.pdf_url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                            PDF
                          </a>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={!canCancel || cancelM.isPending}
          onClick={() => cancelM.mutate()}
        >
          {cancelM.isPending ? "Cancelling…" : "Cancel at period end"}
        </Button>
        <Button
          variant="outline"
          disabled={!canPause || pauseM.isPending}
          onClick={() => setPauseOpen(true)}
        >
          Pause collection
        </Button>
        <Button
          variant="outline"
          disabled={!canResume || resumeM.isPending}
          onClick={() => resumeM.mutate()}
        >
          {resumeM.isPending ? "Resuming…" : "Resume"}
        </Button>
      </div>

      <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pause collection</DialogTitle>
            <DialogDescription>
              Marks upcoming invoices uncollectible until the resume date.
              Leave blank to pause indefinitely.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 py-2">
            <Label htmlFor="resumes_at">Resumes at</Label>
            <Input
              id="resumes_at"
              type="datetime-local"
              value={resumesAt}
              onChange={(e) => setResumesAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPauseOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const iso = resumesAt ? new Date(resumesAt).toISOString() : undefined;
                pauseM.mutate(iso);
              }}
              disabled={pauseM.isPending}
            >
              {pauseM.isPending ? "Pausing…" : "Pause"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Detail({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}
