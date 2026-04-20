/**
 * Mane Line — Stripe Subscriptions (Phase 6.5).
 *
 * Two surfaces:
 *
 *   1) Webhook fan-out for customer.subscription.created/updated/deleted
 *      + invoice.payment_succeeded/failed. Upserts the
 *      stripe_subscriptions cache (source of truth = Stripe; row here =
 *      read-through snapshot). On invoice.payment_succeeded also inserts
 *      an `orders` row with source='subscription' so Phase 5.2 GMV /
 *      attach-rate math continues to work.
 *
 *   2) Admin surface for /admin/subscriptions:
 *        GET    /api/admin/subscriptions?status=...
 *        GET    /api/admin/subscriptions/:id          (+ invoices list)
 *        POST   /api/admin/subscriptions/:id/cancel   ({at_period_end:true})
 *        POST   /api/admin/subscriptions/:id/pause    ({resumes_at?})
 *
 * All Stripe-mutating endpoints return 501 stripe_not_configured when
 * STRIPE_SECRET_KEY is absent (Phase 5.5 refund pattern).
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

async function stripeFetch(env, method, path, body) {
  if (!isStripeConfigured(env)) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
  };
  let reqBody;
  if (body && Object.keys(body).length > 0) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    reqBody = encodeForm(body);
  }
  const res = await fetch(`${STRIPE_API_BASE}${path}`, { method, headers, body: reqBody });
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

// ---------- Supabase REST helpers (self-contained, service_role) ---------

async function sbSelect(env, table, query) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function sbUpsert(env, table, row, onConflict) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=representation,resolution=merge-duplicates',
      },
      body: JSON.stringify(row),
    },
  );
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  return { ok: res.ok, status: res.status, data };
}

async function sbInsert(env, table, row) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  return { ok: res.ok, status: res.status, data };
}

async function sbUpdate(env, table, filter, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  const data = Array.isArray(parsed) ? parsed[0] : parsed;
  return { ok: res.ok, status: res.status, data };
}

async function sbAudit(env, row) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/audit_log`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch (err) {
    console.warn('[audit] insert failed:', err?.message);
  }
}

function jsonResp(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

// ---------- Helpers ------------------------------------------------------

const ID_LIKE = /^[A-Za-z0-9_]{4,255}$/;

function toIso(ts) {
  if (!ts || !Number.isFinite(ts)) return null;
  return new Date(ts * 1000).toISOString();
}

function extractItems(sub) {
  const data = Array.isArray(sub?.items?.data) ? sub.items.data : [];
  return data.map((it) => ({
    id:         it.id || null,
    price_id:   it.price?.id || null,
    product_id: typeof it.price?.product === 'string' ? it.price.product : (it.price?.product?.id || null),
    sku:        it.price?.metadata?.sku || it.price?.product?.metadata?.sku || null,
    quantity:   Number.isFinite(it.quantity) ? it.quantity : 1,
    unit_amount_cents: Number.isFinite(it.price?.unit_amount) ? it.price.unit_amount : null,
    currency:   it.price?.currency || null,
    interval:   it.price?.recurring?.interval || null,
  }));
}

async function resolveOwnerIdByCustomer(env, customerId) {
  if (!customerId) return null;
  // First: do we already have this customer on a prior row?
  const prior = await sbSelect(
    env,
    'stripe_subscriptions',
    `select=owner_id&customer_id=eq.${encodeURIComponent(customerId)}&owner_id=not.is.null&limit=1`,
  );
  const priorRow = Array.isArray(prior.data) ? prior.data[0] : null;
  if (priorRow?.owner_id) return priorRow.owner_id;

  // Otherwise: fetch the customer and match by email → user_profiles.
  if (!isStripeConfigured(env)) return null;
  const cust = await stripeFetch(env, 'GET', `/customers/${encodeURIComponent(customerId)}`);
  const email = cust.ok ? (cust.data?.email || null) : null;
  if (!email) return null;
  const lookup = await sbSelect(
    env,
    'user_profiles',
    `select=user_id&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`,
  );
  const row = Array.isArray(lookup.data) ? lookup.data[0] : null;
  return row?.user_id || null;
}

async function upsertSubscriptionCache(env, sub, { overrideStatus } = {}) {
  if (!sub?.id) return { ok: false, error: 'missing_sub_id' };
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id || null;
  const ownerId = await resolveOwnerIdByCustomer(env, customerId);

  const row = {
    id:                    sub.id,
    owner_id:              ownerId,
    customer_id:           customerId || '',
    status:                overrideStatus || sub.status || 'incomplete',
    current_period_start:  toIso(sub.current_period_start),
    current_period_end:    toIso(sub.current_period_end),
    cancel_at_period_end:  Boolean(sub.cancel_at_period_end),
    items:                 extractItems(sub),
    last_synced_at:        new Date().toISOString(),
  };
  const up = await sbUpsert(env, 'stripe_subscriptions', row, 'id');
  return up;
}

// ---------- Webhook handlers --------------------------------------------

/**
 * customer.subscription.created / updated / deleted.
 * Single path: upsert the cache row with the latest Stripe payload.
 * 'deleted' carries Stripe-normalized status='canceled', so the
 * existing status column captures it — no separate column needed.
 */
