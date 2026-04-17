/**
 * Mane Line — Cloudflare Worker entry point.
 *
 * Thin edge in front of the React SPA in `./app`. Owns these routes:
 *
 *   POST /webhook/sheets          — forwards Supabase DB webhooks to Apps
 *                                   Script so the L1 Google Sheets mirror
 *                                   stays warm. Uses constant-time compare
 *                                   on the shared secret header.
 *   GET  /api/flags               — returns feature flags read from FLAGS KV.
 *   POST /api/has-pin             — [Phase 0 hardening] proxies
 *                                   check_has_pin() via service_role with
 *                                   per-IP rate limiting. Replaces the
 *                                   anon-callable RPC the SPA used to hit
 *                                   directly.
 *   GET  /api/admin/*             — service_role admin endpoints. Every
 *                                   successful read writes an audit_log
 *                                   row. Requires the caller to hold a
 *                                   valid Supabase session AND be a
 *                                   silver_lining admin (status=active).
 *   POST /api/uploads/sign        — [Phase 1] returns a 5-minute presigned
 *                                   R2 PUT URL plus the object_key the
 *                                   browser must send back to /commit.
 *   POST /api/uploads/commit      — [Phase 1] Worker HEADs R2 to confirm
 *                                   the PUT actually landed, then writes
 *                                   r2_objects + the typed row
 *                                   (vet_records or animal_media).
 *   GET  /api/uploads/read-url    — [Phase 1] returns a 5-minute presigned
 *                                   R2 GET URL for an object the caller
 *                                   is authorized to read.
 *   POST /api/animals/archive     — [Phase 1] atomic soft-archive:
 *                                   animals.archived_at = now() plus a
 *                                   row in animal_archive_events. Reason
 *                                   is required (OAG §8).
 *   POST /api/animals/unarchive   — [Phase 1] reverse of the above.
 *   POST /api/records/export-pdf  — [Phase 1] server-side renders a
 *                                   12-month records PDF, stores it in
 *                                   R2 under kind='records_export', and
 *                                   returns a 15-min signed GET URL.
 *   POST /api/access/grant        — [Phase 1] owner grants a trainer
 *                                   access (scope=animal|ranch|owner_all).
 *                                   Looks up the trainer by email (must
 *                                   be approved) and writes
 *                                   animal_access_grants via service_role.
 *   POST /api/access/revoke       — [Phase 1] owner revokes a grant; sets
 *                                   revoked_at + grace_period_ends_at so
 *                                   the trainer keeps read access for N
 *                                   days (default 7, max 30).
 *   GET  /api/_integrations-health — Phase 0 smoke test.
 *   GET  /healthz                 — trivial liveness probe.
 *   GET  /join                    — 301 → /signup (legacy waitlist form
 *                                   retired; SPA has a v1 fallback flag).
 *
 * Every other request is handed to the Workers Assets binding which
 * serves the built SPA from `app/dist`.
 *
 * Env expected:
 *   SUPABASE_URL, SUPABASE_ANON_KEY            (public vars)
 *   SUPABASE_WEBHOOK_SECRET                    (secret)
 *   SUPABASE_SERVICE_ROLE_KEY                  (secret, NEW in 00004)
 *   GOOGLE_APPS_SCRIPT_URL / _SECRET           (secrets)
 *   R2_ACCOUNT_ID                              (secret, Phase 1)
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY    (secrets, Phase 1)
 *   FLAGS                                      (KV namespace binding)
 *   ML_RL                                      (KV — rate-limit buckets)
 *   ASSETS                                     (Workers Assets binding)
 *   MANELINE_R2                                (R2 bucket binding, Phase 1)
 */
import { presignPut, presignGet } from './worker/r2-presign.js';
import { renderRecordsPdf } from './worker/records-export.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/webhook/sheets') {
        return handleSheetsWebhook(request, env);
      }
      if (url.pathname === '/api/flags') {
        return handleFlags(request, env);
      }
      if (url.pathname === '/api/has-pin') {
        return handleHasPin(request, env, ctx);
      }
      if (url.pathname.startsWith('/api/admin/')) {
        return handleAdmin(request, env, url);
      }
      if (url.pathname === '/api/uploads/sign') {
        return handleUploadSign(request, env);
      }
      if (url.pathname === '/api/uploads/commit') {
        return handleUploadCommit(request, env);
      }
      if (url.pathname === '/api/uploads/read-url') {
        return handleUploadReadUrl(request, env, url);
      }
      if (url.pathname === '/api/animals/archive') {
        return handleAnimalArchive(request, env);
      }
      if (url.pathname === '/api/animals/unarchive') {
        return handleAnimalUnarchive(request, env);
      }
      if (url.pathname === '/api/records/export-pdf') {
        return handleRecordsExport(request, env);
      }
      if (url.pathname === '/api/access/grant') {
        return handleAccessGrant(request, env);
      }
      if (url.pathname === '/api/access/revoke') {
        return handleAccessRevoke(request, env);
      }
      if (url.pathname === '/api/_integrations-health') {
        return handleIntegrationsHealth(request, env);
      }
      if (url.pathname === '/healthz') {
        return new Response('ok', {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      if (url.pathname === '/join') {
        // Legacy waitlist retired in Phase 0 hardening. SPA /signup renders
        // the v1 form when feature:signup_v2 = false.
        return Response.redirect(new URL('/signup', url).toString(), 301);
      }

      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: 'Server error', detail: err?.message ?? 'unknown' }, 500);
    }
  },
};

/* =============================================================
   Crypto / request helpers
   ============================================================= */

/**
 * Constant-time string compare. Returns false fast on length mismatch
 * (length is not a secret), then XORs every byte so timing is a
 * function of input length alone, not matching-prefix length.
 */
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * Simple per-key token bucket in KV.
 *
 * Not distributed-exact — KV has eventual consistency across regions —
 * but easily tight enough to defeat scripted enumeration from a single
 * endpoint. Callers that need hard guarantees should layer Cloudflare
 * rate-limiting rules in front.
 *
 * Returns { ok: boolean, remaining: number, resetSec: number }.
 */
