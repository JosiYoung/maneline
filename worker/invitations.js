/**
 * Mane Line — Invitation + welcome-tour handlers (Phase 6.2).
 *
 * Endpoints registered in worker.js:
 *   GET    /api/admin/invitations              — silver_lining list
 *   POST   /api/admin/invitations              — silver_lining create (single)
 *   POST   /api/admin/invitations/bulk         — silver_lining create (CSV/JSON list)
 *   POST   /api/admin/invitations/:id/resend   — re-send + bump expires_at
 *   POST   /api/admin/invitations/:id/archive  — revoke invite
 *   GET    /api/invitations/lookup?token=      — anon; public shape (email, role, barn)
 *   POST   /api/auth/claim-invite              — authed; flips accepted_at
 *   POST   /api/profiles/dismiss-welcome-tour  — authed; stamps welcome_tour_seen_at
 */

import { isResendConfigured, sendEmail } from './resend.js';
import { renderInvitationEmail } from './emails/invitation.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = new Set(['owner', 'trainer']);
const INVITE_TTL_DAYS = 14;

// ---------- token + helpers ----------------------------------------------

function base64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateInviteToken() {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function inviteUrl(request, token) {
  const origin = new URL(request.url).origin;
  return `${origin}/welcome?i=${encodeURIComponent(token)}`;
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
  });
}

// ---------- Supabase REST helpers (thin dupe of worker.js helpers) -------
// The worker.js-level helpers aren't exported, and keeping this file
// self-contained makes it easy to test in isolation.

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

async function sbUpdateReturning(env, table, filterQuery, patch) {
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

// ---------- validation ---------------------------------------------------

function validateCreateInput(body) {
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const role = typeof body?.role === 'string' ? body.role.trim() : '';
  const barnName = typeof body?.barn_name === 'string' ? body.barn_name.trim().slice(0, 200) : '';
  const batch = typeof body?.batch === 'string' ? body.batch.trim().slice(0, 64) : '';
  if (!EMAIL_RE.test(email) || email.length > 320) return { err: 'bad_email' };
  if (!VALID_ROLES.has(role)) return { err: 'bad_role' };
  return { email, role, barn_name: barnName || null, batch: batch || null };
}

// ---------- send email ---------------------------------------------------

async function sendInviteEmail(env, request, { email, role, token, barn_name, expires_at }) {
  if (!isResendConfigured(env)) {
    // Not configured — treat as non-fatal. The admin UI still shows the
    // invite row with status='invited' so the admin can copy-paste the link.
    console.warn('[invitations] Resend not configured — skipping email');
    return { ok: false, status: 501, skipped: true };
  }
  const { subject, html, text } = renderInvitationEmail({
    role,
    inviteUrl: inviteUrl(request, token),
    barnName: barn_name,
    expiresAt: expires_at,
  });
  return sendEmail(env, {
    to: email,
    subject,
    html,
    text,
    tags: { category: 'invitation', role },
  });
}

// ---------- admin: list --------------------------------------------------

export async function adminInvitationsList(env, url) {
  const statusFilter = (url.searchParams.get('status') || '').trim();
  const parts = [
    'select=id,email,role,barn_name,invited_by,invited_at,accepted_at,accepted_user_id,expires_at,archived_at,batch,created_at',
    'order=created_at.desc',
    'limit=500',
  ];
  if (statusFilter === 'invited') {
    parts.push('accepted_at=is.null', 'archived_at=is.null');
  } else if (statusFilter === 'activated') {
    parts.push('accepted_at=not.is.null', 'archived_at=is.null');
  } else if (statusFilter === 'archived') {
    parts.push('archived_at=not.is.null');
  } else if (statusFilter === 'expired') {
    parts.push('accepted_at=is.null', 'archived_at=is.null', `expires_at=lt.${new Date().toISOString()}`);
  }
  const q = await sbSelect(env, 'invitations', parts.join('&'));
  const rows = q.ok && Array.isArray(q.data) ? q.data : [];
  // Hydrate accepted_user_id → first_session_logged_at via sessions.
  const userIds = rows.map((r) => r.accepted_user_id).filter(Boolean);
  let firstSessionByUser = new Map();
  if (userIds.length) {
    const inList = userIds.map((i) => `"${i}"`).join(',');
    const s = await sbSelect(
      env,
      'sessions',
      `select=trainer_id,occurred_at&trainer_id=in.(${inList})&order=occurred_at.asc`,
    );
    const sessions = s.ok && Array.isArray(s.data) ? s.data : [];
    for (const row of sessions) {
      if (!firstSessionByUser.has(row.trainer_id)) {
        firstSessionByUser.set(row.trainer_id, row.occurred_at);
      }
    }
  }
  return json({
    rows: rows.map((r) => ({
      ...r,
      status: r.archived_at
        ? 'archived'
        : r.accepted_at
        ? 'activated'
        : new Date(r.expires_at) < new Date()
        ? 'expired'
        : 'invited',
      first_session_logged_at: r.accepted_user_id
        ? firstSessionByUser.get(r.accepted_user_id) || null
        : null,
    })),
  });
}

// ---------- admin: create single ----------------------------------------

export async function adminInvitationsCreate(env, request, actorId) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const v = validateCreateInput(body);
  if (v.err) return json({ error: v.err }, 400);

  const token = generateInviteToken();
  const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();

  const ins = await sbInsertReturning(env, 'invitations', {
    email: v.email,
    role: v.role,
    barn_name: v.barn_name,
    batch: v.batch,
    token,
    invited_by: actorId,
    expires_at,
  });
  if (!ins.ok) {
    // Unique-constraint hit → open invite already exists for this email.
    const msg = typeof ins.data === 'string' ? ins.data : JSON.stringify(ins.data || {});
    if (/invitations_email_open_unique/.test(msg)) {
      return json({ error: 'already_invited' }, 409);
    }
    return json({ error: 'insert_failed', detail: msg }, 500);
  }
  const invite = ins.data;

  const mail = await sendInviteEmail(env, request, {
    email: v.email, role: v.role, token, barn_name: v.barn_name, expires_at,
  });

  await sbAudit(env, {
    actor_id: actorId,
    actor_role: 'silver_lining',
    action: 'admin.invitation.create',
    target_table: 'invitations',
    target_id: invite.id,
    metadata: { email: v.email, role: v.role, batch: v.batch, email_sent: !!mail.ok },
  });

  return json({
    invitation: { ...invite, status: 'invited' },
    email: { ok: mail.ok, skipped: !!mail.skipped },
  }, 201);
}