export async function handleSubscriptionLifecycle(env, event) {
  const sub = event.data?.object;
  if (!sub?.id) return { ok: false, error: 'missing_subscription' };
  const up = await upsertSubscriptionCache(env, sub);
  if (!up.ok) return { ok: false, error: 'cache_upsert_failed' };
  return { ok: true, subscription_id: sub.id };
}

/**
 * invoice.payment_succeeded. If the invoice is tied to a subscription
 * we (a) refresh the cache row, (b) insert an orders row with
 * source='subscription' so the Phase 5.2 GMV math keeps counting the
 * recurring revenue.
 */
export async function handleInvoicePaymentSucceeded(env, event) {
  const invoice = event.data?.object;
  if (!invoice?.id) return { ok: false, error: 'missing_invoice' };

  const subId = typeof invoice.subscription === 'string'
    ? invoice.subscription
    : (invoice.subscription?.id || null);
  if (!subId) return { ok: true, ignored: true, reason: 'not_subscription_invoice' };

  // Refresh sub cache — pull sub fresh so we never miss a status flip
  // (e.g. past_due → active after a successful retry).
  const sub = await stripeFetch(env, 'GET', `/subscriptions/${encodeURIComponent(subId)}`);
  if (sub.ok && sub.data) {
    await upsertSubscriptionCache(env, sub.data);
  }

  // Idempotency: skip if we've already inserted this invoice as an order.
  const existing = await sbSelect(
    env,
    'orders',
    `select=id&stripe_invoice_id=eq.${encodeURIComponent(invoice.id)}&limit=1`,
  );
  if (Array.isArray(existing.data) && existing.data[0]) {
    return { ok: true, idempotent: true };
  }

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || null;
  const ownerId = await resolveOwnerIdByCustomer(env, customerId);
  if (!ownerId) {
    // No owner match — record a minimal row tagged ownerless for admin
    // reconciliation rather than dropping revenue on the floor.
    console.warn('[subscriptions] invoice.paid: no owner match', {
      invoice_id: invoice.id, customer: customerId,
    });
  }

  const totalCents = Number.isFinite(invoice.amount_paid)
    ? invoice.amount_paid
    : (Number.isFinite(invoice.total) ? invoice.total : 0);
  const subtotalCents = Number.isFinite(invoice.subtotal) ? invoice.subtotal : totalCents;
  const taxCents = Number.isFinite(invoice.tax) ? invoice.tax : 0;
  const chargeId = typeof invoice.charge === 'string' ? invoice.charge : (invoice.charge?.id || null);
  const piId = typeof invoice.payment_intent === 'string'
    ? invoice.payment_intent
    : (invoice.payment_intent?.id || null);
  const receiptUrl = invoice.hosted_invoice_url || null;

  const orderRow = {
    owner_id:                 ownerId,
    source:                   'subscription',
    status:                   'paid',
    subtotal_cents:           subtotalCents,
    tax_cents:                taxCents,
    shipping_cents:           0,
    total_cents:              totalCents,
    stripe_payment_intent_id: piId,
    stripe_charge_id:         chargeId,
    stripe_receipt_url:       receiptUrl,
    stripe_invoice_id:        invoice.id,
    stripe_subscription_id:   subId,
  };

  const ins = await sbInsert(env, 'orders', orderRow);
  if (!ins.ok) {
    return { ok: false, error: 'order_insert_failed', detail: ins.data };
  }

  await sbAudit(env, {
    actor_id:     null,
    actor_role:   'system',
    action:       'subscription.invoice.paid',
    target_table: 'orders',
    target_id:    ins.data?.id || null,
    metadata: {
      event_id:       event.id,
      invoice_id:     invoice.id,
      subscription:   subId,
      customer_id:    customerId,
      total_cents:    totalCents,
    },
  });

  return { ok: true, order_id: ins.data?.id || null };
}

