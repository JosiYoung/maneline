import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  SESSIONS_QUERY_KEY,
  formatCents,
  formatDurationMinutes,
  formatStartedAt,
  getSession,
  sessionTypeLabel,
} from "@/lib/sessions";
import {
  SESSION_PAYMENTS_QUERY_KEY,
  approveSession,
  getPaymentForSession,
  startPayment,
  type StartPaymentResult,
} from "@/lib/sessionPayments";
import { PaymentForm } from "@/components/shared/PaymentForm";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { EXPENSES_QUERY_KEY, listExpensesForSession } from "@/lib/expenses";
import { ExpensesList } from "@/components/expenses/ExpensesList";
import { RatingPrompt } from "@/components/ratings/RatingPrompt";

type PaymentBreakdown = {
  trainerCents: number;
  serviceFee: number | null;
  totalCents: number | null;
};

// SessionApproveAndPay — /app/sessions/:id/pay
//
// Two steps, same page:
//   1. If session.status === 'logged' → show an "Approve & pay" CTA that
//      flips the row to 'approved' via the Worker.
//   2. Once status === 'approved' → mint a PaymentIntent and mount
//      <PaymentForm/>. If the trainer isn't set up for payouts yet, the
//      Worker returns status='awaiting_trainer_setup' and we render the
//      "waiting on trainer" helper text instead of the card form.
export default function SessionApproveAndPay() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [intent, setIntent] = useState<StartPaymentResult | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  // Track whether we've already auto-fired payMut for this mount so the
  // useEffect doesn't loop on dependency changes.
  const autoStarted = useRef(false);

  const sessionQuery = useQuery({
    queryKey: [...SESSIONS_QUERY_KEY, id],
    queryFn: () => getSession(id),
    enabled: Boolean(id),
  });

  const expensesQuery = useQuery({
    queryKey: [...EXPENSES_QUERY_KEY, "session", id],
    queryFn: () => listExpensesForSession(id),
    enabled: Boolean(id) && sessionQuery.isSuccess,
  });

  // Existing payment row (if any). Useful when a user reloads mid-flow.
  const paymentQuery = useQuery({
    queryKey: [...SESSION_PAYMENTS_QUERY_KEY, id],
    queryFn: () => getPaymentForSession(id),
    enabled: Boolean(id),
  });

  const approveMut = useMutation({
    mutationFn: () => approveSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      // Kick off the payment intent creation immediately.
      firePayMut();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const payMut = useMutation({
    mutationFn: () => startPayment(id),
    onSuccess: (res) => {
      setPayError(null);
      setIntent(res);
      queryClient.invalidateQueries({ queryKey: SESSION_PAYMENTS_QUERY_KEY });
      // If the Worker tells us this session is already paid, refresh the
      // session query so the UI flips to the "paid" card immediately.
      if (res.status === "succeeded" || res.status === "processing") {
        queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      }
    },
    onError: (err) => {
      const msg = mapSupabaseError(err as Error);
      setPayError(msg);
      notify.error(msg);
    },
  });

  /** Shared helper so approve-flow and retry button use the same path. */
  function firePayMut() {
    setPayError(null);
    autoStarted.current = true;
    payMut.mutate();
  }

  // Auto-start payment if the session is already approved and we land here
  // fresh (e.g. after reload or after clicking "Pay now" on the list view).
  useEffect(() => {
    if (autoStarted.current) return;          // already fired
    if (!sessionQuery.data) return;
    if (intent) return;
    if (payMut.isPending) return;
    if (sessionQuery.data.status === "approved") {
      firePayMut();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery.data, intent, payMut.isPending]);

  const session = sessionQuery.data;
  const amountLabel = useMemo(
    () => (session?.trainer_price_cents != null
      ? formatCents(session.trainer_price_cents)
      : null),
    [session?.trainer_price_cents],
  );

  // Breakdown shown above the card form: trainer's price + service fee
  // (Stripe pass-through + platform margin) = total charged.
  // Pulled from the live PaymentIntent response, falls back to the
  // session_payments row if the user reloaded mid-flow.
  const breakdown = useMemo<PaymentBreakdown | null>(() => {
    const intentAny = intent as
      | (StartPaymentResult & {
          amount_cents?: number;
          platform_fee_cents?: number;
          gross_amount_cents?: number;
          owner_surcharge_cents?: number;
        })
      | null;
    if (
      intentAny &&
      intentAny.status !== "processing" &&
      intentAny.status !== "succeeded" &&
      intentAny.amount_cents != null &&
      intentAny.gross_amount_cents != null
    ) {
      // Owner sees only the owner-side surcharge, not the trainer's
      // platform deduction (that's the trainer's relationship with us,
      // not the owner's concern).
      const ownerFee = intentAny.owner_surcharge_cents
        ?? (intentAny.gross_amount_cents - intentAny.amount_cents);
      return {
        trainerCents: intentAny.amount_cents,
        serviceFee: ownerFee,
        totalCents: intentAny.gross_amount_cents,
      };
    }
    const row = paymentQuery.data as
      | (typeof paymentQuery.data & {
          gross_amount_cents?: number | null;
          owner_surcharge_cents?: number | null;
        })
      | null
      | undefined;
    if (row && row.amount_cents != null) {
      const total = row.gross_amount_cents
        ?? (row.platform_fee_cents != null
          ? row.amount_cents + row.platform_fee_cents
          : null);
      const ownerFee = row.owner_surcharge_cents
        ?? (total != null ? total - row.amount_cents : null);
      return {
        trainerCents: row.amount_cents,
        serviceFee: ownerFee,
        totalCents: total,
      };
    }
    return null;
  }, [intent, paymentQuery.data]);

  const totalLabel = breakdown?.totalCents != null
    ? formatCents(breakdown.totalCents)
    : amountLabel;

  if (sessionQuery.isLoading) {
    return <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />;
  }
  if (sessionQuery.isError || !session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>We couldn't load this session.</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          It may have been archived or you may not have access.
        </CardContent>
      </Card>
    );
  }

  const backHref = `/app/animals/${session.animal_id}`;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        to={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Back to animal
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>{session.title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            {sessionTypeLabel(session.session_type)} ·{" "}
            {formatDurationMinutes(session.duration_minutes)} ·{" "}
            {formatStartedAt(session.started_at)}
          </p>
          {session.trainer_display_name && (
            <p>With {session.trainer_display_name}</p>
          )}
          {session.notes && <p className="text-foreground">{session.notes}</p>}
          {amountLabel && (
            <p className="pt-2 text-base font-semibold text-foreground">
              Amount due: {amountLabel}
            </p>
          )}
          <StatusRow status={session.status} />
        </CardContent>
      </Card>

      {expensesQuery.isSuccess && expensesQuery.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Session expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <ExpensesList
              expenses={expensesQuery.data}
              showAnimal={false}
              emptyText=""
            />
          </CardContent>
        </Card>
      )}

      {session.status === "paid"
        || paymentQuery.data?.status === "succeeded"
        || (intent && intent.status === "succeeded") ? (
        <Card>
          <CardContent className="space-y-3 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              This session is paid. Thank you!
            </p>
            <Button asChild variant="outline">
              <Link to={backHref}>Back to animal</Link>
            </Button>
          </CardContent>
        </Card>
      ) : session.status === "logged" ? (
        <Card>
          <CardContent className="space-y-4 py-6">
            <p className="text-sm text-muted-foreground">
              Approving this session confirms the charge amount and notifies
              your trainer. You'll enter card details on the next step.
            </p>
            <Button
              className="w-full"
              onClick={() => approveMut.mutate()}
              disabled={approveMut.isPending}
            >
              {approveMut.isPending
                ? "Approving…"
                : amountLabel
                  ? `Approve & pay ${amountLabel}`
                  : "Approve & continue"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <PayPanel
          sessionId={id}
          animalId={session.animal_id}
          intent={intent}
          loading={payMut.isPending || paymentQuery.isLoading}
          error={payError}
          onRetry={firePayMut}
          onPaid={() => {
            queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: SESSION_PAYMENTS_QUERY_KEY });
            notify.success("Payment sent to your trainer");
            navigate(`/app/animals/${session.animal_id}?paid=1`);
          }}
          onPaymentFailed={() => {
            // The PaymentIntent we just attempted is now poisoned (Stripe
            // marks it requires_payment_method + last_payment_error).
            // Drop the cached intent so we can re-fire startPayment(),
            // which mints a fresh PI on the Worker.
            setIntent(null);
            autoStarted.current = false;
            queryClient.invalidateQueries({ queryKey: SESSION_PAYMENTS_QUERY_KEY });
          }}
          amountLabel={amountLabel ?? undefined}
          breakdown={breakdown}
          totalLabel={totalLabel ?? undefined}
        />
      )}

      <RatingPrompt
        sessionId={session.id}
        rateeId={session.trainer_id}
        rateeLabel={session.trainer_display_name ?? "the trainer"}
        eligible={session.status === "approved" || session.status === "paid"}
      />
    </div>
  );
}

