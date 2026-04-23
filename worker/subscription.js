/**
 * Mane Line — Phase 8 Module 05 — Barn Mode subscription + SL comp +
 * promo codes.
 *
 * All service-role helpers + platform-tier Stripe calls. Route handlers
 * own auth + rate + top-level audit; this module handles the data-layer
 * + entitlement-event book-keeping.
 *
 * Compliance:
 *   OAG §2 — every write service_role; platform Stripe calls omit the
 *            Stripe-Account header (Phase 7 Connect charges live in a
 *            sibling helper).
 *   OAG §3 — every mutation paired with a barn_mode_entitlement_events
 *            insert (append-only entitlement audit).
 *   OAG §8 — archive flips; no DELETE.
 */

const RESTB = (env) => `${env.SUPABASE_URL}/rest/v1`;
const SR = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

const STRIPE_API_BASE = 'https://api.stripe.com/v1';
const STRIPE_API_VERSION = '2024-06-20';

export function isStripePlatformConfigured(env) {
  return Boolean(env?.STRIPE_SECRET_KEY && env?.STRIPE_PRICE_BARN_MODE_MONTHLY);
}

// Phase 9 — Trainer Pro pricing is configured separately so the owner
// Barn Mode feature stays independent of the trainer billing rollout.
export function isTrainerProConfigured(env) {
  return Boolean(env?.STRIPE_SECRET_KEY && env?.STRIPE_PRICE_TRAINER_PRO_MONTHLY);
}

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