async function rateLimit(env, bucketKey, { limit, windowSec }) {
  if (!env.FLAGS) return { ok: true, remaining: limit, resetSec: windowSec };

  const now = Math.floor(Date.now() / 1000);
  const raw = await env.FLAGS.get(bucketKey);
  let state = raw ? safeParse(raw) : null;

  if (!state || typeof state.resetAt !== 'number' || state.resetAt <= now) {
    state = { count: 0, resetAt: now + windowSec };
  }

  state.count += 1;
  const ok = state.count <= limit;

  // TTL so stale buckets self-expire even if the next request never comes.
  const ttl = Math.max(state.resetAt - now + 5, 10);
  await env.FLAGS.put(bucketKey, JSON.stringify(state), { expirationTtl: ttl });

  return {
    ok,
    remaining: Math.max(0, limit - state.count),
    resetSec: Math.max(1, state.resetAt - now),
  };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/* =============================================================
   Supabase REST helpers (used by /api/has-pin and /api/admin/*)
   ============================================================= */

async function supabaseRpc(env, fnName, body, { serviceRole = false, userJwt = null } = {}) {
  if (!env.SUPABASE_URL) throw new Error('SUPABASE_URL missing');
  const key = serviceRole
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : (userJwt ?? env.SUPABASE_ANON_KEY);
  if (!key) throw new Error('Supabase key missing for request');

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function supabaseSelect(env, table, query, { serviceRole = false, userJwt = null } = {}) {
  const key = serviceRole
    ? env.SUPABASE_SERVICE_ROLE_KEY
    : (userJwt ?? env.SUPABASE_ANON_KEY);

  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}`, {
    method: 'GET',
    headers: {
      apikey: serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${key}`,
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function supabaseInsert(env, table, row, { serviceRole = true } = {}) {
  const key = serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY;
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: serviceRole ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(row),
  });
  return { ok: res.ok, status: res.status };
}

/* =============================================================
   /api/has-pin  — replaces the anon-callable check_has_pin() RPC
   -------------------------------------------------------------
   Shape:
     POST /api/has-pin  { "email": "user@example.com" }
     → 200 { "has_pin": true|false }
     → 429 { "error": "rate_limited", "retry_after": <seconds> }
   Rate: 10 req / 60s per IP (see RATE).
   ============================================================= */
const HAS_PIN_RATE = { limit: 10, windowSec: 60 };

async function handleHasPin(request, env /* ctx */) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    // If the service role secret isn't set, we never want to silently
    // fall back to the old anon-callable path.
    return json({ error: 'not_configured' }, 500);
  }

  const ip = clientIp(request);
  const rl = await rateLimit(env, `ratelimit:haspin:${ip}`, HAS_PIN_RATE);
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  // We deliberately do NOT validate email format here. The RPC returns
  // `false` for any input that isn't a real row, which is the same
  // response an enumeration attacker would get for a miss. Returning
  // 400 for malformed input would leak that distinction.
  if (!email) {
    return json({ has_pin: false });
  }

  const { ok, data } = await supabaseRpc(env, 'check_has_pin', { p_email: email }, { serviceRole: true });
  if (!ok) {
    return json({ has_pin: false }, 200);
  }
  // RPC returns a literal boolean.
  return json({ has_pin: data === true });
}

/* =============================================================
   /api/admin/*  — service_role admin surface (B2)
   -------------------------------------------------------------
   Every endpoint:
     1. Verifies the caller's Supabase session JWT.
     2. Confirms user_profiles.role = 'silver_lining' AND status = 'active'.
     3. Performs the privileged read via service_role.
     4. Writes an audit_log row (best-effort — failure does not abort
        the response, but is logged).
   ============================================================= */