/**
 * invoice.payment_failed. Flip the cache row status to 'past_due' so
 * the admin panel's Past-due tab surfaces it. We do NOT archive — the
 * next successful retry flips it back to 'active' via
 * handleInvoicePaymentSucceeded.
 */
export async function handleInvoicePaymentFailed(env, event) {
  const invoice = event.data?.object;
  const subId = typeof invoice?.subscription === 'string'
    ? invoice.subscription
    : (invoice?.subscription?.id || null);
  if (!subId) return { ok: true, ignored: true, reason: 'not_subscription_invoice' };

  const sub = await stripeFetch(env, 'GET', `/subscriptions/${encodeURIComponent(subId)}`);
  if (sub.ok && sub.data) {
    // Trust Stripe's status if it's past_due/unpaid; otherwise stamp
    // past_due regardless of stale Stripe state.
    const status = sub.data.status === 'past_due' || sub.data.status === 'unpaid'
      ? sub.data.status
      : 'past_due';
    await upsertSubscriptionCache(env, sub.data, { overrideStatus: status });
  } else {
    await sbUpdate(
      env,
      'stripe_subscriptions',
      `id=eq.${encodeURIComponent(subId)}`,
      { status: 'past_due', last_synced_at: new Date().toISOString() },
    );
  }

  return { ok: true, subscription_id: subId, status: 'past_due' };
}

// ---------- Admin surfaces ----------------------------------------------

export async function adminSubscriptionsList(env, url) {
  const status = (url.searchParams.get('status') || '').trim();
  const parts = [
    'select=id,owner_id,customer_id,status,current_period_start,current_period_end,cancel_at_period_end,items,last_synced_at,archived_at,created_at,updated_at',
    'order=created_at.desc',
    'limit=200',
  ];
  if (status === 'active' || status === 'past_due' || status === 'canceled'
      || status === 'trialing' || status === 'paused' || status === 'unpaid'
      || status === 'incomplete' || status === 'incomplete_expired') {
    parts.push(`status=eq.${status}`);
  }
  const q = await sbSelect(env, 'stripe_subscriptions', parts.join('&'));
  const rows = q.ok && Array.isArray(q.data) ? q.data : [];

  // Hydrate owner email / display_name.
  const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))];
  const userMap = new Map();
  if (ownerIds.length) {
    const inList = ownerIds.map((i) => `"${i}"`).join(',');
    const u = await sbSelect(
      env,
      'user_profiles',
      `select=user_id,email,display_name&user_id=in.(${inList})`,
    );
    const users = u.ok && Array.isArray(u.data) ? u.data : [];
    for (const row of users) userMap.set(row.user_id, row);
  }

  const hydrated = rows.map((r) => ({
    ...r,
    owner_email:        userMap.get(r.owner_id)?.email || null,
    owner_display_name: userMap.get(r.owner_id)?.display_name || null,
  }));
  return jsonResp({ rows: hydrated });
}

