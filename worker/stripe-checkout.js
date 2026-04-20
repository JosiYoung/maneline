/**
 * Stripe Checkout Session helper for the Phase 3 shop flow.
 *
 * Hosted redirect model: the Worker mints a Checkout Session, the SPA
 * does window.location.assign(session.url), Stripe handles payment + tax
 * + shipping + receipt. The Phase 3.5 webhook (checkout.session.completed)
 * flips orders.status → 'paid' and snapshots line items.
 *
 * Routing decision (docs/phase-3-plan.md §6 resolved #1):
 *   - If SLH_CONNECT_ACCOUNT_ID is set, we pass
 *       payment_intent_data[transfer_data][destination] = acct
 *       payment_intent_data[application_fee_amount] = 0
 *     so funds settle directly to Silver Lining.
 *   - Otherwise we create the session on the platform account with no
 *     transfer_data; the caller is expected to stamp the orders row
 *     with status='awaiting_merchant_setup'.
 *
 * Idempotency: callers MUST pass an Idempotency-Key of shape
 *   shop_checkout:<order_id>
 * so replays return the same session_id (Stripe caches for 24h).
 */

import { isStripeConfigured } from './stripe.js';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2024-06-20';

function basicAuthHeader(secretKey) {
  return `Basic ${btoa(`${secretKey}:`)}`;
}

function encodeForm(payload, prefix = '') {
  const pairs = [];
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') {
          pairs.push(encodeForm(item, `${key}[${i}]`));
        } else {
          pairs.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else if (typeof v === 'object') {
      pairs.push(encodeForm(v, key));
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return pairs.filter(Boolean).join('&');
}

/**
 * Create a hosted Checkout Session.
 *
 * lineItems: [{ title, unitAmountCents, quantity, imageUrl?, sku? }]
 * ownerId, orderId: stamped into session.metadata for the webhook.
 * connectAccountId: when provided, transfer_data.destination + fee 0.
 */
export async function createCheckoutSession(env, {
  lineItems,
  ownerId,
  orderId,
  email,
  successUrl,
  cancelUrl,
  connectAccountId = null,
  idempotencyKey,
  source = 'shop',
  expenseDraftJson = null,
}) {
  if (!isStripeConfigured(env)) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return { ok: false, status: 400, data: null, error: 'no_line_items' };
  }

  const body = {
    mode: 'payment',
    success_url: successUrl,
    cancel_url: cancelUrl,
    shipping_address_collection: { allowed_countries: ['US'] },
    line_items: lineItems.map((li) => {
      const productMeta = {};
      if (li.sku) productMeta.sku = li.sku;
      if (li.shopifyVariantId) productMeta.shopify_variant_id = li.shopifyVariantId;
      if (li.productId) productMeta.ml_product_id = li.productId;
      return {
        quantity: li.quantity,
        price_data: {
          currency: 'usd',
          unit_amount: li.unitAmountCents,
          product_data: {
            name: li.title,
            ...(Object.keys(productMeta).length ? { metadata: productMeta } : {}),
            ...(li.imageUrl ? { images: [li.imageUrl] } : {}),
          },
        },
      };
    }),
    metadata: {
      ml_order_id: orderId,
      ml_owner_id: ownerId,
      ml_source: source,
      // Stripe metadata value cap is 500 chars. The in-expense draft
      // shape (animal_id + category + occurred_on + trimmed notes)
      // fits well under that for v1; a future oversized-notes case
      // can split into ml_expense_draft_extra. We JSON-stringify so
      // the webhook round-trips the same object shape the SPA sent.
      ...(expenseDraftJson ? { ml_expense_draft_json: expenseDraftJson } : {}),
    },
    payment_intent_data: {
      metadata: {
        ml_order_id: orderId,
        ml_owner_id: ownerId,
        ml_source: source,
      },
    },
  };

  if (email) body.customer_email = email;

  if (connectAccountId) {
    body.payment_intent_data.transfer_data = { destination: connectAccountId };
    body.payment_intent_data.application_fee_amount = 0;
  }

  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers,
    body: encodeForm(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      error: data?.error?.code || data?.error?.type || 'stripe_request_failed',
      message: data?.error?.message ?? null,
    };
  }
  return { ok: true, status: res.status, data };
}

/**
 * GET /v1/checkout/sessions/{id} — used by the webhook to snapshot line
 * items, totals, and associated payment_intent/charge back into our
 * `orders` + `order_line_items` rows.
 *
 * Expansions: line_items (max 100 rows) with price + product metadata
 * (we stored shopify_variant_id there on session create), plus the
 * payment_intent for charge id.
 */
export async function retrieveCheckoutSession(env, sessionId) {
  if (!isStripeConfigured(env)) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  const params = new URLSearchParams();
  params.append('expand[]', 'line_items');
  params.append('expand[]', 'line_items.data.price.product');
  params.append('expand[]', 'payment_intent');
  params.append('expand[]', 'payment_intent.latest_charge');

  const url = `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
      'Stripe-Version': STRIPE_API_VERSION,
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      error: data?.error?.code || data?.error?.type || 'stripe_request_failed',
      message: data?.error?.message ?? null,
    };
  }
  return { ok: true, status: res.status, data };
}