async function handleAdmin(request, env, url) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 1. Resolve the caller by asking Supabase who this JWT belongs to.
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!who.ok) {
    return json({ error: 'unauthorized' }, 401);
  }
  const whoData = await who.json().catch(() => null);
  const actorId = whoData?.id;
  if (!actorId) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 2. Confirm silver_lining + active.
  const profileRes = await supabaseSelect(
    env,
    'user_profiles',
    `select=role,status&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
    { serviceRole: true }
  );
  const profile = Array.isArray(profileRes.data) ? profileRes.data[0] : null;
  if (!profile || profile.role !== 'silver_lining' || profile.status !== 'active') {
    return json({ error: 'forbidden' }, 403);
  }

  // 3. Dispatch.
  const tail = url.pathname.slice('/api/admin/'.length);
  let response;
  let action;
  let targetTable = null;

  if (tail === 'ping' && request.method === 'GET') {
    action = 'admin.ping';
    response = json({ ok: true });
  } else if (tail === 'trainer-applications' && request.method === 'GET') {
    action = 'admin.read.trainer_applications';
    targetTable = 'trainer_applications';
    const r = await supabaseSelect(
      env,
      'trainer_applications',
      'select=id,user_id,submitted_at,status,application&order=submitted_at.desc&limit=100',
      { serviceRole: true }
    );
    response = json({ rows: r.ok ? r.data : [] });
  } else if (tail === 'users' && request.method === 'GET') {
    action = 'admin.read.user_profiles';
    targetTable = 'user_profiles';
    const r = await supabaseSelect(
      env,
      'user_profiles',
      'select=user_id,role,status,display_name,email,created_at&order=created_at.desc&limit=200',
      { serviceRole: true }
    );
    response = json({ rows: r.ok ? r.data : [] });
  } else {
    return json({ error: 'not_found' }, 404);
  }

  // 4. Audit (best-effort; don't fail the request if the log write fails).
  try {
    await supabaseInsert(env, 'audit_log', {
      actor_id: actorId,
      actor_role: 'silver_lining',
      action,
      target_table: targetTable,
      ip: clientIp(request),
      user_agent: request.headers.get('user-agent') || null,
    });
  } catch (err) {
    console.warn('[audit] insert failed:', err?.message);
  }

  return response;
}

/* =============================================================
   Feature flags
   ============================================================= */
async function handleFlags(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  let signupV2 = true;
  try {
    if (env.FLAGS) {
      const raw = await env.FLAGS.get('feature:signup_v2');
      if (raw !== null && raw !== undefined) {
        signupV2 = String(raw).trim().toLowerCase() !== 'false';
      }
    }
  } catch (err) {
    console.warn('[flags] KV read failed, defaulting signup_v2=true:', err?.message);
  }

  return new Response(JSON.stringify({ signup_v2: signupV2 }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=30',
    },
  });
}

/* =============================================================
   Supabase -> Google Sheets webhook forwarder (L0 -> L1 mirror)
   ============================================================= */
async function handleSheetsWebhook(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const got = request.headers.get('x-webhook-secret') || '';
  if (!env.SUPABASE_WEBHOOK_SECRET || !timingSafeEqual(got, env.SUPABASE_WEBHOOK_SECRET)) {
    return new Response('unauthorized', { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const record = body.record || {};
  const event = (body.type || 'insert').toLowerCase();

  if (!env.GOOGLE_APPS_SCRIPT_URL) {
    return new Response('apps script url not configured', { status: 500 });
  }

  const res = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      secret: env.GOOGLE_APPS_SCRIPT_SECRET || '',
      event,
      row: {
        id: record.id,
        email: record.email,
        full_name: record.full_name,
        phone: record.phone,
        location: record.location,
        discipline: record.discipline,
        marketing_opt_in: record.marketing_opt_in,
      },
    }),
  });

  const text = await res.text();
  return new Response(text, { status: res.ok ? 200 : 502 });
}

/* =============================================================
   /api/_integrations-health — Phase 0 smoke test
   ============================================================= */
async function handleIntegrationsHealth(request, env) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }

  const PUBLIC_ENV_KEYS = ['SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  const SECRET_KEYS = [
    'SUPABASE_WEBHOOK_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GOOGLE_APPS_SCRIPT_URL',
    'GOOGLE_APPS_SCRIPT_SECRET',
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'SHOPIFY_STORE_DOMAIN',
    'SHOPIFY_STOREFRONT_TOKEN',
    'SHOPIFY_ADMIN_API_TOKEN',
    'HUBSPOT_PRIVATE_APP_TOKEN',
    'HUBSPOT_PORTAL_ID',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];

  const publicEnv = {};
  for (const k of PUBLIC_ENV_KEYS) {
    publicEnv[k] = typeof env[k] === 'string' && env[k].length > 0;
  }
  const secretsPresent = {};
  for (const k of SECRET_KEYS) {
    secretsPresent[k] = typeof env[k] === 'string' && env[k].length > 0;
  }

  // R2 status is 'live' when the binding exists AND all three S3-compat
  // secrets are populated. Presign-only paths would technically work
  // without the binding, but /api/uploads/commit does a binding-side HEAD,
  // so we require both halves to call it live.
  const r2BindingPresent = Boolean(env.MANELINE_R2);
  const r2CredsPresent =
    secretsPresent.R2_ACCOUNT_ID &&
    secretsPresent.R2_ACCESS_KEY_ID &&
    secretsPresent.R2_SECRET_ACCESS_KEY;
  const r2 = r2BindingPresent && r2CredsPresent ? 'live' : 'mock';

  const body = {
    shopify:    'mock',
    hubspot:    'mock',
    workersAi:  'mock',
    stripe:     'mock',
    r2,
    bindings: {
      FLAGS:               Boolean(env.FLAGS),
      ML_RL:               Boolean(env.ML_RL),
      ASSETS:              Boolean(env.ASSETS),
      AI:                  Boolean(env.AI),
      VECTORIZE_PROTOCOLS: Boolean(env.VECTORIZE_PROTOCOLS),
      MANELINE_R2:         r2BindingPresent,
    },
    env: publicEnv,
    secrets_present: secretsPresent,
    generated_at: new Date().toISOString(),
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

/* =============================================================
   Phase 1 — R2 uploads
   -------------------------------------------------------------
   Three endpoints, all authenticated via Supabase JWT:

     POST /api/uploads/sign       — browser gets a presigned PUT URL
     POST /api/uploads/commit     — Worker verifies PUT + writes rows
     GET  /api/uploads/read-url   — browser gets a presigned GET URL

   The signed PUT URL is bound to the caller's user id via the
   object_key convention (<user_id>/<kind>/<uuid>.<ext>); commit
   re-checks ownership before inserting r2_objects and the typed row.
   ============================================================= */

const UPLOAD_SIGN_RATE       = { limit: 20, windowSec: 60 };
const UPLOAD_READ_URL_RATE   = { limit: 60, windowSec: 60 };

// Allowed content types per upload kind. We intentionally whitelist —
// no "/*" wildcards — to keep the bucket boring and predictable.
const ALLOWED_CONTENT_TYPES = {
  vet_record: {
    'application/pdf':  'pdf',
    'image/jpeg':       'jpg',
    'image/png':        'png',
    'image/heic':       'heic',
    'image/webp':       'webp',
  },
  animal_photo: {
    'image/jpeg': 'jpg',
    'image/png':  'png',
    'image/heic': 'heic',
    'image/webp': 'webp',
  },
  animal_video: {
    'video/mp4':        'mp4',
    'video/quicktime':  'mov',
  },
};

// Max bytes we'll presign for. Hard cap here and at commit time so a
// leaked signed URL can't be used to dump a 2 GB file into the bucket.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Resolve the Supabase JWT on the request to a user id. Returns
 * { actorId, jwt } on success; throws a `Response` on any failure so
 * the caller can `return err` directly.
 */
async function requireOwner(request, env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    throw json({ error: 'not_configured' }, 500);
  }
  const authHeader = request.headers.get('authorization') || '';
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!jwt) {
    throw json({ error: 'unauthorized' }, 401);
  }

  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${jwt}`,
    },
  });
  if (!who.ok) {
    throw json({ error: 'unauthorized' }, 401);
  }
  const whoData = await who.json().catch(() => null);
  const actorId = whoData?.id;
  if (!actorId) {
    throw json({ error: 'unauthorized' }, 401);
  }
  return { actorId, jwt };
}

