import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  CONNECT_QUERY_KEY,
  connectStatusFor,
  getMyConnectAccount,
  refreshConnectAccount,
  startOnboarding,
  StripeNotConfiguredError,
  type ConnectStatus,
} from "@/lib/stripeConnect";

// ConnectOnboardCard — the Payouts page's single source of truth.
//
// Four states, driven by the Stripe flags we mirror on
// stripe_connect_accounts (Phase 2 migration 00006):
//   • not_started — no row yet OR row exists but details_submitted=false
//   • in_review   — details_submitted=true, charges/payouts still pending
//   • ready       — charges_enabled=true AND payouts_enabled=true
//   • disabled    — Stripe set requirements.disabled_reason (surfaced red)

export function ConnectOnboardCard() {
  const queryClient = useQueryClient();
  const accountQ = useQuery({
    queryKey: CONNECT_QUERY_KEY,
    queryFn: getMyConnectAccount,
  });

  const [stripeDown, setStripeDown] = useState(false);

  // When Stripe redirects the trainer back to /trainer/payouts?returned=1,
  // re-pull the account so the card flips to its new state on the next
  // render. The Worker sets `returned=1` from the /api/stripe/connect/return
  // handler since we can't mutate DB state from an unauthenticated GET.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("returned") === "1") {
      params.delete("returned");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`,
      );
      refreshMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onboardMutation = useMutation({
    mutationFn: startOnboarding,
    onSuccess: ({ onboarding_url }) => {
      if (onboarding_url) window.location.assign(onboarding_url);
    },
    onError: (err) => {
      if (err instanceof StripeNotConfiguredError) {
        setStripeDown(true);
        notify.error(err.message);
        return;
      }
      notify.error(mapSupabaseError(err as Error));
    },
  });

  const refreshMutation = useMutation({
    mutationFn: refreshConnectAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONNECT_QUERY_KEY });
      notify.success("Payout status refreshed.");
    },
    onError: (err) => {
      if (err instanceof StripeNotConfiguredError) {
        setStripeDown(true);
        notify.error(err.message);
        return;
      }
      notify.error(mapSupabaseError(err as Error));
    },
  });

  if (accountQ.isLoading) {
    return <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />;
  }

  const row = accountQ.data ?? null;
  const status = connectStatusFor(row);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Payouts</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Finish Stripe Connect to receive payouts when owners approve + pay sessions.
          </p>
        </div>
        <StatusPill status={status} />
      </CardHeader>
      <CardContent className="space-y-4">
        <StatusBody status={status} row={row} stripeDown={stripeDown} />

        <div className="flex flex-wrap items-center gap-3">
          {status === "ready" ? (
            <Button
              variant="outline"
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
            >
              {refreshMutation.isPending ? "Refreshing…" : "Refresh status"}
            </Button>
          ) : (
            <>
              <Button
                onClick={() => onboardMutation.mutate()}
                disabled={onboardMutation.isPending || stripeDown}
              >
                {onboardMutation.isPending
                  ? "Opening Stripe…"
                  : row
                    ? "Resume payout setup"
                    : "Set up payouts"}
                <ExternalLink size={14} />
              </Button>
              {row && (
                <Button
                  variant="outline"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending || stripeDown}
                >
                  {refreshMutation.isPending ? "Refreshing…" : "Check status"}
                </Button>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusPill({ status }: { status: ConnectStatus }) {
  if (status === "ready") {
    return (
      <Badge className="bg-accent text-accent-foreground hover:bg-accent/90">
        <CheckCircle2 size={12} className="mr-1" /> Ready
      </Badge>
    );
  }
  if (status === "in_review") {
    return (
      <Badge variant="secondary">
        <Clock3 size={12} className="mr-1" /> In review
      </Badge>
    );
  }
  if (status === "disabled") {
    return (
      <Badge variant="destructive">
        <AlertTriangle size={12} className="mr-1" /> Attention needed
      </Badge>
    );
  }
  return <Badge variant="outline">Not started</Badge>;
}

function StatusBody({
  status,
  row,
  stripeDown,
}: {
  status: ConnectStatus;
  row: {
    charges_enabled: boolean;
    payouts_enabled: boolean;
    details_submitted: boolean;
    disabled_reason: string | null;
    onboarding_link_last_issued_at: string | null;
  } | null;
  stripeDown: boolean;
}) {
  if (stripeDown) {
    return (
      <div className="rounded-md border border-accent/40 bg-accent/5 p-3 text-sm text-foreground">
        <strong className="block">Payments aren't connected yet.</strong>
        <p className="mt-1 text-muted-foreground">
          Mane Line is still verifying its payment processor. You can keep
          logging sessions — payouts will activate automatically when the
          integration goes live.
        </p>
      </div>
    );
  }

  if (status === "ready") {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
        <p className="font-medium">You're ready to get paid.</p>
        <p className="mt-1 text-muted-foreground">
          Payouts to your bank will run on Stripe's standard schedule. When an
          owner approves and pays a session, the platform fee is taken from the
          charge and the rest lands in your Stripe balance.
        </p>
      </div>
    );
  }

  if (status === "in_review") {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
        <p className="font-medium">Stripe is reviewing your information.</p>
        <p className="mt-1 text-muted-foreground">
          This usually takes a few minutes. Check back soon — once
          verification clears, your payouts will turn on automatically.
        </p>
      </div>
    );
  }

  if (status === "disabled" && row?.disabled_reason) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-medium text-destructive">
          Stripe paused your account: {row.disabled_reason}
        </p>
        <p className="mt-1 text-muted-foreground">
          Resume setup and Stripe will walk you through the requirements.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-3 text-sm">
      <p className="font-medium">Set up Stripe Connect to receive payouts.</p>
      <p className="mt-1 text-muted-foreground">
        You'll verify your identity, add a bank account, and be back here in
        a few minutes. Log sessions in the meantime — the payment flow waits
        for you.
      </p>
    </div>
  );
}
