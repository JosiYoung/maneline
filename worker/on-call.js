/**
 * Mane Line — Emergency on-call paging + schedule admin (Phase 6.4).
 *
 * Two surfaces live in this module:
 *
 *   1) dispatchEmergencyPage(env, ticket) — fired from the
 *      support_tickets insert path when category='emergency_followup'.
 *      Resolves the currently-active on_call_schedule row, composes the
 *      SMS body, hits Twilio, and writes an sms_dispatches row. Fails
 *      open on any error — the ticket still reaches /admin/support via
 *      the Phase 5.4 pipeline, so a Twilio or config outage does not
 *      cost a ticket.
 *
 *   2) Admin CRUD for /admin/on-call + /admin/sms-dispatches, plus the
 *      /webhooks/twilio-status receiver. All reads/writes go through
 *      service_role; every admin mutation writes an audit_log row via
 *      handleAdmin() upstream (it stamps the row around our response).
 *
 * Endpoints registered in worker.js:
 *   GET    /api/admin/on-call               — list (active + archived)
 *   POST   /api/admin/on-call               — create schedule row
 *   POST   /api/admin/on-call/:id/archive   — archive row (never delete)
 *   GET    /api/admin/sms-dispatches        — last 200 dispatches
 *   POST   /webhooks/twilio-status          — Twilio delivery callback
 *
 * Ticket path side-effect entry (called from handleSupportTicketCreate):
 *   dispatchEmergencyPage(env, ticket)
 */

import { isTwilioConfigured, sendSms, verifyTwilioSignature } from './twilio.js';

const E164_RE = /^\+[1-9][0-9]{6,14}$/;
const MAX_SMS_BODY = 1600;

// ---------- Supabase REST helpers (self-contained dupe) -------------------

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