/**
 * KV-bound rate limit (mirror of the older rateLimit() helper, but
 * keyed off whichever KV binding the caller passes — we use ML_RL for
 * upload paths so the bucket doesn't contend with feature-flag reads).
 */
async function rateLimitKv(kv, bucketKey, { limit, windowSec }) {
  if (!kv) return { ok: true, remaining: limit, resetSec: windowSec };

  const now = Math.floor(Date.now() / 1000);
  const raw = await kv.get(bucketKey);
  let state = raw ? safeParse(raw) : null;

  if (!state || typeof state.resetAt !== 'number' || state.resetAt <= now) {
    state = { count: 0, resetAt: now + windowSec };
  }
  state.count += 1;
  const ok = state.count <= limit;

  const ttl = Math.max(state.resetAt - now + 5, 10);
  await kv.put(bucketKey, JSON.stringify(state), { expirationTtl: ttl });

  return {
    ok,
    remaining: Math.max(0, limit - state.count),
    resetSec: Math.max(1, state.resetAt - now),
  };
}

function uuidv4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // Fallback — Workers runtime has randomUUID, but keep this safe.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map((x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}

/**
 * Thin Worker-side ownership check. Calls am_i_owner_of(animal_id) via
 * RPC with the CALLER's JWT so RLS and the function's own security
 * barrier do the work for us. Returns true/false; throws `Response` on
 * auth failure so callers can bail cleanly.
 */
async function assertCallerOwnsAnimal(env, userJwt, animalId) {
  const r = await supabaseRpc(
    env,
    'am_i_owner_of',
    { animal_id: animalId },
    { userJwt }
  );
  if (!r.ok) {
    throw json({ error: 'ownership_check_failed' }, 500);
  }
  return r.data === true;
}

/**
 * POST /api/uploads/sign
 *   Body: { kind, content_type, byte_size_estimate, animal_id? }
 *   Resp: { put_url, object_key, expires_in }
 */
