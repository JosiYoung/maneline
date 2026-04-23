import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, CreditCard, ShieldAlert, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

import {
  TRAINER_SUBSCRIPTION_QUERY_KEY,
  getTrainerSubscription,
  startTrainerProCheckout,
  openTrainerBillingPortal,
  type TrainerSubscriptionSnapshot,
} from "@/lib/trainerSubscription";
import { notify } from "@/lib/toast";

// /trainer/subscription — Trainer Pro hub.
//
// Free part-time plan is the default (≤5 client horses). Once the
// trainer needs a 6th client horse, the DB blocks new grants and
// this page is where they upgrade to Trainer Pro ($25/mo).

const PRICE_DISPLAY = "$25 / month";

function StatusBadge({ snap }: { snap: TrainerSubscriptionSnapshot }) {
  if (snap.on_trainer_pro) return <Badge>Trainer Pro · active</Badge>;
  const sub = snap.subscription;
  if (sub?.status === "past_due") return <Badge variant="destructive">Past due</Badge>;
  if (sub?.status === "cancelled") return <Badge variant="outline">Cancelled</Badge>;
  return <Badge variant="outline">Part-time · free</Badge>;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

export default function TrainerSettingsSubscription() {
  const qc = useQueryClient();

  const snapQ = useQuery({
    queryKey: TRAINER_SUBSCRIPTION_QUERY_KEY,
    queryFn: getTrainerSubscription,
  });

  const checkoutM = useMutation({
    mutationFn: startTrainerProCheckout,
    onSuccess: (r) => { window.location.href = r.checkout_url; },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Could not start checkout.");
    },
  });

  const portalM = useMutation({
    mutationFn: openTrainerBillingPortal,
    onSuccess: (r) => { window.location.href = r.portal_url; },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Could not open billing portal.");
    },
  });

  if (snapQ.isLoading) {
    return (
      <div className="space-y-4">
        <Header />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (snapQ.isError || !snapQ.data) {
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

  const snap = snapQ.data;
  const stripeConfigured = snap.stripe_configured;
  const atOrOverCap = snap.horse_count >= snap.horse_limit_free && !snap.on_trainer_pro;

  void qc; // reserved for future cache invalidations on portal return

  return (
    <div className="space-y-6">
      <Header />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <div>
            <CardTitle>Current plan</CardTitle>
            <p className="text-sm text-muted-foreground flex items-center gap-1.5 mt-1">
              <Users className="h-4 w-4" />
              {snap.horse_count} {snap.horse_count === 1 ? "client horse" : "client horses"} ·
              {" "}
              {snap.on_trainer_pro
                ? "unlimited"
                : `up to ${snap.horse_limit_free} free`}
            </p>
          </div>
          <StatusBadge snap={snap} />
        </CardHeader>
        <CardContent className="space-y-4">
          {atOrOverCap && (
            <Alert variant="destructive">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>You're at the free plan limit</AlertTitle>
              <AlertDescription>
                Owners can't add you as trainer for any more horses until you
                upgrade to Trainer Pro.
              </AlertDescription>
            </Alert>
          )}

          {!snap.on_trainer_pro && (
            <div className="rounded-md border bg-muted/40 p-4">
              <div className="flex items-start gap-3">
                <CreditCard className="mt-1 h-5 w-5 text-primary" />
                <div className="flex-1 space-y-2">
                  <p className="font-display text-lg text-primary">
                    Upgrade to Trainer Pro — {PRICE_DISPLAY}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Take on unlimited client horses. Keep every Phase 7 business
                    tool you already have: invoices, recurring items, payouts,
                    and branding.
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
                Update your card in the billing portal to keep Trainer Pro active.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-3xl">Subscription</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Part-time trainers (up to 5 client horses) use Mane Line free.
        Trainer Pro lifts the cap for full-time work.
      </p>
    </div>
  );
}
