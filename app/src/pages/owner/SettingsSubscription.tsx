import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, CreditCard, Tag, Sprout, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  getSubscription,
  startBarnModeCheckout,
  openBillingPortal,
  redeemPromoCode,
  silverLiningUnlink,
  type SubscriptionSnapshot,
} from "@/lib/barn";
import { notify } from "@/lib/toast";

// /app/settings/subscription — the Barn Mode subscription hub.
//
// Shows current tier + status, horse-count, comp source (if any), a
// Stripe Checkout CTA, promo-code redemption, and SL link status. Any
// Stripe-mutating control renders a disabled "configuration pending"
// state when env.STRIPE_SECRET_KEY is missing on the Worker side.

const PRICE_DISPLAY = "$25 / month";

function StatusBadge({ snap }: { snap: SubscriptionSnapshot }) {
  const sub = snap.subscription;
  if (snap.on_barn_mode) {
    if (sub?.comp_source) {
      return <Badge variant="secondary">Barn Mode · complimentary</Badge>;
    }
    return <Badge>Barn Mode · active</Badge>;
  }
  if (sub?.status === "past_due") {
    return <Badge variant="destructive">Past due</Badge>;
  }
  if (sub?.status === "cancelled") {
    return <Badge variant="outline">Cancelled</Badge>;
  }
  return <Badge variant="outline">Free tier</Badge>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function SettingsSubscription() {
  const qc = useQueryClient();

  const snapQ = useQuery({
    queryKey: ["subscription"] as const,
    queryFn: getSubscription,
  });

  const [promoCode, setPromoCode] = useState("");

  const checkoutM = useMutation({
    mutationFn: () =>
      startBarnModeCheckout({
        success_url: `${window.location.origin}/app/settings/subscription?checkout=success`,
        cancel_url: `${window.location.origin}/app/settings/subscription?checkout=cancel`,
      }),
    onSuccess: (r) => {
      window.location.href = r.checkout_url;
    },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Could not start checkout.");
    },
  });

  const portalM = useMutation({
    mutationFn: () =>
      openBillingPortal({
        return_url: `${window.location.origin}/app/settings/subscription`,
      }),
    onSuccess: (r) => {
      window.location.href = r.portal_url;
    },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Could not open billing portal.");
    },
  });

  const promoM = useMutation({
    mutationFn: (code: string) => redeemPromoCode(code),
    onSuccess: (r) => {
      notify.success(`Promo applied — ${r.months_granted} month${r.months_granted === 1 ? "" : "s"} of Barn Mode.`);
      setPromoCode("");
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Promo code could not be redeemed.");
    },
  });

  const unlinkM = useMutation({
    mutationFn: silverLiningUnlink,
    onSuccess: () => {
      notify.success("Silver Lining link removed.");
      qc.invalidateQueries({ queryKey: ["subscription"] });
    },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Could not unlink.");
    },
  });

  const snap = snapQ.data;
  const stripeConfigured = snap?.stripe_configured ?? false;
  const compExpiry = useMemo(() => snap?.subscription?.comp_expires_at ?? null, [snap]);

  if (snapQ.isLoading) return <SubscriptionSkeleton />;
  if (snapQ.isError || !snap) {
    return (
      <div className="space-y-4">
        <Header />
        <Alert variant="destructive">
          <AlertTitle>Could not load subscription.</AlertTitle>
          <AlertDescription>
            {snapQ.error instanceof Error ? snapQ.error.message : "Try again shortly."}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Header />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Current plan</CardTitle>
            <p className="text-sm text-muted-foreground">
              {snap.horse_count} {snap.horse_count === 1 ? "horse" : "horses"} tracked ·
              {" "}
              {snap.on_barn_mode ? "unlimited" : "up to 5 free"}
            </p>
          </div>
          <StatusBadge snap={snap} />
        </CardHeader>
        <CardContent className="space-y-4">
          {snap.subscription?.comp_source === "silver_lining_sns" && (
            <Alert>
              <Sprout className="h-4 w-4" />
              <AlertTitle>Complimentary via Silver Lining Subscribe &amp; Save</AlertTitle>
              <AlertDescription>
                Your Barn Mode access is covered for as long as your Silver Lining
                Subscribe &amp; Save order is active.
              </AlertDescription>
            </Alert>
          )}
          {snap.subscription?.comp_source === "promo_code" && compExpiry && (
            <Alert>
              <Tag className="h-4 w-4" />
              <AlertTitle>Promo credit active</AlertTitle>
              <AlertDescription>
                Complimentary Barn Mode through {formatDate(compExpiry)}.
              </AlertDescription>
            </Alert>
          )}

          {!snap.on_barn_mode && (
            <div className="rounded-md border bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-1 h-5 w-5 text-primary" />
                <div className="flex-1 space-y-2">
                  <p className="font-display text-lg text-primary">
                    Upgrade to Barn Mode — {PRICE_DISPLAY}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Unlimited horses, Barn Calendar for the whole team, Herd
                    Health PDF exports, Facility Map, and Barn Spending rollups.
                  </p>
                  <div className="pt-1">
                    <Button
                      onClick={() => checkoutM.mutate()}
                      disabled={!stripeConfigured || checkoutM.isPending}
                      title={stripeConfigured ? undefined : "Billing not yet configured"}
                    >
                      {checkoutM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                      {stripeConfigured ? "Subscribe" : "Subscribe (coming soon)"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {snap.subscription?.stripe_subscription_id && (
            <div className="flex items-center justify-between gap-2 rounded-md border p-3">
              <div className="text-sm">
                <div className="font-medium">Stripe billing portal</div>
                <div className="text-muted-foreground">
                  Update card, download invoices, cancel, or resume.
                </div>
                {snap.subscription.current_period_end && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    Renews {formatDate(snap.subscription.current_period_end)}
                    {snap.subscription.cancel_at_period_end ? " · cancels at period end" : ""}
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => portalM.mutate()}
                disabled={!stripeConfigured || portalM.isPending}
              >
                {portalM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Manage billing
              </Button>
            </div>
          )}

          {snap.subscription?.status === "past_due" && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Payment failed</AlertTitle>
              <AlertDescription>
                Update your card in the billing portal to keep Barn Mode active.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Redeem a promo code</CardTitle>
          <p className="text-sm text-muted-foreground">
            Complimentary Barn Mode via partner campaigns.
          </p>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const code = promoCode.trim();
              if (!code) return;
              promoM.mutate(code);
            }}
          >
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="promo-code">Promo code</Label>
              <Input
                id="promo-code"
                autoComplete="off"
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="ABC-2345"
                maxLength={32}
              />
            </div>
            <Button type="submit" disabled={promoM.isPending || !promoCode.trim()}>
              {promoM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply
            </Button>
          </form>
        </CardContent>
      </Card>

      {snap.silver_lining && (
        <Card>
          <CardHeader>
            <CardTitle>Silver Lining link</CardTitle>
            <p className="text-sm text-muted-foreground">
              Linked on {formatDate(snap.silver_lining.linked_at)}
              {snap.silver_lining.last_verified_at
                ? ` · last verified ${formatDate(snap.silver_lining.last_verified_at)}`
                : ""}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <span className="text-muted-foreground">SL customer: </span>
              <span className="font-mono">{snap.silver_lining.silver_lining_customer_id}</span>
            </div>
            {snap.silver_lining.last_verification_status && (
              <div className="text-sm">
                <span className="text-muted-foreground">Last status: </span>
                <Badge variant="outline">{snap.silver_lining.last_verification_status}</Badge>
              </div>
            )}
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Unlinking is only possible after the 30-day sticky window
                (through {formatDate(snap.silver_lining.sticky_until)}).
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  if (!confirm("Remove the link to your Silver Lining account? Barn Mode comp will end.")) return;
                  unlinkM.mutate();
                }}
                disabled={unlinkM.isPending}
              >
                {unlinkM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Unlink
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {snap.entitlement_events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {snap.entitlement_events.slice(0, 10).map((ev, i) => (
                <li key={i} className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0">
                  <div>
                    <div className="font-medium capitalize">{ev.event.replace(/_/g, " ")}</div>
                    <div className="text-xs text-muted-foreground">
                      {ev.source.replace(/_/g, " ")}
                      {ev.reason ? ` · ${ev.reason}` : ""}
                    </div>
                  </div>
                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDate(ev.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Header() {
  return (
    <header className="flex items-center gap-3">
      <Button asChild variant="ghost" size="icon">
        <Link to="/app/settings" aria-label="Back to settings">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div>
        <h1 className="font-display text-2xl text-primary">Subscription</h1>
        <p className="text-sm text-muted-foreground">
          Barn Mode plan, billing, and promo credits.
        </p>
      </div>
    </header>
  );
}

function SubscriptionSkeleton() {
  return (
    <div className="space-y-6">
      <Header />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
