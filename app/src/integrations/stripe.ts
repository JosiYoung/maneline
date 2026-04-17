/**
 * Stripe integration — Phase 0 PLACEHOLDER.
 *
 * Stripe handles two flows:
 *   1) Customer checkout for Silver Lining products (Phase 2 MVP —
 *      we'll gate Shopify behind this until Phase 3's Storefront
 *      handoff is wired).
 *   2) Stripe Connect for trainer payouts once vetted trainers can
 *      charge owners through the platform.
 *
 * Both are mocked today. The return shapes match Stripe's REST API
 * so call-sites lock in the contract now.
 *
 * Credentials this module will read once live:
 *   STRIPE_SECRET_KEY      (SECRET — sk_live_... / sk_test_...)
 *   STRIPE_WEBHOOK_SECRET  (SECRET — whsec_... for verifying event POSTs)
 *
 * Flip plan: see docs/INTEGRATIONS.md §Stripe.
 */

export interface CheckoutSessionInput {
  sku: string;
  priceCents: number;
}

export interface CheckoutSession {
  id: string;
  url: string;        // hosted Stripe Checkout URL
  expires_at: string; // ISO-8601
}

export interface ConnectedAccount {
  id: string;                // acct_...
  onboarding_url: string;    // Stripe-hosted onboarding link
  charges_enabled: boolean;
  payouts_enabled: boolean;
}

// TODO(Phase 2): replace mock with real Stripe Checkout Sessions call
// (POST /v1/checkout/sessions). See FEATURE_MAP §4.7.
export async function createCheckoutSession(
  input: CheckoutSessionInput
): Promise<CheckoutSession> {
  return {
    id: `cs_mock_${input.sku}_${Date.now()}`,
    url: 'https://mock-stripe.invalid/checkout/cs_mock',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
}

// TODO(Phase 2): replace mock with real Stripe Connect Express account
// creation (POST /v1/accounts + account_link). See FEATURE_MAP §4.7.2.
export async function createConnectedAccount(
  trainerId: string
): Promise<ConnectedAccount> {
  return {
    id: `acct_mock_${trainerId}`,
    onboarding_url: 'https://mock-stripe.invalid/connect/onboarding',
    charges_enabled: false,
    payouts_enabled: false,
  };
}
