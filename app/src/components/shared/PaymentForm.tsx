import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { notify } from "@/lib/toast";

// Shared Stripe Elements wrapper. The Worker has already created the
// PaymentIntent and handed us a client_secret; this component mounts
// <PaymentElement/> and calls stripe.confirmPayment on submit.
//
// FRONTEND-UI-GUIDE.md §7 — Stripe Elements is the only card-input
// pattern allowed. No custom fields, no arbitrary Tailwind hex.

const STRIPE_PUBLIC_KEY = import.meta.env.VITE_STRIPE_PUBLIC_KEY as
  | string
  | undefined;

// Kick off loadStripe immediately at module load — this starts
// downloading stripe.js from Stripe's CDN as early as possible
// instead of waiting for the PaymentForm component to mount.
let stripePromise: Promise<Stripe | null> | null = null;
if (STRIPE_PUBLIC_KEY) {
  stripePromise = loadStripe(STRIPE_PUBLIC_KEY);
}
function getStripe(): Promise<Stripe | null> {
  if (!STRIPE_PUBLIC_KEY) return Promise.resolve(null);
  if (!stripePromise) stripePromise = loadStripe(STRIPE_PUBLIC_KEY);
  return stripePromise;
}

export type PaymentFormProps = {
  clientSecret: string;
  /** Absolute URL the user returns to after 3DS / bank redirect. */
  returnUrl: string;
  /** Fires after confirmPayment resolves without an immediate error. */
  onSuccess?: () => void;
  /**
   * Fires when confirmPayment returns an error or throws. Parents should
   * use this to refresh the PaymentIntent — once Stripe puts a PI into
   * `requires_payment_method` with a `last_payment_error`, that PI
   * is poisoned and Elements won't render a fresh card form against it.
   */
  onFailure?: (message: string) => void;
  amountLabel?: string;
};

export function PaymentForm(props: PaymentFormProps) {
  const stripe = useMemo(() => getStripe(), []);

  if (!STRIPE_PUBLIC_KEY) {
    return (
      <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
        Payments aren't configured on this build. Ask the deployer to set{" "}
        <code>VITE_STRIPE_PUBLIC_KEY</code>.
      </p>
    );
  }

  return (
    <Elements
      stripe={stripe}
      options={{
        clientSecret: props.clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#3D7A3D",
          },
        },
      }}
    >
      <InnerForm {...props} />
    </Elements>
  );
}

function InnerForm({ returnUrl, onSuccess, onFailure, amountLabel }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elementReady, setElementReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
  }, []);

  // Timeout: if PaymentElement hasn't fired onReady after 15s, something
  // is wrong (bad client_secret, Stripe CDN blocked, etc.).
  useEffect(() => {
    if (elementReady || loadError) return;
    const t = setTimeout(() => {
      if (!elementReady) {
        setLoadError(
          "The payment form is taking too long to load. " +
          "Check your internet connection or try refreshing."
        );
      }
    }, 15_000);
    return () => clearTimeout(t);
  }, [elementReady, loadError]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements || !elementReady) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });

      if (error) {
        const msg = error.message || "Payment failed. Try a different card.";
        setErrorMsg(msg);
        notify.error(msg);
        onFailure?.(msg);
        return;
      }

      onSuccess?.();
    } catch (err) {
      const msg =
        (err as Error)?.message ||
        "Payment didn't go through. Refresh and try again.";
      setErrorMsg(msg);
      notify.error(msg);
      onFailure?.(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Loading skeleton shown until Stripe's iframe is ready */}
      {!elementReady && !loadError && (
        <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-muted/20 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading payment form…
        </div>
      )}

      {loadError && (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{loadError}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
          >
            Refresh page
          </Button>
        </div>
      )}

      {/* PaymentElement renders a hidden iframe immediately; it becomes
          visible once Stripe's JS populates it. We keep it in the DOM
          always so the iframe can load in parallel with our skeleton. */}
      <div className={elementReady ? undefined : "sr-only"}>
        <PaymentElement
          onReady={() => setElementReady(true)}
          onLoadError={(e) => {
            const msg =
              e.error?.message ||
              "Could not load the payment form. Please refresh.";
            setLoadError(msg);
          }}
        />
      </div>

      {errorMsg && (
        <p className="text-sm text-destructive" role="alert">
          {errorMsg}
        </p>
      )}

      <Button
        type="submit"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        disabled={!stripe || !elements || !elementReady || submitting}
      >
        {submitting ? "Processing…" : amountLabel ? `Pay ${amountLabel}` : "Pay"}
      </Button>
    </form>
  );
}