async function stripePlatformFetch(env, method, path, body, idempotencyKey) {
  if (!env.STRIPE_SECRET_KEY) {
    return { ok: false, status: 501, data: null, error: 'stripe_not_configured' };
  }
  const headers = {
    Authorization: basicAuthHeader(env.STRIPE_SECRET_KEY),
    'Stripe-Version': STRIPE_API_VERSION,
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
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

// ---------- subscriptions table helpers ----------

export async function getSubscriptionForOwner(env, ownerId) {
  const q = [
    'select=id,owner_id,role_scope,tier,status,stripe_customer_id,stripe_subscription_id,stripe_price_id,comp_source,comp_campaign,comp_expires_at,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at',
    `owner_id=eq.${ownerId}`,
    'role_scope=eq.owner',
    'archived_at=is.null',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/subscriptions?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

// Phase 9 — trainer-scoped subscription row (tier=trainer_pro).
// Absence of a row means the trainer is on the free part-time plan.
export async function getSubscriptionForTrainer(env, trainerId) {
  const q = [
    'select=id,owner_id,role_scope,tier,status,stripe_customer_id,stripe_subscription_id,stripe_price_id,current_period_start,current_period_end,cancel_at_period_end,created_at,updated_at',
    `owner_id=eq.${trainerId}`,
    'role_scope=eq.trainer',
    'archived_at=is.null',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/subscriptions?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

// Count distinct horses this trainer has access to — used for the
// trainer Settings page horse meter + pre-flight paywall UX. The DB
// trigger in 00027 is the authoritative gate.
export async function countTrainerDistinctHorses(env, trainerId) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/trainer_distinct_horse_count`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_trainer_id: trainerId }),
  });
  if (!r.ok) return { ok: false, status: r.status, data: 0 };
  const n = Number(await r.text().catch(() => '0'));
  return { ok: true, status: 200, data: Number.isFinite(n) ? n : 0 };
}

export function trainerHasPro(sub) {
  if (!sub) return false;
  if (sub.role_scope !== 'trainer') return false;
  if (sub.tier !== 'trainer_pro') return false;
  return ['active', 'trialing'].includes(sub.status);
}

export async function insertSubscriptionRow(env, row) {
  const r = await fetch(`${RESTB(env)}/subscriptions`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = (await r.json().catch(() => [])) || [];
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function patchSubscription(env, subId, patch) {
  const r = await fetch(`${RESTB(env)}/subscriptions?id=eq.${subId}`, {
    method: 'PATCH',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = (await r.json().catch(() => [])) || [];
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function listEntitlementEvents(env, ownerId, limit = 20) {
  const q = [
    'select=event,reason,source,prev_tier,next_tier,prev_comp_source,next_comp_source,metadata,created_at',
    `owner_id=eq.${ownerId}`,
    'order=created_at.desc',
    `limit=${limit}`,
  ].join('&');
  const r = await fetch(`${RESTB(env)}/barn_mode_entitlement_events?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows };
}

export async function insertEntitlementEvent(env, ev) {
  const r = await fetch(`${RESTB(env)}/barn_mode_entitlement_events`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(ev),
  });
  return { ok: r.ok, status: r.status };
}

// Count current non-archived horses for an owner — used by the paywall
// soft/hard UX on top of the DB trigger.
export async function countOwnerHorses(env, ownerId) {
  const q = [
    'select=id',
    `owner_id=eq.${ownerId}`,
    'archived_at=is.null',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/animals?${q}`, {
    headers: { ...SR(env), Prefer: 'count=exact' },
  });
  if (!r.ok) return { ok: false, status: r.status, data: 0 };
  const range = r.headers.get('content-range');
  const total = range ? Number(range.split('/')[1] || 0) : 0;
  return { ok: true, status: 200, data: total };
}

// Is the owner currently entitled to Barn Mode (paid or comp)?
export function ownerHasBarnMode(sub) {
  if (!sub) return false;
  if (!['active', 'trialing'].includes(sub.status)) return false;
  if (sub.tier === 'barn_mode') return true;
  if (sub.comp_source) {
    if (!sub.comp_expires_at) return true;
    return new Date(sub.comp_expires_at).getTime() > Date.now();
  }
  return false;
}

// ---------- silver_lining_links ----------

export async function getSilverLiningLinkForOwner(env, ownerId) {
  const q = [
    'select=id,owner_id,silver_lining_customer_id,linked_at,last_verified_at,last_verification_status,last_verification_error,sticky_until,stripe_setup_intent_id,stripe_payment_method_id,archived_at',
    `owner_id=eq.${ownerId}`,
    'archived_at=is.null',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/silver_lining_links?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

export async function getActiveLinkByCustomerId(env, customerId) {
  const q = [
    'select=id,owner_id,sticky_until,archived_at',
    `silver_lining_customer_id=eq.${encodeURIComponent(customerId)}`,
    'archived_at=is.null',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/silver_lining_links?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

export async function getAnyLinkByCustomerId(env, customerId) {
  const q = [
    'select=id,owner_id,sticky_until,archived_at',
    `silver_lining_customer_id=eq.${encodeURIComponent(customerId)}`,
    'order=linked_at.desc',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/silver_lining_links?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

export async function insertSilverLiningLink(env, row) {
  const r = await fetch(`${RESTB(env)}/silver_lining_links`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = (await r.json().catch(() => [])) || [];
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function patchSilverLiningLink(env, linkId, patch) {
  const r = await fetch(`${RESTB(env)}/silver_lining_links?id=eq.${linkId}`, {
    method: 'PATCH',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(patch),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = (await r.json().catch(() => [])) || [];
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

// ---------- promo_codes ----------

export async function findPromoByCode(env, code) {
  const q = [
    'select=id,code,campaign,grants_barn_mode_months,single_use,expires_at,redeemed_at,redeemed_by_owner_id,archived_at',
    `code=ilike.${encodeURIComponent(code)}`,
    'archived_at=is.null',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/promo_codes?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows[0] || null };
}

export async function markPromoRedeemed(env, promoId, ownerId) {
  // Optimistic concurrency — only flip if redeemed_at still NULL.
  const r = await fetch(
    `${RESTB(env)}/promo_codes?id=eq.${promoId}&redeemed_at=is.null`,
    {
      method: 'PATCH',
      headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        redeemed_at: new Date().toISOString(),
        redeemed_by_owner_id: ownerId,
      }),
    }
  );
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = (await r.json().catch(() => [])) || [];
  return { ok: true, status: r.status, data: Array.isArray(data) ? data[0] : null };
}

export async function listPromoCodes(env, campaign) {
  const params = [
    'select=id,code,campaign,grants_barn_mode_months,single_use,expires_at,redeemed_at,redeemed_by_owner_id,created_at,archived_at,notes',
    'archived_at=is.null',
    'order=created_at.desc',
    'limit=500',
  ];
  if (campaign) params.push(`campaign=eq.${encodeURIComponent(campaign)}`);
  const r = await fetch(`${RESTB(env)}/promo_codes?${params.join('&')}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, status: 200, data: rows };
}

export async function insertPromoCodesBulk(env, rows) {
  const r = await fetch(`${RESTB(env)}/promo_codes`, {
    method: 'POST',
    headers: { ...SR(env), 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(rows),
  });
  if (!r.ok) return { ok: false, status: r.status, data: null };
  const data = (await r.json().catch(() => [])) || [];
  return { ok: true, status: r.status, data: Array.isArray(data) ? data : [] };
}

// Generates a readable, uppercase code: 3 letters · 4 alphanumerics,
// separated by a dash (no 0/O/1/I to avoid OCR confusion).
const CODE_ALPHA_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_ALPHA_ALNUM   = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePromoCode() {
  const rand = (alphabet, len) => {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    let out = '';
    for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
    return out;
  };
  return `${rand(CODE_ALPHA_LETTERS, 3)}-${rand(CODE_ALPHA_ALNUM, 4)}`;
}

// ---------- Stripe platform calls ----------

/**
 * Create (or reuse) the platform Stripe customer for this owner.
 * Keeps the customer id on subscriptions.stripe_customer_id so we hit
 * Stripe at most once per owner even when there is no active sub yet.
 */
export async function ensurePlatformStripeCustomer(env, { ownerId, email, existingCustomerId }) {
  if (existingCustomerId) return { ok: true, data: { id: existingCustomerId } };
  const r = await stripePlatformFetch(env, 'POST', '/customers', {
    email,
    metadata: { ml_owner_id: ownerId, ml_role: 'owner' },
  });
  if (!r.ok) return r;
  return { ok: true, data: r.data };
}

/**
 * Create a hosted Stripe Checkout session for Barn Mode.
 * Platform charge — NO Stripe-Account header.
 */
export async function createBarnModeCheckoutSession(env, {
  ownerId,
  customerId,
  priceId,
  successUrl,
  cancelUrl,
  idempotencyKey,
}) {
  return stripePlatformFetch(env, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { ml_owner_id: ownerId, ml_source: 'barn_mode_subscription' },
    subscription_data: {
      metadata: { ml_owner_id: ownerId },
    },
    allow_promotion_codes: 'true',
  }, idempotencyKey);
}

// Phase 9 — Trainer Pro Checkout. Same pattern as Barn Mode; distinct
// metadata.ml_source so the webhook mirror routes the payload to a
// role_scope='trainer' + tier='trainer_pro' row.
export async function createTrainerProCheckoutSession(env, {
  trainerId,
  customerId,
  priceId,
  successUrl,
  cancelUrl,
  idempotencyKey,
}) {
  return stripePlatformFetch(env, 'POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { ml_user_id: trainerId, ml_source: 'trainer_pro_subscription' },
    subscription_data: {
      metadata: { ml_user_id: trainerId, ml_source: 'trainer_pro_subscription' },
    },
    allow_promotion_codes: 'true',
  }, idempotencyKey);
}

export async function ensurePlatformTrainerStripeCustomer(env, { trainerId, email, existingCustomerId }) {
  if (existingCustomerId) return { ok: true, data: { id: existingCustomerId } };
  const r = await stripePlatformFetch(env, 'POST', '/customers', {
    email,
    metadata: { ml_user_id: trainerId, ml_role: 'trainer' },
  });
  if (!r.ok) return r;
  return { ok: true, data: r.data };
}

export async function createBillingPortalSession(env, { customerId, returnUrl }) {
  return stripePlatformFetch(env, 'POST', '/billing_portal/sessions', {
    customer: customerId,
    return_url: returnUrl,
  });
}

export async function createSetupIntent(env, { customerId, metadata = {} }) {
  return stripePlatformFetch(env, 'POST', '/setup_intents', {
    customer: customerId,
    usage: 'off_session',
    payment_method_types: ['card'],
    metadata,
  });
}

export async function retrieveSetupIntent(env, setupIntentId) {
  return stripePlatformFetch(env, 'GET', `/setup_intents/${encodeURIComponent(setupIntentId)}`);
}

export async function retrieveStripeSubscription(env, subId) {
  return stripePlatformFetch(env, 'GET', `/subscriptions/${encodeURIComponent(subId)}`);
}

// ---------- Webhook mirrors (Phase 8 subscriptions entity) ----------

function stripeStatusToBarnMode(s) {
  switch (s) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'past_due';
    case 'paused':
      return 'paused';
    case 'canceled':
    case 'incomplete_expired':
      return 'cancelled';
    default:
      return 'active';
  }
}

async function getSubscriptionByStripeSubId(env, stripeSubId) {
  const q = [
    'select=id,owner_id,tier,status,stripe_customer_id,stripe_subscription_id,comp_source,archived_at',
    `stripe_subscription_id=eq.${encodeURIComponent(stripeSubId)}`,
    'archived_at=is.null',
    'limit=1',
  ].join('&');
  const r = await fetch(`${RESTB(env)}/subscriptions?${q}`, { headers: SR(env) });
  if (!r.ok) return { ok: false, data: null };
  const rows = (await r.json().catch(() => [])) || [];
  return { ok: true, data: rows[0] || null };
}

/**
 * Mirror a Stripe subscription payload into the Phase 8 `subscriptions`
 * entity, plus append an entitlement event for any material transition.
 * Idempotent — replaying the same webhook leaves both tables alone.
 *
 * Returns { ok: true, mirrored: true } if we touched the row; { ok: true,
 * ignored: true, reason } when it's not a Barn Mode subscription (e.g.
 * Phase 6.5 ecommerce subs).
 */
export async function mirrorBarnModeSubscriptionFromStripe(env, stripeSub, { eventId, forcedStatus } = {}) {
  if (!stripeSub?.id) return { ok: false, error: 'missing_subscription' };

  // Phase 9 — the same mirror function handles owner (barn_mode) and
  // trainer (trainer_pro) subs. Discriminator is metadata.ml_source.
  const source = stripeSub.metadata?.ml_source || null;
  const isTrainerPro = source === 'trainer_pro_subscription';
  const targetTier   = isTrainerPro ? 'trainer_pro' : 'barn_mode';
  const targetScope  = isTrainerPro ? 'trainer' : 'owner';

  const ownerIdMeta = isTrainerPro
    ? (stripeSub.metadata?.ml_user_id || null)
    : (stripeSub.metadata?.ml_owner_id || null);
  const existing = await getSubscriptionByStripeSubId(env, stripeSub.id);
  const existingRow = existing.data;

  // If neither metadata identifies a ML user nor we already mirror it,
  // leave it alone — Phase 6.5 ecommerce subs must not touch this table.
  if (!existingRow && !ownerIdMeta) {
    return { ok: true, ignored: true, reason: 'not_ml_subscription' };
  }
  const ownerId = existingRow?.owner_id || ownerIdMeta;
  if (!ownerId) return { ok: true, ignored: true, reason: 'no_user_id' };

  const nextStatus = forcedStatus || stripeStatusToBarnMode(stripeSub.status);
  const toIso = (t) => (Number.isFinite(t) ? new Date(t * 1000).toISOString() : null);

  const priceId = Array.isArray(stripeSub.items?.data) && stripeSub.items.data[0]?.price?.id
    ? stripeSub.items.data[0].price.id
    : null;
  const customerId = typeof stripeSub.customer === 'string'
    ? stripeSub.customer
    : (stripeSub.customer?.id || null);

  const patch = {
    tier:                   targetTier,
    status:                 nextStatus,
    stripe_customer_id:     customerId,
    stripe_subscription_id: stripeSub.id,
    stripe_price_id:        priceId,
    current_period_start:   toIso(stripeSub.current_period_start),
    current_period_end:     toIso(stripeSub.current_period_end),
    cancel_at_period_end:   Boolean(stripeSub.cancel_at_period_end),
    last_webhook_event_at:  new Date().toISOString(),
  };
  if (nextStatus === 'cancelled') {
    patch.archived_at = new Date().toISOString();
  }

  const prevTier   = existingRow?.tier   || 'free';
  const prevStatus = existingRow?.status || null;

  let rowId = existingRow?.id || null;
  if (!existingRow) {
    const ins = await insertSubscriptionRow(env, {
      owner_id:   ownerId,
      role_scope: targetScope,
      ...patch,
    });
    if (!ins.ok) return { ok: false, error: 'insert_failed' };
    rowId = ins.data?.id || null;
  } else {
    const up = await patchSubscription(env, existingRow.id, patch);
    if (!up.ok) return { ok: false, error: 'patch_failed' };
  }

  // Entitlement events are an owner-only concept (Barn Mode audit).
  // Trainer Pro transitions audit via the main audit_log only.
  if (!isTrainerPro) {
    let evtType = null;
    if (!existingRow && (nextStatus === 'active' || nextStatus === 'trialing')) {
      evtType = 'granted';
    } else if (existingRow) {
      if (prevStatus !== 'cancelled' && nextStatus === 'cancelled')       evtType = 'cancelled';
      else if (prevStatus !== 'past_due' && nextStatus === 'past_due')    evtType = 'grace_started';
      else if (prevStatus === 'past_due' && (nextStatus === 'active' || nextStatus === 'trialing'))
        evtType = 'granted';
      else if (prevTier !== 'barn_mode' && nextStatus === 'active')       evtType = 'granted';
    }
    if (evtType) {
      await insertEntitlementEvent(env, {
        owner_id:        ownerId,
        event:           evtType,
        reason:          `stripe:${eventId || 'webhook'}`,
        source:          'stripe_webhook',
        prev_tier:       prevTier,
        next_tier:       'barn_mode',
        metadata:        { stripe_subscription_id: stripeSub.id, status: nextStatus },
      });
    }
  }

  return { ok: true, mirrored: true, owner_id: ownerId, role_scope: targetScope, status: nextStatus };
}

/**
 * Phase 8 — Barn Mode `checkout.session.completed` handler. Called from the
 * main worker's Stripe webhook router when the session has
 * mode=subscription and metadata.ml_source='barn_mode_subscription'.
 */
export async function handleBarnModeCheckoutCompleted(env, session, eventId) {
  if (session?.mode !== 'subscription') {
    return { ok: true, ignored: true, reason: 'not_subscription_mode' };
  }
  const src = session?.metadata?.ml_source;
  if (src !== 'barn_mode_subscription' && src !== 'trainer_pro_subscription') {
    return { ok: true, ignored: true, reason: 'not_ml_source' };
  }
  const stripeSubId = typeof session.subscription === 'string'
    ? session.subscription
    : (session.subscription?.id || null);
  if (!stripeSubId) return { ok: false, error: 'missing_subscription_id' };

  const sub = await retrieveStripeSubscription(env, stripeSubId);
  if (!sub.ok) return { ok: false, error: 'stripe_sub_fetch_failed' };

  // Carry checkout metadata forward onto the sub if Stripe didn't attach it.
  if (!sub.data.metadata) sub.data.metadata = {};
  if (!sub.data.metadata.ml_source && session.metadata?.ml_source) {
    sub.data.metadata.ml_source = session.metadata.ml_source;
  }
  if (!sub.data.metadata.ml_owner_id && session.metadata?.ml_owner_id) {
    sub.data.metadata.ml_owner_id = session.metadata.ml_owner_id;
  }
  if (!sub.data.metadata.ml_user_id && session.metadata?.ml_user_id) {
    sub.data.metadata.ml_user_id = session.metadata.ml_user_id;
  }

  return mirrorBarnModeSubscriptionFromStripe(env, sub.data, { eventId });
}
