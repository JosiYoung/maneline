-- Phase 3 Prompt 3.6 — owner order history surface.
--
-- Owners want a direct link to Stripe's hosted receipt page from
-- /app/orders/:id (it has the PDF, the itemized receipt, and the
-- "resend to a different email" affordance). Stripe returns the
-- URL on the underlying Charge (`receipt_url`), which we expand off
-- `payment_intent.latest_charge` in `handleCheckoutSessionCompleted`.
--
-- We store it alongside the existing stripe_* fields on orders so
-- the detail page can render it without a fresh Stripe round-trip.
-- Additive + nullable → safe to apply to an already-populated table.

alter table public.orders
  add column if not exists stripe_receipt_url text;
