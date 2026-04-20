import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";

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

  const sessionQuery = useQuery({
    queryKey: [...SESSIONS_QUERY_KEY, id],
    queryFn: () => getSession(id),
    enabled: Boolean(id),
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
      payMut.mutate();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const payMut = useMutation({
    mutationFn: () => startPayment(id),
    onSuccess: (res) => {
      setIntent(res);
      queryClient.invalidateQueries({ queryKey: SESSION_PAYMENTS_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  // Auto-start payment if the session is already approved and we land here
  // fresh (e.g. after reload or after clicking "Pay now" on the list view).
  useEffect(() => {
    if (!sessionQuery.data) return;
    if (intent) return;
    if (payMut.isPending) return;
    if (sessionQuery.data.status === "approved") {
      payMut.mutate();
    }
    // payMut is stable enough; we only care about the session row shape.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery.data, intent]);

  const session = sessionQuery.data;
  const amountLabel = useMemo(
    () => (session?.trainer_price_cents != null
      ? formatCents(session.trainer_price_cents)
      : null),
    [session?.trainer_price_cents],
  );

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

      {session.status === "paid" ? (
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
          onPaid={() => {
            queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
            queryClient.invalidateQueries({ queryKey: SESSION_PAYMENTS_QUERY_KEY });
            notify.success("Payment sent to your trainer");
            navigate(`/app/animals/${session.animal_id}?paid=1`);
          }}
          amountLabel={amountLabel ?? undefined}
        />
      )}
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
  onPaid,
  amountLabel,
}: {
  sessionId: string;
  animalId: string;
  intent: StartPaymentResult | null;
  loading: boolean;
  onPaid: () => void;
  amountLabel?: string;
}) {
  void sessionId;
  if (loading && !intent) {
    return <div className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />;
  }
  if (!intent) {
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
      <CardContent>
        <PaymentForm
          clientSecret={intent.client_secret}
          returnUrl={returnUrl}
          onSuccess={onPaid}
          amountLabel={amountLabel}
        />
      </CardContent>
    </Card>
  );
}
