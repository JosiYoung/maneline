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
 * POST /v1/accounts/{id} — patch a connected account. Used by Phase 7
 * PR #7 to push trainer branding (logo, primary color, display name)
 * onto the Connect account so the Stripe-hosted invoice page + PDF
 * render with the trainer's identity, not ours.
 *
 * Must be called WITHOUT the Stripe-Account header — we're modifying
 * the connected account itself as the platform.
 */
export function updateConnectAccount(env, accountId, patch) {
  return stripeFetch(env, 'POST', `/accounts/${encodeURIComponent(accountId)}`, patch);
}

/**
 * POST https://files.stripe.com/v1/files — multipart upload of a logo
 * image bytes so Stripe can reference it by file id in
 * settings.branding.{icon,logo}. Uploaded on-behalf-of the connected
 * account via Stripe-Account so the file is usable by that account.
 *
 * Returns { ok, data: { id, ... } } shaped like other helpers.
 */
export async function uploadStripeFileForAccount(env, {
  stripeAccountId,
  bytes,
  filename,
  mimeType,
  purpose = 'business_logo',
}) {
  if (!isStripeConfigured(env)) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  const form = new FormData();
  form.append('purpose', purpose);
  form.append('file', new Blob([bytes], { type: mimeType }), filename);

  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (stripeAccountId) headers['Stripe-Account'] = stripeAccountId;

  const res = await fetch('https://files.stripe.com/v1/files', {
    method: 'POST',
    headers,
    body: form,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      data,
      error: data?.error?.code || data?.error?.type || 'stripe_file_upload_failed',
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

/**
 * POST /v1/payment_intents — creates a PaymentIntent whose funds route to
 * the trainer's Connect account minus the platform fee.
 *
 *   application_fee_amount — in cents, kept by the platform
 *   transfer_data.destination — the trainer's acct_xxx
 *
 * We use an `Idempotency-Key` header (recommended for mutating Stripe
 * calls) so a retry from the SPA doesn't create two intents for the same
 * session_payment row.
 */
// Per-charge descriptor override so Mane Line owners see MANE LINE on
// their card statements regardless of the platform Stripe account's
// account-level default (which serves the platform's other businesses).
// Max 22 chars, alphanumeric + spaces, must contain ≥1 letter, no
// special chars except space. Stripe verifies these before charging.
const MANELINE_STATEMENT_DESCRIPTOR = 'MANE LINE';

export async function createPaymentIntent(env, {
  amountCents,
  applicationFeeAmountCents,
  destinationAccountId,
  metadata = {},
  idempotencyKey,
  description,
}) {
  if (!isStripeConfigured(env)) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  const body = {
    amount: amountCents,
    currency: 'usd',
    application_fee_amount: applicationFeeAmountCents,
    transfer_data: { destination: destinationAccountId },
    automatic_payment_methods: { enabled: true },
    statement_descriptor: MANELINE_STATEMENT_DESCRIPTOR,
    metadata,
  };
  if (description) body.description = description;

  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${STRIPE_API_BASE}/payment_intents`, {
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

export function retrievePaymentIntent(env, paymentIntentId) {
  return stripeFetch(env, 'GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}`);
}

/**
 * Phase 7 — white-label invoicing on Stripe Connect (direct charges).
 *
 * All calls below target the trainer's Connect account via the
 * `Stripe-Account` header so the Customer + Invoice rows live on the
 * trainer's books, the hosted-invoice page renders with the trainer's
 * branding (brand color + logo uploaded to Stripe), and payouts settle
 * directly to the trainer minus `application_fee_amount`.
 *
 * Idempotency-Key is accepted per mutating call so the Worker can key
 * on `invoice:{db_id}:finalize` / `send` / `void` and make a retry
 * from the SPA a no-op.
 */
async function stripeConnectFetch(env, method, path, body, opts = {}) {
  if (!isStripeConfigured(env)) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  const { stripeAccountId, idempotencyKey } = opts;
  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (stripeAccountId) headers['Stripe-Account'] = stripeAccountId;
  if (idempotencyKey)  headers['Idempotency-Key'] = idempotencyKey;

  let requestBody;
  if (body && Object.keys(body).length > 0) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    requestBody = encodeForm(body);
  }

  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method,
    headers,
    body: requestBody,
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

// POST /v1/customers on the trainer's Connect account. Safe to call
// multiple times — the Worker keeps a (trainer, owner|adhoc_email) ->
// stripe_customer_id map and short-circuits on hit.
export function createConnectCustomer(env, {
  stripeAccountId,
  email,
  name,
  metadata = {},
  idempotencyKey,
}) {
  const body = { metadata };
  if (email) body.email = email;
  if (name)  body.name  = name;
  return stripeConnectFetch(env, 'POST', '/customers', body, {
    stripeAccountId,
    idempotencyKey,
  });
}

// POST /v1/invoices — creates a DRAFT invoice on the trainer's account.
// We attach `application_fee_amount` so Stripe routes the platform cut
// to our account at finalize time. `auto_advance=false` because we
// drive the state transitions ourselves (finalize + send explicitly).
export function createConnectInvoice(env, {
  stripeAccountId,
  customerId,
  applicationFeeAmountCents,
  daysUntilDue,
  footerMemo,
  invoiceNumber,
  metadata = {},
  idempotencyKey,
}) {
  const body = {
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: daysUntilDue,
    auto_advance: 'false',
    metadata,
  };
  if (applicationFeeAmountCents && applicationFeeAmountCents > 0) {
    body.application_fee_amount = applicationFeeAmountCents;
  }
  if (footerMemo)    body.footer = footerMemo;
  if (invoiceNumber) body.number = invoiceNumber;
  return stripeConnectFetch(env, 'POST', '/invoices', body, {
    stripeAccountId,
    idempotencyKey,
  });
}

// POST /v1/invoiceitems — attach one line to the draft invoice. Stripe
// rolls these up into the invoice's subtotal at finalize time.
export function createConnectInvoiceItem(env, {
  stripeAccountId,
  customerId,
  invoiceId,
  amountCents,
  currency = 'usd',
  description,
  quantity,
  unitAmountCents,
  idempotencyKey,
}) {
  const body = {
    customer: customerId,
    invoice: invoiceId,
    currency,
    description,
  };
  // Prefer unit_amount + quantity when the caller provides both — gives
  // prettier hosted-invoice rendering. Fall back to a flat amount for
  // expenses/custom lines where "2.5 hrs × $120" isn't meaningful.
  if (unitAmountCents !== undefined && unitAmountCents !== null && quantity !== undefined && quantity !== null) {
    body.unit_amount = unitAmountCents;
    body.quantity    = quantity;
  } else {
    body.amount = amountCents;
  }
  return stripeConnectFetch(env, 'POST', '/invoiceitems', body, {
    stripeAccountId,
    idempotencyKey,
  });
}

// POST /v1/invoices/{id}/finalize — flips Stripe's status draft -> open
// and locks the invoice shape. Must happen before `send`.
export function finalizeConnectInvoice(env, { stripeAccountId, invoiceId, idempotencyKey }) {
  return stripeConnectFetch(
    env,
    'POST',
    `/invoices/${encodeURIComponent(invoiceId)}/finalize`,
    { auto_advance: 'false' },
    { stripeAccountId, idempotencyKey }
  );
}

// POST /v1/invoices/{id}/send — emails the hosted-invoice link to the
// customer. Idempotent server-side on Stripe when passed the same key.
export function sendConnectInvoice(env, { stripeAccountId, invoiceId, idempotencyKey }) {
  return stripeConnectFetch(
    env,
    'POST',
    `/invoices/${encodeURIComponent(invoiceId)}/send`,
    {},
    { stripeAccountId, idempotencyKey }
  );
}

// POST /v1/invoices/{id}/void — terminal state on Stripe. We mirror to
// status='void' + voided_at=now(). Stripe does NOT allow finalized
// invoices to be "deleted" — void is the audit-preserving answer.
export function voidConnectInvoice(env, { stripeAccountId, invoiceId, idempotencyKey }) {
  return stripeConnectFetch(
    env,
    'POST',
    `/invoices/${encodeURIComponent(invoiceId)}/void`,
    {},
    { stripeAccountId, idempotencyKey }
  );
}

export function retrieveConnectInvoice(env, { stripeAccountId, invoiceId }) {
  return stripeConnectFetch(
    env,
    'GET',
    `/invoices/${encodeURIComponent(invoiceId)}`,
    null,
    { stripeAccountId }
  );
}

/**
 * POST /v1/refunds — Phase 5.5 admin refund action. The shop orders are
 * destination charges (`transfer_data.destination` on the PaymentIntent),
 * so the refund is created on the platform account with
 * `reverse_transfer=true` + `refund_application_fee=true`. No
 * `Stripe-Account` header is used here (that would target the Connect
 * account, which does NOT own the underlying charge for destination
 * charges). Idempotency-Key keyed on `refund:{order_id}:{attempt_n}`
 * makes retries safe.
 */
export async function createRefund(env, {
  chargeId,
  paymentIntentId,
  amountCents,
  idempotencyKey,
  reverseTransfer = true,
  refundApplicationFee = true,
  metadata = {},
}) {
  if (!isStripeConfigured(env)) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  const body = {};
  if (paymentIntentId) body.payment_intent = paymentIntentId;
  else if (chargeId) body.charge = chargeId;
  else return { ok: false, status: 400, data: null, error: 'missing_charge_target' };
  if (amountCents !== undefined && amountCents !== null) body.amount = amountCents;
  if (reverseTransfer) body.reverse_transfer = 'true';
  if (refundApplicationFee) body.refund_application_fee = 'true';
  if (metadata && Object.keys(metadata).length) body.metadata = metadata;

  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${STRIPE_API_BASE}/refunds`, {
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
