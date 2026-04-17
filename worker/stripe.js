/**
 * Thin Stripe REST wrapper for the Worker.
 *
 * Uses fetch + HTTP Basic auth (Stripe's convention: secret key as the
 * username, empty password). No SDK — keeps the bundle tiny and sidesteps
 * the "Node fs" dependency chain the official library pulls in.
 *
 * Every call first checks STRIPE_SECRET_KEY. If the secret isn't set the
 * call returns `{ ok: false, status: 501, error: 'stripe_not_configured' }`
 * so callers can surface a friendly "waiting on keys" state instead of 500.
 *
 * TECH_DEBT(phase-2): STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET are
 * placeholders until Cedric finishes verifying the company's payment
 * processor. All /api/stripe/* endpoints gracefully return 501 until
 * those secrets are set via `npx wrangler secret put`.
 */

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2024-06-20';

/**
 * Serialize a flat or nested object into Stripe's `foo[bar]=baz` form.
 * Arrays become `foo[0]=...&foo[1]=...`. Nulls are skipped. Booleans
 * stringified. We keep the implementation intentionally small — Stripe
 * Connect onboarding only needs 2-level nesting at most.
 */
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

function basicAuthHeader(secretKey) {
  // HTTP Basic: base64("sk_test_xxx:")
  return `Basic ${btoa(`${secretKey}:`)}`;
}

export function isStripeConfigured(env) {
  return Boolean(env && env.STRIPE_SECRET_KEY);
}

async function stripeFetch(env, method, path, body) {
  if (!isStripeConfigured(env)) {
    return {
      ok: false,
      status: 501,
      data: null,
      error: 'stripe_not_configured',
    };
  }

  const url = `${STRIPE_API_BASE}${path}`;
  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
  };
  let requestBody;
  if (body && Object.keys(body).length > 0) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    requestBody = encodeForm(body);
  }

  const res = await fetch(url, { method, headers, body: requestBody });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

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
 * POST /v1/accounts — create a Stripe Connect Express account for a
 * trainer. We pass capabilities and the trainer's email so Stripe can
 * pre-fill the onboarding form.
 */
export function createExpressAccount(env, { email, metadata = {} }) {
  return stripeFetch(env, 'POST', '/accounts', {
    type: 'express',
    country: 'US',
    email,
    capabilities: {
      card_payments: { requested: true },
      transfers:     { requested: true },
    },
    business_type: 'individual',
    metadata,
  });
}

/**
 * GET /v1/accounts/{id} — pull the latest state of a Connect account,
 * including charges_enabled / payouts_enabled / details_submitted /
 * requirements.disabled_reason.
 */
export function retrieveAccount(env, accountId) {
  return stripeFetch(env, 'GET', `/accounts/${encodeURIComponent(accountId)}`);
}

/**
 * POST /v1/account_links — create a single-use onboarding link the
 * trainer must visit to finish KYC + bank info. Link type is
 * 'account_onboarding' for first-time flows and 'account_update' if a
 * trainer needs to re-submit something Stripe flagged later.
 */
export function createAccountLink(env, {
  accountId,
  refreshUrl,
  returnUrl,
  type = 'account_onboarding',
}) {
  return stripeFetch(env, 'POST', '/account_links', {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type,
  });
}