function StatusRow({
  status,
}: {
  status: "logged" | "approved" | "paid" | "disputed";
}) {
  if (status === "logged") return <Badge>Logged</Badge>;
  if (status === "approved") return <Badge variant="secondary">Approved</Badge>;
  if (status === "paid") {
    return (
      <Badge className="bg-accent text-accent-foreground hover:bg-accent/90">
        Paid
      </Badge>
    );
  }
  return <Badge variant="destructive">Disputed</Badge>;
}

function PayPanel({
  sessionId,
  animalId,
  intent,
  loading,
  error,
  onRetry,
  onPaid,
  onPaymentFailed,
  amountLabel,
  breakdown,
  totalLabel,
}: {
  sessionId: string;
  animalId: string;
  intent: StartPaymentResult | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onPaid: () => void;
  onPaymentFailed: () => void;
  amountLabel?: string;
  breakdown: PaymentBreakdown | null;
  totalLabel?: string;
}) {
  void sessionId;
  if (loading && !intent) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Setting up payment…
        </CardContent>
      </Card>
    );
  }
  if (!intent) {
    // payMut failed — show actionable error with retry.
    if (error) {
      return (
        <Card>
          <CardContent className="space-y-3 py-6">
            <p className="text-sm font-medium text-destructive">
              Couldn't start the payment checkout.
            </p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="mr-1 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      );
    }
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Preparing checkout…
        </CardContent>
      </Card>
    );
  }

  if (intent.status === "awaiting_trainer_setup") {
    return (
      <Card>
        <CardContent className="space-y-2 py-6">
          <p className="text-sm font-medium">Your trainer is finishing payout setup.</p>
          <p className="text-sm text-muted-foreground">
            Your card won't be charged until they're ready — we'll notify you
            both automatically once they finish. The amount
            {amountLabel ? ` (${amountLabel})` : ""} is locked in at today's rate.
          </p>
          <Button asChild variant="outline">
            <Link to={`/app/animals/${animalId}`}>Back to animal</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (intent.status !== "pending") {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Payment is {intent.status}. Refresh in a moment for the final status.
        </CardContent>
      </Card>
    );
  }

  // intent.status === 'pending' — we have a client_secret.
  const returnUrl = `${window.location.origin}/app/animals/${animalId}?paid=1`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {breakdown && breakdown.totalCents != null && breakdown.trainerCents != null && (
          <dl className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Session</dt>
              <dd>{formatCents(breakdown.trainerCents)}</dd>
            </div>
            {breakdown.serviceFee != null && breakdown.serviceFee > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Service fee</dt>
                <dd>{formatCents(breakdown.serviceFee)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-border pt-1 font-medium">
              <dt>Total</dt>
              <dd>{formatCents(breakdown.totalCents)}</dd>
            </div>
          </dl>
        )}
        <PaymentForm
          clientSecret={intent.client_secret}
          returnUrl={returnUrl}
          onSuccess={onPaid}
          onFailure={onPaymentFailed}
          amountLabel={totalLabel ?? undefined}
        />
      </CardContent>
    </Card>
  );
}
