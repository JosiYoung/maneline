/**
 * Mane Line — Phase 8 Barn Mode helpers.
 *
 * Keeps the Worker entry point lean. All functions here are
 * service-role callers; `env` must carry SUPABASE_URL and
 * SUPABASE_SERVICE_ROLE_KEY.
 */

const RESTB = (env) => `${env.SUPABASE_URL}/rest/v1`;
const SR = (env) => ({
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
});

/**
 * 32-byte base64url token. Used for `barn_event_attendees.public_token`.
 * Safe for URL path segments; no padding.
 */
export function generatePublicToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  let bin = '';
  for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Token expires at min(event.start_at + 72h, now() + 30d).
 * `startAt` is an ISO string or Date.
 */
export function deriveTokenExpiry(startAt) {
  const start = startAt instanceof Date ? startAt : new Date(startAt);
  const afterEvent = new Date(start.getTime() + 72 * 3600 * 1000);
  const thirtyDays = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  return (afterEvent < thirtyDays ? afterEvent : thirtyDays).toISOString();
}

export function isEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}
export function isE164(s) {
  return typeof s === 'string' && /^\+[1-9][0-9]{6,14}$/.test(s);
}
export function isHexColor(s) {
  return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);
}
export function isUuid(s) {
  return typeof s === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Looks up a registered Maneline user by email (service-role). Returns
 * `{ userId, role, status }` or null.
 */
export async function lookupUserByEmail(env, email) {
  if (!isEmail(email)) return null;
  const q = `select=user_id,role,status&email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`;
  const res = await fetch(`${RESTB(env)}/user_profiles?${q}`, { headers: SR(env) });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const r = rows[0];
  return { userId: r.user_id, role: r.role, status: r.status };
}

/**
 * Reads a professional_contacts row as owner. Returns the row or null.
 */
export async function getProContact(env, ownerId, contactId) {
  const q = `select=*&id=eq.${contactId}&owner_id=eq.${ownerId}&limit=1`;
  const res = await fetch(`${RESTB(env)}/professional_contacts?${q}`, { headers: SR(env) });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => null);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

/**
 * Insert helper with `return=representation`.
 */
export async function srInsertReturning(env, table, row) {
  const res = await fetch(`${RESTB(env)}/${table}`, {
    method: 'POST',
    headers: {
      ...SR(env),
      'content-type': 'application/json',
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

export async function srInsertMany(env, table, rows) {
  if (!rows.length) return { ok: true, status: 200, data: [] };
  const res = await fetch(`${RESTB(env)}/${table}`, {
    method: 'POST',
    headers: {
      ...SR(env),
      'content-type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(rows),
  });
  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { ok: res.ok, status: res.status, data: Array.isArray(parsed) ? parsed : [] };
}

export async function srSelect(env, table, query) {
  const res = await fetch(`${RESTB(env)}/${table}?${query}`, { headers: SR(env) });
  if (!res.ok) return { ok: false, status: res.status, data: null };
  const data = await res.json().catch(() => null);
  return { ok: true, status: res.status, data };
}

export async function srPatchReturning(env, table, filterQuery, patch) {
  const res = await fetch(`${RESTB(env)}/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: {
      ...SR(env),
      'content-type': 'application/json',
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

/**
 * Archive (soft-delete) via `archived_at = now()`. Returns the updated row.
 */
export async function srArchive(env, table, id, ownerIdFilter) {
  const filter = ownerIdFilter
    ? `id=eq.${id}&owner_id=eq.${ownerIdFilter}`
    : `id=eq.${id}`;
  return srPatchReturning(env, table, filter, { archived_at: new Date().toISOString() });
}

/**
 * Minimal RRULE parser for the Phase 8.1 quick-picks. Supports
 * FREQ=DAILY|WEEKLY|MONTHLY|YEARLY + INTERVAL + (UNTIL or COUNT).
 * Custom RRULEs with BYDAY/BYMONTHDAY are tolerated by falling back
 * to FREQ+INTERVAL; advanced expansion is TECH_DEBT(phase-8).
 */
export function parseRruleMinimal(rruleText) {
  if (typeof rruleText !== 'string' || rruleText.length === 0) return null;
  const parts = rruleText.replace(/^RRULE:/i, '').split(';');
  const kv = {};
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (k && v) kv[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = kv.FREQ;
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;
  const interval = Number.parseInt(kv.INTERVAL || '1', 10);
  if (!Number.isFinite(interval) || interval < 1) return null;
  const count = kv.COUNT ? Number.parseInt(kv.COUNT, 10) : null;
  let until = null;
  if (kv.UNTIL) {
    const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?Z?$/.exec(kv.UNTIL);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}Z`;
      const d = new Date(iso);
      if (!Number.isNaN(d.getTime())) until = d;
    }
  }
  return { freq, interval, count, until };
}

/**
 * Produces materialized start-date ISO strings for a recurrence.
 * Skips `baseStartAt` itself (that's the base event); returns up to
 * `maxInstances - 1` subsequent dates within the window ending at
 * `horizon`.
 */
export function materializeRecurrenceDates(baseStartAt, rrule, { maxInstances = 52, horizon } = {}) {
  const startBase = baseStartAt instanceof Date ? baseStartAt : new Date(baseStartAt);
  const endHorizon = horizon instanceof Date
    ? horizon
    : new Date(Date.now() + 365 * 24 * 3600 * 1000);
  const out = [];
  const { freq, interval, count, until } = rrule;
  const countCap = typeof count === 'number' && count > 0 ? count : Infinity;
  const limit = Math.min(maxInstances, countCap);

  let current = new Date(startBase.getTime());
  for (let i = 1; i < limit; i += 1) {
    const next = new Date(current.getTime());
    if (freq === 'DAILY')   next.setUTCDate(next.getUTCDate() + interval);
    if (freq === 'WEEKLY')  next.setUTCDate(next.getUTCDate() + 7 * interval);
    if (freq === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + interval);
    if (freq === 'YEARLY')  next.setUTCFullYear(next.getUTCFullYear() + interval);
    if (until && next > until) break;
    if (next > endHorizon) break;
    out.push(next.toISOString());
    current = next;
  }
  return out;
}

/**
 * Resolves one attendee input from the POST /events body to a row
 * ready for `barn_event_attendees` insert. Mutates nothing — returns
 * the row or an error shape.
 */
export async function resolveAttendeeForCreate(env, { ownerId, eventStartAt, input }) {
  // Attendee input shape: {pro_contact_id?, email?, linked_user_id?, phone_e164?, delivery_channel}
  if (!input || typeof input !== 'object') {
    return { error: 'attendee_not_object' };
  }
  const channel = input.delivery_channel;
  if (!['in_app', 'email', 'email_sms'].includes(channel)) {
    return { error: 'bad_delivery_channel' };
  }

  let proContactId = null;
  let linkedUserId = null;
  let email = null;
  let phoneE164 = null;

  if (typeof input.pro_contact_id === 'string' && input.pro_contact_id) {
    if (!isUuid(input.pro_contact_id)) return { error: 'bad_pro_contact_id' };
    const pro = await getProContact(env, ownerId, input.pro_contact_id);
    if (!pro || pro.archived_at) return { error: 'pro_contact_not_found' };
    proContactId = pro.id;
    linkedUserId = pro.linked_user_id || null;
    email = pro.email || null;
    phoneE164 = pro.phone_e164 || null;
  }

  // Per-attendee overrides / ad-hoc (no pro_contact_id) path.
  if (typeof input.email === 'string' && input.email.length) {
    if (!isEmail(input.email)) return { error: 'bad_email' };
    email = input.email.trim().toLowerCase();
  }
  if (typeof input.phone_e164 === 'string' && input.phone_e164.length) {
    if (!isE164(input.phone_e164)) return { error: 'bad_phone_e164' };
    phoneE164 = input.phone_e164;
  }

  // If not yet linked and we have an email, try lazy-link.
  if (!linkedUserId && email) {
    const hit = await lookupUserByEmail(env, email);
    if (hit?.userId) linkedUserId = hit.userId;
  }

  // Must have at least one of (linked_user_id, email) per resolution_check.
  if (!linkedUserId && !email) {
    return { error: 'attendee_unresolvable' };
  }

  // Only external (non-Maneline) attendees get a public_token. Internal
  // users click through the in-app surface.
  const needsToken = !linkedUserId;
  const publicToken = needsToken ? generatePublicToken() : null;
  const tokenExpiresAt = needsToken ? deriveTokenExpiry(eventStartAt) : null;

  return {
    row: {
      pro_contact_id: proContactId,
      linked_user_id: linkedUserId,
      email,
      phone_e164: phoneE164,
      delivery_channel: channel,
      public_token: publicToken,
      token_expires_at: tokenExpiresAt,
      current_status: 'pending',
    },
  };
}

/**
 * Fire-and-forget notification log write. Never blocks caller.
 */
export async function logBarnNotification(env, row) {
  try {
    await fetch(`${RESTB(env)}/barn_event_notifications_log`, {
      method: 'POST',
      headers: { ...SR(env), 'content-type': 'application/json' },
      body: JSON.stringify(row),
    });
  } catch (err) {
    console.warn('[barn] notification log failed:', err?.message);
  }
}

/**
 * Public link the external attendee clicks. Worker URL is derived from
 * env.PUBLIC_APP_URL (falls back to https://maneline.co).
 */
export function publicEventUrl(env, token) {
  const base = (env.PUBLIC_APP_URL || 'https://maneline.co').replace(/\/+$/, '');
  return `${base}/e/${token}`;
}