export async function adminSubscriptionsGet(env, id) {
  if (!ID_LIKE.test(id)) return jsonResp({ error: 'bad_id' }, 400);

  const q = await sbSelect(
    env,
    'stripe_subscriptions',
    `select=*&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const row = Array.isArray(q.data) ? q.data[0] : null;
  if (!row) return jsonResp({ error: 'not_found' }, 404);

  // Hydrate owner.
  let owner = null;
  if (row.owner_id) {
    const u = await sbSelect(
      env,
      'user_profiles',
      `select=user_id,email,display_name&user_id=eq.${encodeURIComponent(row.owner_id)}&limit=1`,
    );
    owner = Array.isArray(u.data) ? u.data[0] : null;
  }

  // Invoice history — Stripe is source of truth. Cached orders list
  // (`source='subscription'`) is a side channel for GMV, not the
  // authoritative per-invoice view.
  let invoices = null;
  let invoicesError = null;
  if (isStripeConfigured(env)) {
    const inv = await stripeFetch(
      env,
      'GET',
      `/invoices?subscription=${encodeURIComponent(id)}&limit=24`,
    );
    if (inv.ok) {
      const items = Array.isArray(inv.data?.data) ? inv.data.data : [];
      invoices = items.map((i) => ({
        id:              i.id,
        number:          i.number || null,
        status:          i.status || null,
        amount_due:      Number.isFinite(i.amount_due) ? i.amount_due : null,
        amount_paid:     Number.isFinite(i.amount_paid) ? i.amount_paid : null,
        currency:        i.currency || 'usd',
        created:         toIso(i.created),
        period_start:    toIso(i.period_start),
        period_end:      toIso(i.period_end),
        hosted_url:      i.hosted_invoice_url || null,
        pdf_url:         i.invoice_pdf || null,
      }));
    } else {
      invoicesError = inv.error || 'stripe_fetch_failed';
    }
  } else {
    invoicesError = 'stripe_not_configured';
  }

  return jsonResp({
    subscription: {
      ...row,
      owner_email:        owner?.email || null,
      owner_display_name: owner?.display_name || null,
    },
    invoices,
    invoices_error: invoicesError,
  });
}

export async function adminSubscriptionsCancel(env, request, actorId, id) {
  if (!ID_LIKE.test(id)) return jsonResp({ error: 'bad_id' }, 400);
  if (!isStripeConfigured(env)) return jsonResp({ error: 'stripe_not_configured' }, 501);

  const res = await stripeFetch(env, 'POST', `/subscriptions/${encodeURIComponent(id)}`, {
    cancel_at_period_end: 'true',
  });
  if (!res.ok) {
    if (res.status === 404) return jsonResp({ error: 'not_found' }, 404);
    return jsonResp({
      error: 'stripe_cancel_failed',
      code: res.error,
      message: res.message || null,
    }, res.status >= 400 && res.status < 600 ? res.status : 502);
  }

  const up = await upsertSubscriptionCache(env, res.data);
  await sbAudit(env, {
    actor_id:     actorId,
    actor_role:   'silver_lining',
    action:       'admin.subscription.cancel',
    target_table: 'stripe_subscriptions',
    target_id:    id,
    metadata:     { at_period_end: true },
  });

  return jsonResp({ subscription: up.data || res.data });
}

export async function adminSubscriptionsPause(env, request, actorId, id) {
  if (!ID_LIKE.test(id)) return jsonResp({ error: 'bad_id' }, 400);
  if (!isStripeConfigured(env)) return jsonResp({ error: 'stripe_not_configured' }, 501);

  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const resumesAtRaw = typeof body?.resumes_at === 'string' ? body.resumes_at.trim() : '';
  const payload = {
    'pause_collection[behavior]': 'mark_uncollectible',
  };
  if (resumesAtRaw) {
    const ms = Date.parse(resumesAtRaw);
    if (Number.isNaN(ms)) return jsonResp({ error: 'bad_resumes_at' }, 400);
    payload['pause_collection[resumes_at]'] = Math.floor(ms / 1000);
  }

  const res = await stripeFetch(env, 'POST', `/subscriptions/${encodeURIComponent(id)}`, payload);
  if (!res.ok) {
    if (res.status === 404) return jsonResp({ error: 'not_found' }, 404);
    return jsonResp({
      error: 'stripe_pause_failed',
      code: res.error,
      message: res.message || null,
    }, res.status >= 400 && res.status < 600 ? res.status : 502);
  }

  const up = await upsertSubscriptionCache(env, res.data);
  await sbAudit(env, {
    actor_id:     actorId,
    actor_role:   'silver_lining',
    action:       'admin.subscription.pause',
    target_table: 'stripe_subscriptions',
    target_id:    id,
    metadata:     { resumes_at: resumesAtRaw || null, behavior: 'mark_uncollectible' },
  });

  return jsonResp({ subscription: up.data || res.data });
}

export async function adminSubscriptionsResume(env, request, actorId, id) {
  if (!ID_LIKE.test(id)) return jsonResp({ error: 'bad_id' }, 400);
  if (!isStripeConfigured(env)) return jsonResp({ error: 'stripe_not_configured' }, 501);

  // Stripe: setting pause_collection to empty string clears the pause.
  const res = await stripeFetch(env, 'POST', `/subscriptions/${encodeURIComponent(id)}`, {
    pause_collection: '',
  });
  if (!res.ok) {
    if (res.status === 404) return jsonResp({ error: 'not_found' }, 404);
    return jsonResp({
      error: 'stripe_resume_failed',
      code: res.error,
      message: res.message || null,
    }, res.status >= 400 && res.status < 600 ? res.status : 502);
  }

  const up = await upsertSubscriptionCache(env, res.data);
  await sbAudit(env, {
    actor_id:     actorId,
    actor_role:   'silver_lining',
    action:       'admin.subscription.resume',
    target_table: 'stripe_subscriptions',
    target_id:    id,
  });

  return jsonResp({ subscription: up.data || res.data });
}