async function handleUploadSign(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return json({ error: 'r2_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const kind        = String(body?.kind || '');
  const contentType = String(body?.content_type || '').toLowerCase();
  const byteEstimate = Number(body?.byte_size_estimate || 0);
  const animalId    = body?.animal_id ? String(body.animal_id) : null;

  const kindTypes = ALLOWED_CONTENT_TYPES[kind];
  if (!kindTypes) {
    return json({ error: 'bad_kind', detail: 'kind must be vet_record, animal_photo, or animal_video' }, 400);
  }
  const ext = kindTypes[contentType];
  if (!ext) {
    return json({ error: 'bad_content_type', detail: `content_type ${contentType} not allowed for kind ${kind}` }, 415);
  }
  if (!Number.isFinite(byteEstimate) || byteEstimate <= 0 || byteEstimate > MAX_UPLOAD_BYTES) {
    return json({ error: 'bad_byte_size', detail: `byte_size_estimate must be 1..${MAX_UPLOAD_BYTES}` }, 413);
  }

  // Records uploads must always attach to an animal the caller owns;
  // /sign rejects early so we don't waste a signature on an orphan object.
  if (animalId) {
    const ownsIt = await assertCallerOwnsAnimal(env, jwt, animalId);
    if (!ownsIt) {
      return json({ error: 'forbidden', detail: 'not the owner of that animal' }, 403);
    }
  } else if (kind !== 'records_export') {
    return json({ error: 'bad_request', detail: 'animal_id required for this kind' }, 400);
  }

  const rl = await rateLimitKv(env.ML_RL, `ratelimit:upload_sign:${actorId}`, UPLOAD_SIGN_RATE);
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  const objectId  = uuidv4();
  const objectKey = `${actorId}/${kind}/${objectId}.${ext}`;

  let putUrl;
  try {
    putUrl = await presignPut({
      bucket: 'maneline-records',
      key: objectKey,
      contentType,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretKey: env.R2_SECRET_ACCESS_KEY,
      expiresSec: 300,
    });
  } catch (err) {
    return json({ error: 'presign_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  // Audit-log the signing intent. If the browser never follows through
  // with a PUT, r2_objects stays empty — this row is how we reconcile.
  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'upload.sign',
    target_table: 'r2_objects',
    target_id: null,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { kind, object_key: objectKey, animal_id: animalId, content_type: contentType },
  });

  return json({ put_url: putUrl, object_key: objectKey, expires_in: 300 });
}

/**
 * POST /api/uploads/commit
 *   Body: { object_key, kind, animal_id?, record_type?, issued_on?,
 *           expires_on?, issuing_provider?, caption?, taken_on? }
 *   Resp: { id, r2_object_id }
 *
 * The Worker HEADs the object via the R2 binding (not via the signed
 * URL — we trust the binding and it doesn't need SigV4). If present,
 * we write r2_objects + the typed row in two service_role inserts.
 */
async function handleUploadCommit(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.MANELINE_R2) {
    return json({ error: 'r2_not_configured' }, 500);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const objectKey = String(body?.object_key || '');
  const kind      = String(body?.kind || '');
  const animalId  = body?.animal_id ? String(body.animal_id) : null;

  if (!objectKey || !ALLOWED_CONTENT_TYPES[kind]) {
    return json({ error: 'bad_request' }, 400);
  }
  // object_key is <actorId>/<kind>/<uuid>.<ext> — enforce the actor prefix
  // so a caller can't commit someone else's upload.
  if (!objectKey.startsWith(`${actorId}/${kind}/`)) {
    return json({ error: 'forbidden', detail: 'object_key does not belong to caller' }, 403);
  }

  if (animalId) {
    const ownsIt = await assertCallerOwnsAnimal(env, jwt, animalId);
    if (!ownsIt) return json({ error: 'forbidden' }, 403);
  } else if (kind !== 'records_export') {
    return json({ error: 'bad_request', detail: 'animal_id required' }, 400);
  }

  // HEAD via binding — confirms the PUT succeeded and gives us the real
  // byte_size + content_type (don't trust the browser's self-report).
  const head = await env.MANELINE_R2.head(objectKey);
  if (!head) {
    return json({ error: 'not_uploaded', detail: 'object not in R2; PUT first' }, 409);
  }
  if (head.size > MAX_UPLOAD_BYTES) {
    // Belt-and-suspenders — presign already caps, but if an attacker
    // finds a way to upload more, we still refuse to record it.
    await env.MANELINE_R2.delete(objectKey).catch(() => {});
    return json({ error: 'too_large' }, 413);
  }
  const contentType = head.httpMetadata?.contentType || 'application/octet-stream';

  // 1. Insert r2_objects (service_role — clients are revoked INSERT).
  const r2Insert = await supabaseInsertReturning(env, 'r2_objects', {
    owner_id:     actorId,
    bucket:       'maneline-records',
    object_key:   objectKey,
    kind,
    content_type: contentType,
    byte_size:    head.size,
  });
  if (!r2Insert.ok || !r2Insert.data?.id) {
    return json({ error: 'db_write_failed', detail: r2Insert.data || 'r2_objects insert' }, 500);
  }
  const r2ObjectId = r2Insert.data.id;

  // 2. Insert the typed row.
  let typedInsert = { ok: true, data: null };
  if (kind === 'vet_record') {
    const recordType = String(body?.record_type || '');
    const allowed = ['coggins', 'vaccine', 'dental', 'farrier', 'other'];
    if (!allowed.includes(recordType)) {
      // Rollback r2_objects so we don't leave orphans.
      await supabaseDelete(env, 'r2_objects', `id=eq.${r2ObjectId}`);
      await env.MANELINE_R2.delete(objectKey).catch(() => {});
      return json({ error: 'bad_record_type' }, 400);
    }
    typedInsert = await supabaseInsertReturning(env, 'vet_records', {
      owner_id:         actorId,
      animal_id:        animalId,
      r2_object_id:     r2ObjectId,
      record_type:      recordType,
      issued_on:        body?.issued_on || null,
      expires_on:       body?.expires_on || null,
      issuing_provider: body?.issuing_provider || null,
      notes:            body?.notes || null,
    });
  } else if (kind === 'animal_photo' || kind === 'animal_video') {
    typedInsert = await supabaseInsertReturning(env, 'animal_media', {
      owner_id:     actorId,
      animal_id:    animalId,
      r2_object_id: r2ObjectId,
      kind:         kind === 'animal_photo' ? 'photo' : 'video',
      caption:      body?.caption || null,
      taken_on:     body?.taken_on || null,
    });
  }

  if (!typedInsert.ok || !typedInsert.data?.id) {
    await supabaseDelete(env, 'r2_objects', `id=eq.${r2ObjectId}`);
    await env.MANELINE_R2.delete(objectKey).catch(() => {});
    return json({ error: 'db_write_failed', detail: typedInsert.data || 'typed insert' }, 500);
  }

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: 'owner',
    action: 'records.upload',
    target_table: kind === 'vet_record' ? 'vet_records' : 'animal_media',
    target_id: typedInsert.data.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { r2_object_id: r2ObjectId, object_key: objectKey, kind },
  });

  return json({ id: typedInsert.data.id, r2_object_id: r2ObjectId });
}

/**
 * GET /api/uploads/read-url?object_key=<url-encoded>
 *   Resp: { get_url, expires_in }
 */
async function handleUploadReadUrl(request, env, url) {
  if (request.method !== 'GET') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return json({ error: 'r2_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (errResp) {
    return errResp;
  }

  const objectKey = url.searchParams.get('object_key') || '';
  if (!objectKey) {
    return json({ error: 'bad_request', detail: 'object_key required' }, 400);
  }

  const rl = await rateLimitKv(env.ML_RL, `ratelimit:read_url:${actorId}`, UPLOAD_READ_URL_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, { 'retry-after': String(rl.resetSec) });
  }

  // Resolve the r2_objects row (service_role — lets us reach both
  // owner-owned and trainer-accessible objects in one query).
  const r = await supabaseSelect(
    env,
    'r2_objects',
    `select=id,owner_id,kind,bucket,object_key&object_key=eq.${encodeURIComponent(objectKey)}&limit=1`,
    { serviceRole: true }
  );
  const row = Array.isArray(r.data) ? r.data[0] : null;
  if (!row) {
    return json({ error: 'not_found' }, 404);
  }

  // Access check. Owners pass trivially. Trainers must hold an active
  // grant on the linked animal — we look up the animal via the typed
  // table and call do_i_have_access_to_animal() with the caller's JWT.
  let allowed = row.owner_id === actorId;
  if (!allowed) {
    let animalId = null;
    if (row.kind === 'vet_record') {
      const vr = await supabaseSelect(
        env,
        'vet_records',
        `select=animal_id&r2_object_id=eq.${row.id}&limit=1`,
        { serviceRole: true }
      );
      animalId = Array.isArray(vr.data) ? vr.data[0]?.animal_id : null;
    } else if (row.kind === 'animal_photo' || row.kind === 'animal_video') {
      const am = await supabaseSelect(
        env,
        'animal_media',
        `select=animal_id&r2_object_id=eq.${row.id}&limit=1`,
        { serviceRole: true }
      );
      animalId = Array.isArray(am.data) ? am.data[0]?.animal_id : null;
    }
    if (animalId) {
      const ok = await supabaseRpc(
        env,
        'do_i_have_access_to_animal',
        { animal_id: animalId },
        { userJwt: jwt }
      );
      allowed = ok.ok && ok.data === true;
    }
  }
  if (!allowed) {
    return json({ error: 'forbidden' }, 403);
  }

  let getUrl;
  try {
    getUrl = await presignGet({
      bucket: row.bucket,
      key: row.object_key,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretKey: env.R2_SECRET_ACCESS_KEY,
      expiresSec: 300,
    });
  } catch (err) {
    return json({ error: 'presign_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  ctx_audit(env, {
    actor_id: actorId,
    actor_role: row.owner_id === actorId ? 'owner' : 'trainer',
    action: 'records.read_url',
    target_table: 'r2_objects',
    target_id: row.id,
    ip: clientIp(request),
    user_agent: request.headers.get('user-agent') || null,
    metadata: { object_key: row.object_key, kind: row.kind },
  });

  return json({ get_url: getUrl, expires_in: 300 });
}

/* =============================================================
   Supabase helpers — returning inserts + delete + audit
   (The basic select/insert/rpc variants are defined earlier.)
   ============================================================= */

async function supabaseInsertReturning(env, table, row) {
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

async function supabaseDelete(env, table, filterQuery) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  return { ok: res.ok, status: res.status };
}

/**
 * Fire-and-forget audit_log insert. Does not block the response path —
 * failures are logged but never surface to the client.
 */
function ctx_audit(env, row) {
  supabaseInsert(env, 'audit_log', row).catch((err) =>
    console.warn('[audit] insert failed:', err?.message)
  );
}

async function supabaseUpdateReturning(env, table, filterQuery, patch) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filterQuery}`, {
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

/* =============================================================
   /api/animals/archive   and   /api/animals/unarchive
   -------------------------------------------------------------
   Atomic archive toggle + audit event, so animals.archived_at
   and animal_archive_events never diverge. OAG §8.

   Flow:
     1. requireOwner — caller must hold a valid Supabase JWT.
     2. assertCallerOwnsAnimal — RPC check (am_i_owner_of) so
        trainers/other owners can't toggle archive state.
     3. service_role UPDATE animals.archived_at (= now() | null).
     4. service_role INSERT animal_archive_events row.
     5. audit_log fire-and-forget.
   ============================================================= */
const ARCHIVE_RATE = { limit: 10, windowSec: 60 };

async function handleAnimalArchive(request, env) {
  return handleAnimalArchiveToggle(request, env, 'archive');
}

async function handleAnimalUnarchive(request, env) {
  return handleAnimalArchiveToggle(request, env, 'unarchive');
}

async function handleAnimalArchiveToggle(request, env, action) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimitKv(
    env.ML_RL,
    `ratelimit:animal_archive:${actorId}`,
    ARCHIVE_RATE
  );
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const animalId = typeof body?.animal_id === 'string' ? body.animal_id : '';
  const reasonRaw = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!animalId) {
    return json({ error: 'animal_id required' }, 400);
  }
  if (action === 'archive' && reasonRaw.length === 0) {
    // Required so the audit trail is worth reading a year from now.
    return json({ error: 'reason_required' }, 400);
  }

  let ownsIt;
  try {
    ownsIt = await assertCallerOwnsAnimal(env, jwt, animalId);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }
  if (!ownsIt) {
    return json({ error: 'forbidden' }, 403);
  }

  const patch =
    action === 'archive'
      ? { archived_at: new Date().toISOString() }
      : { archived_at: null };

  const upd = await supabaseUpdateReturning(
    env,
    'animals',
    `id=eq.${encodeURIComponent(animalId)}`,
    patch
  );
  if (!upd.ok || !upd.data) {
    return json({ error: 'animal_update_failed', status: upd.status }, 500);
  }

  const evt = await supabaseInsertReturning(env, 'animal_archive_events', {
    animal_id: animalId,
    actor_id:  actorId,
    action,
    reason:    action === 'archive' ? reasonRaw : null,
  });
  if (!evt.ok) {
    // The timestamp UPDATE already succeeded. We still return the fresh
    // animal — audit coverage is a soft failure that will show up in
    // logs, and the animals table remains the source of truth.
    console.warn('[archive] audit event insert failed', { status: evt.status });
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       action === 'archive' ? 'animal.archive' : 'animal.unarchive',
    target_table: 'animals',
    target_id:    animalId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     action === 'archive' ? { reason: reasonRaw } : {},
  });

  return json({ animal: upd.data });
}

/* =============================================================
   /api/records/export-pdf
   -------------------------------------------------------------
   Renders a single-animal, N-day records PDF server-side, uploads
   it to R2 under kind='records_export', returns a 15-minute signed
   GET URL so the owner can download + send.

   Body: { animal_id, window_days: 30 | 90 | 365 }

   Rate: 5 req / 5 min per caller — PDF render is not cheap.
   ============================================================= */
const RECORDS_EXPORT_RATE = { limit: 5, windowSec: 300 };
const RECORDS_EXPORT_ALLOWED_WINDOWS = new Set([30, 90, 365]);

async function handleRecordsExport(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.MANELINE_R2 || !env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return json({ error: 'r2_not_configured' }, 500);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'supabase_not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimitKv(
    env.ML_RL,
    `ratelimit:records_export:${actorId}`,
    RECORDS_EXPORT_RATE
  );
  if (!rl.ok) {
    return json(
      { error: 'rate_limited', retry_after: rl.resetSec },
      429,
      { 'retry-after': String(rl.resetSec) }
    );
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }
  const animalId = typeof body?.animal_id === 'string' ? body.animal_id : '';
  const windowDays = Number(body?.window_days ?? 365);
  if (!animalId) return json({ error: 'animal_id required' }, 400);
  if (!RECORDS_EXPORT_ALLOWED_WINDOWS.has(windowDays)) {
    return json({ error: 'bad_window_days', allowed: [30, 90, 365] }, 400);
  }

  try {
    const ok = await assertCallerOwnsAnimal(env, jwt, animalId);
    if (!ok) return json({ error: 'forbidden' }, 403);
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  // ---- Gather source rows via service_role ----
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceIso = since.toISOString();

  const [animalR, ownerR, vetR, r2R, mediaCountR] = await Promise.all([
    supabaseSelect(
      env,
      'animals',
      `select=id,barn_name,species,breed,year_born,discipline,owner_id&id=eq.${encodeURIComponent(animalId)}&limit=1`,
      { serviceRole: true }
    ),
    // We use the animals row's owner_id to look up display_name.
    // Parallelizing means we don't wait for the animal lookup first —
    // the owner lookup runs speculatively against the caller's id and
    // turns out to be the same row (owner uploading their own).
    supabaseSelect(
      env,
      'user_profiles',
      `select=display_name&user_id=eq.${encodeURIComponent(actorId)}&limit=1`,
      { serviceRole: true }
    ),
    supabaseSelect(
      env,
      'vet_records',
      `select=id,record_type,issued_on,expires_on,issuing_provider,notes,created_at,r2_object_id` +
        `&animal_id=eq.${encodeURIComponent(animalId)}&archived_at=is.null&created_at=gte.${encodeURIComponent(sinceIso)}` +
        `&order=issued_on.desc.nullslast,created_at.desc`,
      { serviceRole: true }
    ),
    // We'll resolve filenames via a follow-up query once we know the ids.
    Promise.resolve(null),
    supabaseSelect(
      env,
      'animal_media',
      `select=id&animal_id=eq.${encodeURIComponent(animalId)}&archived_at=is.null`,
      { serviceRole: true }
    ),
  ]);

  const animal = Array.isArray(animalR.data) ? animalR.data[0] : null;
  if (!animal) return json({ error: 'animal_not_found' }, 404);
  const ownerName = Array.isArray(ownerR.data) ? ownerR.data[0]?.display_name : null;
  const vetRows = Array.isArray(vetR.data) ? vetR.data : [];
  const mediaCount = Array.isArray(mediaCountR.data) ? mediaCountR.data.length : 0;

  // Resolve object_key → filename ("coggins-2026-04-02.pdf"-style) for
  // each vet record. We only print the basename — the file itself is
  // never embedded, so this is just a pointer for the vet/buyer.
  let fileNameByObjectId = new Map();
  if (vetRows.length > 0) {
    const ids = Array.from(new Set(vetRows.map((r) => r.r2_object_id)));
    const r2 = await supabaseSelect(
      env,
      'r2_objects',
      `select=id,object_key&id=in.(${ids.map((x) => encodeURIComponent(x)).join(',')})`,
      { serviceRole: true }
    );
    for (const row of r2.data || []) {
      const key = row.object_key || '';
      const base = key.split('/').pop() || key;
      fileNameByObjectId.set(row.id, base);
    }
  }
  const vetRecords = vetRows.map((r) => ({
    ...r,
    filename: fileNameByObjectId.get(r.r2_object_id) || null,
  }));
  // Void the placeholder to keep lint happy.
  void r2R;

  // ---- Render PDF ----
  let pdfBytes;
  try {
    pdfBytes = renderRecordsPdf({
      animal,
      ownerName,
      windowDays,
      vetRecords,
      mediaCount,
    });
  } catch (err) {
    return json({ error: 'render_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  // ---- Upload to R2 ----
  const objectId  = uuidv4();
  const objectKey = `${actorId}/records_export/${objectId}.pdf`;
  try {
    await env.MANELINE_R2.put(objectKey, pdfBytes, {
      httpMetadata: { contentType: 'application/pdf' },
    });
  } catch (err) {
    return json({ error: 'r2_put_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  const r2Insert = await supabaseInsertReturning(env, 'r2_objects', {
    owner_id:     actorId,
    bucket:       'maneline-records',
    object_key:   objectKey,
    kind:         'records_export',
    content_type: 'application/pdf',
    byte_size:    pdfBytes.length,
  });
  if (!r2Insert.ok) {
    await env.MANELINE_R2.delete(objectKey).catch(() => {});
    return json({ error: 'db_write_failed' }, 500);
  }

  // 15-minute signed GET so the owner has time to download + forward.
  let getUrl;
  try {
    getUrl = await presignGet({
      bucket: 'maneline-records',
      key: objectKey,
      accountId: env.R2_ACCOUNT_ID,
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretKey: env.R2_SECRET_ACCESS_KEY,
      expiresSec: 900,
    });
  } catch (err) {
    return json({ error: 'presign_failed', detail: err?.message ?? 'unknown' }, 500);
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'records.export',
    target_table: 'animals',
    target_id:    animalId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     { window_days: windowDays, object_key: objectKey, vet_count: vetRecords.length },
  });

  return json({
    object_key:  objectKey,
    get_url:     getUrl,
    expires_in:  900,
    record_count: vetRecords.length,
  });
}

/* =============================================================
   /api/access/grant   and   /api/access/revoke
   -------------------------------------------------------------
   Owners choose who sees their animals (§2.2 of the feature
   map). Grants are scoped to a single animal, a whole ranch, or
   every animal the owner has. Revocation is soft — revoked_at +
   grace_period_ends_at keep the trainer's read access alive
   through a countdown visible in the UI.

   Both endpoints audit under action='access.grant' /
   'access.revoke' with the grant id + scope.
   ============================================================= */
const ACCESS_RATE = { limit: 10, windowSec: 60 };
const ACCESS_SCOPES = new Set(['animal', 'ranch', 'owner_all']);
const GRACE_DAYS_DEFAULT = 7;
const GRACE_DAYS_MAX = 30;

async function handleAccessGrant(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId, jwt;
  try {
    ({ actorId, jwt } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimitKv(env.ML_RL, `ratelimit:access_grant:${actorId}`, ACCESS_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const trainerEmail = typeof body?.trainer_email === 'string'
    ? body.trainer_email.trim().toLowerCase()
    : '';
  const scope = typeof body?.scope === 'string' ? body.scope : '';
  const animalId = typeof body?.animal_id === 'string' && body.animal_id ? body.animal_id : null;
  const ranchId  = typeof body?.ranch_id  === 'string' && body.ranch_id  ? body.ranch_id  : null;
  const notes    = typeof body?.notes     === 'string' ? body.notes.trim() : null;

  if (!trainerEmail)      return json({ error: 'trainer_email required' }, 400);
  if (!ACCESS_SCOPES.has(scope)) return json({ error: 'bad_scope', allowed: [...ACCESS_SCOPES] }, 400);
  if (scope === 'animal' && !animalId) return json({ error: 'animal_id required for scope=animal' }, 400);
  if (scope === 'ranch'  && !ranchId)  return json({ error: 'ranch_id required for scope=ranch' }, 400);

  if (scope === 'animal') {
    let ok;
    try {
      ok = await assertCallerOwnsAnimal(env, jwt, animalId);
    } catch (resp) {
      if (resp instanceof Response) return resp;
      throw resp;
    }
    if (!ok) return json({ error: 'forbidden' }, 403);
  } else if (scope === 'ranch') {
    const r = await supabaseSelect(
      env,
      'ranches',
      `select=id&id=eq.${encodeURIComponent(ranchId)}&owner_id=eq.${encodeURIComponent(actorId)}&limit=1`,
      { serviceRole: true }
    );
    if (!r.ok) return json({ error: 'ranch_check_failed' }, 500);
    if (!Array.isArray(r.data) || r.data.length === 0) return json({ error: 'forbidden' }, 403);
  }

  // Resolve the trainer by email. Must exist in user_profiles as an
  // active trainer AND have an approved trainer_profiles row.
  const userLookup = await supabaseSelect(
    env,
    'user_profiles',
    `select=user_id,role,status,display_name&email=eq.${encodeURIComponent(trainerEmail)}&limit=1`,
    { serviceRole: true }
  );
  if (!userLookup.ok) return json({ error: 'trainer_lookup_failed' }, 500);
  const profile = Array.isArray(userLookup.data) ? userLookup.data[0] : null;
  if (!profile || profile.role !== 'trainer' || profile.status !== 'active') {
    return json({ error: 'trainer_not_found' }, 404);
  }

  const tpLookup = await supabaseSelect(
    env,
    'trainer_profiles',
    `select=application_status&user_id=eq.${encodeURIComponent(profile.user_id)}&limit=1`,
    { serviceRole: true }
  );
  if (!tpLookup.ok) return json({ error: 'trainer_lookup_failed' }, 500);
  const tp = Array.isArray(tpLookup.data) ? tpLookup.data[0] : null;
  if (!tp || tp.application_status !== 'approved') {
    return json({ error: 'trainer_not_approved' }, 404);
  }

  const insert = await supabaseInsertReturning(env, 'animal_access_grants', {
    owner_id:   actorId,
    trainer_id: profile.user_id,
    scope,
    animal_id:  scope === 'animal' ? animalId : null,
    ranch_id:   scope === 'ranch'  ? ranchId  : null,
    notes:      notes || null,
  });
  if (!insert.ok || !insert.data) {
    return json({ error: 'grant_insert_failed', status: insert.status }, 500);
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'access.grant',
    target_table: 'animal_access_grants',
    target_id:    insert.data.id,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     {
      scope,
      trainer_id: profile.user_id,
      trainer_email: trainerEmail,
      animal_id: animalId,
      ranch_id:  ranchId,
    },
  });

  // TECH_DEBT(phase-2): wire the Gmail relay here. Until the
  // integration is live, the audit row above is the notification
  // trail; the trainer will see the grant appear in their dashboard
  // on next sign-in.

  return json({
    grant: insert.data,
    trainer: {
      user_id: profile.user_id,
      display_name: profile.display_name,
      email: trainerEmail,
    },
  });
}

async function handleAccessRevoke(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'not_configured' }, 500);
  }

  let actorId;
  try {
    ({ actorId } = await requireOwner(request, env));
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  const rl = await rateLimitKv(env.ML_RL, `ratelimit:access_revoke:${actorId}`, ACCESS_RATE);
  if (!rl.ok) {
    return json({ error: 'rate_limited', retry_after: rl.resetSec }, 429, {
      'retry-after': String(rl.resetSec),
    });
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_request' }, 400); }

  const grantId = typeof body?.grant_id === 'string' ? body.grant_id : '';
  if (!grantId) return json({ error: 'grant_id required' }, 400);

  let graceDays = Number(body?.grace_days ?? GRACE_DAYS_DEFAULT);
  if (!Number.isFinite(graceDays) || graceDays < 0) graceDays = GRACE_DAYS_DEFAULT;
  if (graceDays > GRACE_DAYS_MAX) graceDays = GRACE_DAYS_MAX;

  // Confirm the grant belongs to the caller. We scope the PATCH by
  // owner_id below too so a wrong id can never flip someone else's
  // grant — the pre-read just lets us return a clean 404.
  const precheck = await supabaseSelect(
    env,
    'animal_access_grants',
    `select=id,owner_id,trainer_id,scope&id=eq.${encodeURIComponent(grantId)}&limit=1`,
    { serviceRole: true }
  );
  if (!precheck.ok) return json({ error: 'grant_lookup_failed' }, 500);
  const existing = Array.isArray(precheck.data) ? precheck.data[0] : null;
  if (!existing) return json({ error: 'not_found' }, 404);
  if (existing.owner_id !== actorId) return json({ error: 'forbidden' }, 403);

  const now = new Date();
  const graceEnds = new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000);
  const patch = {
    revoked_at: now.toISOString(),
    grace_period_ends_at: graceEnds.toISOString(),
  };

  const upd = await supabaseUpdateReturning(
    env,
    'animal_access_grants',
    `id=eq.${encodeURIComponent(grantId)}&owner_id=eq.${encodeURIComponent(actorId)}`,
    patch
  );
  if (!upd.ok || !upd.data) {
    return json({ error: 'grant_update_failed', status: upd.status }, 500);
  }

  ctx_audit(env, {
    actor_id:     actorId,
    actor_role:   'owner',
    action:       'access.revoke',
    target_table: 'animal_access_grants',
    target_id:    grantId,
    ip:           clientIp(request),
    user_agent:   request.headers.get('user-agent') || null,
    metadata:     {
      scope:      existing.scope,
      trainer_id: existing.trainer_id,
      grace_days: graceDays,
    },
  });

  return json({ grant: upd.data });
}