// ---------- admin: bulk create ------------------------------------------

export async function adminInvitationsBulk(env, request, actorId) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || !rows.length) return json({ error: 'no_rows' }, 400);
  if (rows.length > 200) return json({ error: 'too_many' }, 413);

  const batch = typeof body?.batch === 'string' && body.batch.trim()
    ? body.batch.trim().slice(0, 64)
    : `batch-${new Date().toISOString().slice(0, 10)}`;

  const results = [];
  for (const raw of rows) {
    const v = validateCreateInput({ ...raw, batch });
    if (v.err) {
      results.push({ email: raw?.email || null, ok: false, error: v.err });
      continue;
    }
    const token = generateInviteToken();
    const expires_at = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
    const ins = await sbInsertReturning(env, 'invitations', {
      email: v.email, role: v.role, barn_name: v.barn_name, batch,
      token, invited_by: actorId, expires_at,
    });
    if (!ins.ok) {
      const msg = typeof ins.data === 'string' ? ins.data : JSON.stringify(ins.data || {});
      results.push({
        email: v.email,
        ok: false,
        error: /invitations_email_open_unique/.test(msg) ? 'already_invited' : 'insert_failed',
      });
      continue;
    }
    const mail = await sendInviteEmail(env, request, {
      email: v.email, role: v.role, token, barn_name: v.barn_name, expires_at,
    });
    results.push({
      email: v.email, role: v.role, ok: true, id: ins.data.id,
      email_sent: !!mail.ok, email_skipped: !!mail.skipped,
    });
  }

  await sbAudit(env, {
    actor_id: actorId,
    actor_role: 'silver_lining',
    action: 'admin.invitation.bulk_create',
    target_table: 'invitations',
    metadata: {
      batch,
      attempted: rows.length,
      created: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
  });
  return json({ batch, results }, 201);
}

// ---------- admin: resend ------------------------------------------------

export async function adminInvitationsResend(env, request, actorId, id) {
  const q = await sbSelect(
    env,
    'invitations',
    `select=id,email,role,barn_name,token,expires_at,accepted_at,archived_at&id=eq.${encodeURIComponent(id)}&limit=1`,
  );
  const row = Array.isArray(q.data) ? q.data[0] : null;
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.accepted_at) return json({ error: 'already_accepted' }, 409);
  if (row.archived_at) return json({ error: 'archived' }, 409);

  const new_expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  await sbUpdateReturning(
    env,
    'invitations',
    `id=eq.${encodeURIComponent(id)}`,
    { expires_at: new_expires },
  );

  const mail = await sendInviteEmail(env, request, {
    email: row.email, role: row.role, token: row.token,
    barn_name: row.barn_name, expires_at: new_expires,
  });

  await sbAudit(env, {
    actor_id: actorId,
    actor_role: 'silver_lining',
    action: 'admin.invitation.resend',
    target_table: 'invitations',
    target_id: id,
    metadata: { email: row.email, email_sent: !!mail.ok },
  });
  return json({ ok: true, email: { ok: mail.ok, skipped: !!mail.skipped } });
}

// ---------- admin: archive ----------------------------------------------

