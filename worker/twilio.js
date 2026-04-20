/**
 * Mane Line — Twilio SMS client (Phase 6.4).
 *
 * Thin wrapper around Twilio's Messages API for the emergency on-call
 * page flow. Admin-only messaging in v1: the only numbers we send to
 * live in `on_call_schedule`. End-user SMS (ticket status updates to
 * owners, owner-side emergency acknowledgement) is Phase 7 — needs an
 * end-user 10DLC opt-in flow + TCPA review.
 *
 * Also hosts `verifyTwilioSignature` for the `/webhooks/twilio-status`
 * webhook. Twilio signs every callback with HMAC-SHA1 over the full
 * URL + sorted form params; we reject any POST whose signature doesn't
 * match the auth token on file.
 *
 * Env expected (all SECRET — `wrangler secret put NAME`):
 *   TWILIO_ACCOUNT_SID    — AC...
 *   TWILIO_AUTH_TOKEN     — the secret used for HMAC sig + Basic auth
 *   TWILIO_FROM_NUMBER    — E.164, the toll-free 10DLC registered number
 *
 * `isTwilioConfigured(env)` is the single gate. When false, sendSms()
 * returns { ok: false, status: 501, skipped: true }. Callers treat this
 * as a non-fatal outcome — the ticket still lands in /admin/support via
 * the Phase 5.4 pipeline, and sms_dispatches keeps a row with
 * status='undelivered' + error_code=-1 so the admin knows why.
 */

export function isTwilioConfigured(env) {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER);
}

/**
 * Send one SMS via Twilio Messages API. Returns the narrow shape the
 * on-call dispatcher needs; callers that want the full Twilio payload
 * can read `raw`. Errors are normalized into { ok: false, error } so
 * upstream code doesn't have to try/catch.
 */
export async function sendSms(env, { to, body, statusCallback }) {
  if (!isTwilioConfigured(env)) {
    return { ok: false, status: 501, skipped: true, error: 'twilio_not_configured' };
  }
  if (!to || !/^\+[1-9][0-9]{6,14}$/.test(to)) {
    return { ok: false, status: 400, error: 'bad_to_number' };
  }
  if (!body || typeof body !== 'string' || body.length < 1 || body.length > 1600) {
    return { ok: false, status: 400, error: 'bad_body' };
  }

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('From', env.TWILIO_FROM_NUMBER);
  form.set('Body', body);
  if (statusCallback) form.set('StatusCallback', statusCallback);

  const auth = 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`);
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
    });
  } catch (err) {
    return { ok: false, status: 0, error: `network: ${err?.message || 'unknown'}` };
  }

  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* leave as text */ }

  if (!res.ok) {
    return {
      ok:     false,
      status: res.status,
      error:  parsed?.message || parsed?.code || `twilio_${res.status}`,
      raw:    parsed,
    };
  }

  return {
    ok:          true,
    status:      res.status,
    message_sid: parsed?.sid || null,
    twilio_status: parsed?.status || null,
    price_cents: parseTwilioPriceCents(parsed?.price, parsed?.price_unit),
    raw:         parsed,
  };
}

function parseTwilioPriceCents(priceStr, priceUnit) {
  if (!priceStr) return null;
  const n = Number(priceStr);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  // Twilio returns the price as a negative string (charge) in USD by
  // default. Convert USD → cents; other currencies are left untouched
  // (we record them in cents of their native currency — SLH operates in
  // USD, so this is fine for the beta).
  return Math.round(abs * 100);
}

/**
 * Twilio webhook signature. Per Twilio docs:
 *   1) Start with the full URL the webhook was POSTed to (incl. scheme,
 *      host, path, query string).
 *   2) For POST requests, sort the body params alphabetically by key
 *      and concatenate key+value (no separator) onto the URL.
 *   3) HMAC-SHA1 with the auth token.
 *   4) Base64 encode → compare constant-time to X-Twilio-Signature.
 *
 * Returns true only on a byte-exact match. `params` is a plain object
 * of form fields (already url-decoded).
 */
export async function verifyTwilioSignature(env, fullUrl, params, signatureHeader) {
  if (!env.TWILIO_AUTH_TOKEN || !signatureHeader) return false;

  const keys = Object.keys(params).sort();
  let payload = fullUrl;
  for (const k of keys) {
    payload += k + (params[k] ?? '');
  }

  const enc = new TextEncoder();
  const keyBuf = await crypto.subtle.importKey(
    'raw',
    enc.encode(env.TWILIO_AUTH_TOKEN),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', keyBuf, enc.encode(payload));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  // Constant-time compare — equal length is fast-path OK because
  // base64 of SHA-1 is always 28 chars.
  if (sigB64.length !== signatureHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < sigB64.length; i++) {
    diff |= sigB64.charCodeAt(i) ^ signatureHeader.charCodeAt(i);
  }
  return diff === 0;
}
