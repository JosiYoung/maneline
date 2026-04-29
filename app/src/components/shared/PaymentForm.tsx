import { useEffect, useMemo, useState } from "react";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";

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

// Memoize loadStripe at module scope so we don't re-download stripe.js
// on every mount (per Stripe docs).
let stripePromise: Promise<Stripe | null> | null = null;
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
  const stripePromise = useMemo(() => getStripe(), []);

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
      stripe={stripePromise}
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

  useEffect(() => {
    setErrorMsg(null);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setErrorMsg(null);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl },
        redirect: "if_required",
      });

      if (error) {
        // Card errors, decline, 3DS cancel, validation errors — all
        // surface here without a redirect.
        const msg = error.message || "Payment failed. Try a different card.";
        setErrorMsg(msg);
        notify.error(msg);
        onFailure?.(msg);
        return;
      }

      // No redirect needed (e.g. card succeeded immediately).
      onSuccess?.();
    } catch (err) {
      // confirmPayment threw — network glitch, blocked 3DS popup, etc.
      // Without this catch the button stayed in "Processing…" forever
      // and the user thought the page was hung.
      const msg =
        (err as Error)?.message ||
        "Payment didn't go through. Refresh and try again.";
      setErrorMsg(msg);
      notify.error(msg);
      onFailure?.(msg);
    } finally {
      // Always clear the spinner so the user can retry. The previous
      // implementation only cleared it in the no-error branch and on
      // explicit decline — anything else left the button frozen.
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      {errorMsg && (
        <p className="text-sm text-destructive" role="alert">
          {errorMsg}
        </p>
      )}
      <Button
        type="submit"
        className="w-full bg-accent text-accent-foreground hover:bg-accent/90"
        disabled={!stripe || !elements || submitting}
      >
        {submitting ? "Processing…" : amountLabel ? `Pay ${amountLabel}` : "Pay"}
      </Button>
    </form>
  );
}