export async function adminInvitationsArchive(env, actorId, id) {
  const upd = await sbUpdateReturning(
    env,
    'invitations',
    `id=eq.${encodeURIComponent(id)}&archived_at=is.null`,
    { archived_at: new Date().toISOString() },
  );
  if (!upd.ok || !upd.data) return json({ error: 'not_found' }, 404);
  await sbAudit(env, {
    actor_id: actorId,
    actor_role: 'silver_lining',
    action: 'admin.invitation.archive',
    target_table: 'invitations',
    target_id: id,
    metadata: { email: upd.data.email },
  });
  return json({ ok: true });
}

// ---------- public: lookup ----------------------------------------------

export async function invitationLookup(env, url) {
  const token = (url.searchParams.get('token') || '').trim();
  if (!token) return json({ error: 'bad_request' }, 400);
  const q = await sbSelect(
    env,
    'invitations',
    `select=email,role,barn_name,expires_at,accepted_at,archived_at&token=eq.${encodeURIComponent(token)}&limit=1`,
  );
  const row = Array.isArray(q.data) ? q.data[0] : null;
  if (!row) return json({ error: 'not_found' }, 404);
  if (row.archived_at) return json({ error: 'archived' }, 410);
  if (row.accepted_at) return json({ error: 'already_accepted' }, 409);
  if (new Date(row.expires_at) < new Date()) return json({ error: 'expired' }, 410);
  return json({
    email: row.email,
    role: row.role,
    barn_name: row.barn_name,
    expires_at: row.expires_at,
  });
}

// ---------- authed: claim-invite ----------------------------------------

export async function claimInvite(env, request, actorId, actorJwt) {
  let body = {};
  try { body = await request.json(); } catch { body = {}; }
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  if (!token) return json({ error: 'bad_request' }, 400);

  // Lookup invite.
  const q = await sbSelect(
    env,
    'invitations',
    `select=id,email,role,barn_name,expires_at,accepted_at,archived_at,batch&token=eq.${encodeURIComponent(token)}&limit=1`,
  );
  const invite = Array.isArray(q.data) ? q.data[0] : null;
  if (!invite) return json({ error: 'not_found' }, 404);
  if (invite.archived_at) return json({ error: 'archived' }, 410);
  if (invite.accepted_at) return json({ error: 'already_accepted' }, 409);
  if (new Date(invite.expires_at) < new Date()) return json({ error: 'expired' }, 410);

  // The signed-in user's email must match the invite's email (case-insensitive).
  const who = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${actorJwt}` },
  });
  const whoData = who.ok ? await who.json().catch(() => null) : null;
  const callerEmail = (whoData?.email || '').toLowerCase();
  if (callerEmail && callerEmail !== invite.email.toLowerCase()) {
    return json({ error: 'email_mismatch' }, 403);
  }

  // Flip accepted_at + accepted_user_id.
  const upd = await sbUpdateReturning(
    env,
    'invitations',
    `id=eq.${encodeURIComponent(invite.id)}&accepted_at=is.null`,
    { accepted_at: new Date().toISOString(), accepted_user_id: actorId },
  );
  if (!upd.ok || !upd.data) return json({ error: 'claim_failed' }, 500);

  // If role is trainer from a closed-beta batch → auto-approve trainer_profiles.
  let autoApproved = false;
  if (invite.role === 'trainer' && invite.batch) {
    const patch = {
      application_status: 'approved',
      reviewed_by: invite.invited_by || actorId,
      reviewed_at: new Date().toISOString(),
      review_notes: `Closed-beta auto-approve (batch=${invite.batch})`,
    };
    const trainerUpd = await sbUpdateReturning(
      env,
      'trainer_profiles',
      `user_id=eq.${encodeURIComponent(actorId)}`,
      patch,
    );
    autoApproved = !!(trainerUpd.ok && trainerUpd.data);
    if (autoApproved) {
      await sbUpdateReturning(
        env,
        'user_profiles',
        `user_id=eq.${encodeURIComponent(actorId)}`,
        { status: 'active' },
      );
      await sbAudit(env, {
        actor_id: actorId,
        actor_role: 'silver_lining',
        action: 'admin.trainer.auto_approve',
        target_table: 'trainer_profiles',
        target_id: actorId,
        metadata: { reason: 'closed_beta_import', batch: invite.batch },
      });
    }
  }

  await sbAudit(env, {
    actor_id: actorId,
    actor_role: invite.role,
    action: 'invitation.claim',
    target_table: 'invitations',
    target_id: invite.id,
    metadata: { role: invite.role, batch: invite.batch, auto_approved: autoApproved },
  });

  return json({
    ok: true,
    role: invite.role,
    auto_approved: autoApproved,
  });
}

// ---------- authed: dismiss welcome tour --------------------------------

export async function dismissWelcomeTour(env, actorId) {
  const upd = await sbUpdateReturning(
    env,
    'user_profiles',
    `user_id=eq.${encodeURIComponent(actorId)}`,
    { welcome_tour_seen_at: new Date().toISOString() },
  );
  if (!upd.ok) return json({ error: 'update_failed' }, 500);
  return json({ ok: true });
}