async function sbInsertReturning(env, table, row) {
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

async function sbUpdate(env, table, filterQuery, patch) {
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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// ---------- dispatchEmergencyPage ----------------------------------------

/**
 * Compose + send the emergency page and persist the sms_dispatches row.
 * Safe to call from an awaited path OR via ctx.waitUntil; any thrown
 * error is caught and swallowed so the support ticket flow stays
 * intact. Always writes at least one sms_dispatches row (even on
 * misconfig) so admins can audit every emergency ticket end-to-end.
 */
export async function dispatchEmergencyPage(env, ticket) {
  try {
    const onCall = await resolveActiveOnCall(env);
    if (!onCall) {
      console.warn('[on-call] no active on_call_schedule row — cannot page');
      await logUndelivered(env, ticket, null, 'no_on_call_roster');
      return { ok: false, reason: 'no_on_call' };
    }

    const body = buildPageBody(env, ticket);
    const statusCallback = buildStatusCallbackUrl(env);

    if (!isTwilioConfigured(env)) {
      console.warn('[on-call] Twilio not configured — logging undelivered');
      await logUndelivered(env, ticket, onCall, 'twilio_not_configured');
      return { ok: false, reason: 'twilio_not_configured' };
    }

    const send = await sendSms(env, { to: onCall.phone_e164, body, statusCallback });

    if (!send.ok) {
      await sbInsertReturning(env, 'sms_dispatches', {
        ticket_id:          ticket.id,
        to_phone:           onCall.phone_e164,
        on_call_user_id:    onCall.user_id,
        twilio_message_sid: null,
        body:               body.slice(0, MAX_SMS_BODY),
        status:             'undelivered',
        error_code:         -1,
        sent_at:            null,
      });
      return { ok: false, reason: send.error || 'twilio_error' };
    }

    const insert = await sbInsertReturning(env, 'sms_dispatches', {
      ticket_id:          ticket.id,
      to_phone:           onCall.phone_e164,
      on_call_user_id:    onCall.user_id,
      twilio_message_sid: send.message_sid,
      body:               body.slice(0, MAX_SMS_BODY),
      status:             'queued',
      cost_cents:         send.price_cents ?? null,
      sent_at:            new Date().toISOString(),
    });

    await sbAudit(env, {
      actor_id:     null,
      actor_role:   'system',
      action:       'support.emergency.sms_paged',
      target_table: 'sms_dispatches',
      target_id:    insert.ok && insert.data ? insert.data.id : null,
      metadata: {
        ticket_id:      ticket.id,
        on_call_user:   onCall.user_id,
        message_sid:    send.message_sid,
        twilio_status:  send.twilio_status,
      },
    });

    return { ok: true, message_sid: send.message_sid };
  } catch (err) {
    console.warn('[on-call] dispatchEmergencyPage threw:', err?.message);
    return { ok: false, reason: 'exception' };
  }
}

async function resolveActiveOnCall(env) {
  const nowIso = new Date().toISOString();
  const q = await sbSelect(
    env,
    'on_call_schedule',
    `select=id,user_id,phone_e164,starts_at,ends_at` +
      `&archived_at=is.null` +
      `&starts_at=lte.${encodeURIComponent(nowIso)}` +
      `&ends_at=gt.${encodeURIComponent(nowIso)}` +
      `&order=starts_at.desc` +
      `&limit=1`,
  );
  if (!q.ok || !Array.isArray(q.data) || !q.data[0]) return null;
  return q.data[0];
}

function buildPageBody(env, ticket) {
  // Format spec'd in docs/phase-6-plan.md feature #4.
  //   "Mane Line emergency ticket #{id} — {owner_email} — {subject} — {url}"
  const origin = env.MANELINE_PUBLIC_ORIGIN || 'https://maneline.co';
  const email  = ticket.owner_email || ticket.contact_email || 'unknown';
  const subject = (ticket.subject || '').slice(0, 160);
  return `Mane Line emergency ticket #${ticket.id} — ${email} — ${subject} — ${origin}/admin/support/${ticket.id}`;
}

function buildStatusCallbackUrl(env) {
  const origin = env.MANELINE_PUBLIC_ORIGIN || 'https://maneline.co';
  return `${origin}/webhooks/twilio-status`;
}

async function logUndelivered(env, ticket, onCall, reason) {
  await sbInsertReturning(env, 'sms_dispatches', {
    ticket_id:          ticket.id,
    to_phone:           onCall?.phone_e164 || '+10000000000',
    on_call_user_id:    onCall?.user_id || null,
    twilio_message_sid: null,
    body:               `[undelivered: ${reason}] ticket ${ticket.id}`,
    status:             'undelivered',
    error_code:         -1,
    sent_at:            null,
  });
  await sbAudit(env, {
    actor_id:     null,
    actor_role:   'system',
    action:       'support.emergency.sms_undelivered',
    target_table: 'sms_dispatches',
    metadata:     { ticket_id: ticket.id, reason },
  });
}

// ---------- /webhooks/twilio-status --------------------------------------

/**
 * Twilio delivery-status callback. Fires once per state transition:
 * typically queued → sent → delivered. Occasionally an undelivered
 * (30005, 30006 carrier-level failures) arrives as the terminal state.
 * We update the matching sms_dispatches row by MessageSid.
 */
export async function handleTwilioStatusCallback(request, env) {
  if (request.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  if (!env.TWILIO_AUTH_TOKEN) {
    // Without the auth token we can't verify — refuse rather than
    // accept an unsigned write. Returning 503 makes Twilio retry.
    return jsonResp({ error: 'twilio_not_configured' }, 503);
  }

  const bodyText = await request.text();
  const params = Object.fromEntries(new URLSearchParams(bodyText));
  const signature = request.headers.get('x-twilio-signature') || '';
  const fullUrl = new URL(request.url).toString();

  const ok = await verifyTwilioSignature(env, fullUrl, params, signature);
  if (!ok) {
    console.warn('[twilio-webhook] signature mismatch');
    return jsonResp({ error: 'bad_signature' }, 403);
  }

  const sid = params.MessageSid || params.SmsSid;
  if (!sid) return jsonResp({ error: 'missing_message_sid' }, 400);

  const twilioStatus = (params.MessageStatus || params.SmsStatus || '').toLowerCase();
  const mapped = mapTwilioStatus(twilioStatus);
  if (!mapped) {
    // Known transient statuses we ignore rather than overwrite:
    // 'accepted', 'scheduled', 'canceled', 'receiving', 'received'.
    return jsonResp({ ok: true, skipped: twilioStatus || 'unknown' });
  }

  const errorCode = params.ErrorCode ? Number(params.ErrorCode) : null;
  const patch = { status: mapped };
  if (mapped === 'delivered') patch.delivered_at = new Date().toISOString();
  if (mapped === 'sent' && !patch.delivered_at) patch.sent_at = new Date().toISOString();
  if (Number.isFinite(errorCode) && errorCode > 0) patch.error_code = errorCode;

  const r = await sbUpdate(
    env,
    'sms_dispatches',
    `twilio_message_sid=eq.${encodeURIComponent(sid)}`,
    patch,
  );

  await sbAudit(env, {
    actor_id:     null,
    actor_role:   'system',
    action:       'support.emergency.sms_status',
    target_table: 'sms_dispatches',
    target_id:    r.ok && r.data ? r.data.id : null,
    metadata:     { message_sid: sid, status: mapped, error_code: errorCode },
  });

  return jsonResp({ ok: true, status: mapped });
}

function mapTwilioStatus(s) {
  switch (s) {
    case 'queued':       return 'queued';
    case 'sending':      return 'sent';
    case 'sent':         return 'sent';
    case 'delivered':    return 'delivered';
    case 'failed':       return 'failed';
    case 'undelivered':  return 'undelivered';
    default:             return null;
  }
}

// ---------- Admin: on-call schedule --------------------------------------

export async function adminOnCallList(env, url) {
  const scope = (url.searchParams.get('scope') || 'active').trim();
  const parts = [
    'select=id,user_id,phone_e164,starts_at,ends_at,notes,archived_at,created_at,updated_at',
    'order=starts_at.desc',
    'limit=200',
  ];
  if (scope === 'active') parts.push('archived_at=is.null');
  const q = await sbSelect(env, 'on_call_schedule', parts.join('&'));
  const rows = q.ok && Array.isArray(q.data) ? q.data : [];
  let byUser = new Map();
  if (rows.length) {
    const ids = [...new Set(rows.map((r) => r.user_id))];
    const inList = ids.map((i) => `"${i}"`).join(',');
    const u = await sbSelect(
      env,
      'user_profiles',
      `select=user_id,email,display_name&user_id=in.(${inList})`,
    );
    const users = u.ok && Array.isArray(u.data) ? u.data : [];
    for (const row of users) byUser.set(row.user_id, row);
  }
  const hydrated = rows.map((r) => ({
    ...r,
    user_email:        byUser.get(r.user_id)?.email || null,
    user_display_name: byUser.get(r.user_id)?.display_name || null,
    is_current:
      !r.archived_at &&
      new Date(r.starts_at) <= new Date() &&
      new Date(r.ends_at)   >  new Date(),
  }));
  return jsonResp({ rows: hydrated });
}

export async function adminOnCallCreate(env, request, actorId) {
  let body;
  try { body = await request.json(); } catch { body = null; }
  if (!body) return jsonResp({ error: 'bad_json' }, 400);

  const userId = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const phone  = typeof body.phone_e164 === 'string' ? body.phone_e164.trim() : '';
  const starts = typeof body.starts_at === 'string' ? body.starts_at.trim() : '';
  const ends   = typeof body.ends_at === 'string'   ? body.ends_at.trim()   : '';
  const notes  = typeof body.notes === 'string'     ? body.notes.slice(0, 500) : null;

  if (!/^[0-9a-f-]{36}$/i.test(userId))      return jsonResp({ error: 'bad_user_id' }, 400);
  if (!E164_RE.test(phone))                  return jsonResp({ error: 'bad_phone' }, 400);
  if (Number.isNaN(Date.parse(starts)))      return jsonResp({ error: 'bad_starts_at' }, 400);
  if (Number.isNaN(Date.parse(ends)))        return jsonResp({ error: 'bad_ends_at' }, 400);
  if (new Date(ends) <= new Date(starts))    return jsonResp({ error: 'bad_range' }, 400);

  const ins = await sbInsertReturning(env, 'on_call_schedule', {
    user_id:    userId,
    phone_e164: phone,
    starts_at:  starts,
    ends_at:    ends,
    notes,
  });

  if (!ins.ok) {
    const overlap = typeof ins.data === 'object' && ins.data && (
      (ins.data.code === '23P01') ||
      (typeof ins.data.message === 'string' && ins.data.message.includes('on_call_schedule_no_overlap'))
    );
    if (overlap) return jsonResp({ error: 'overlap' }, 409);
    return jsonResp({ error: 'insert_failed', detail: ins.data }, ins.status || 500);
  }

  await sbAudit(env, {
    actor_id:     actorId,
    actor_role:   'silver_lining',
    action:       'admin.on_call.create',
    target_table: 'on_call_schedule',
    target_id:    ins.data?.id,
    metadata:     { user_id: userId, starts_at: starts, ends_at: ends },
  });

  return jsonResp({ row: ins.data }, 201);
}

export async function adminOnCallArchive(env, actorId, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return jsonResp({ error: 'bad_id' }, 400);
  const nowIso = new Date().toISOString();
  const r = await sbUpdate(
    env,
    'on_call_schedule',
    `id=eq.${encodeURIComponent(id)}&archived_at=is.null`,
    { archived_at: nowIso },
  );
  if (!r.ok) return jsonResp({ error: 'archive_failed' }, r.status || 500);

  await sbAudit(env, {
    actor_id:     actorId,
    actor_role:   'silver_lining',
    action:       'admin.on_call.archive',
    target_table: 'on_call_schedule',
    target_id:    id,
  });

  return jsonResp({ row: r.data });
}

// ---------- Admin: sms_dispatches list -----------------------------------

export async function adminSmsDispatchesList(env, url) {
  const ticketId = (url.searchParams.get('ticket_id') || '').trim();
  const status   = (url.searchParams.get('status') || '').trim();
  const parts = [
    'select=id,ticket_id,to_phone,on_call_user_id,twilio_message_sid,body,status,error_code,cost_cents,sent_at,delivered_at,created_at',
    'order=created_at.desc',
    'limit=200',
  ];
  if (/^[0-9a-f-]{36}$/i.test(ticketId)) parts.push(`ticket_id=eq.${ticketId}`);
  if (['queued', 'sent', 'delivered', 'failed', 'undelivered'].includes(status)) {
    parts.push(`status=eq.${status}`);
  }
  const q = await sbSelect(env, 'sms_dispatches', parts.join('&'));
  const rows = q.ok && Array.isArray(q.data) ? q.data : [];
  return jsonResp({ rows });
}
