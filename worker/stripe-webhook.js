/**
 * Stripe webhook signature verifier.
 *
 * Implements the scheme documented at
 * https://docs.stripe.com/webhooks/signatures — the `Stripe-Signature`
 * header is a comma-separated list of `t=<unix>` and `v1=<hex>` pairs.
 * We compute HMAC-SHA256 over `${t}.${rawBody}` with STRIPE_WEBHOOK_SECRET,
 * hex-encode it, and constant-time compare against any `v1` entry.
 *
 * Stripe recommends rejecting events older than 5 minutes to harden
 * against replay attacks. We default to 300s tolerance.
 *
 * Pure Web Crypto — runs in the Cloudflare Worker bundle without pulling
 * the Node `crypto` module or the full `stripe` SDK.
 */

const DEFAULT_TOLERANCE_SEC = 300;

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

function bytesToHex(buf) {
  const view = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }
  return out;
}

function constantTimeEqualBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function parseSigHeader(header) {
  // Format: "t=1680000000,v1=abcdef...,v1=deadbeef,v0=legacy"
  const out = { t: null, v1: [] };
  if (typeof header !== 'string' || header.length === 0) return out;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === 't') out.t = parseInt(v, 10);
    else if (k === 'v1') out.v1.push(v);
  }
  return out;
}

/**
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
export async function verifyStripeSignature({
  rawBody,
  signatureHeader,
  secret,
  toleranceSec = DEFAULT_TOLERANCE_SEC,
  nowSec = Math.floor(Date.now() / 1000),
}) {
  if (!secret) return { ok: false, error: 'secret_missing' };
  if (typeof rawBody !== 'string') return { ok: false, error: 'body_not_string' };

  const parsed = parseSigHeader(signatureHeader);
  if (!parsed.t || parsed.v1.length === 0) {
    return { ok: false, error: 'signature_malformed' };
  }
  if (Math.abs(nowSec - parsed.t) > toleranceSec) {
    return { ok: false, error: 'signature_too_old' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parsed.t}.${rawBody}`),
  );
  const macHex = bytesToHex(mac);
  const macBytes = hexToBytes(macHex);

  for (const candidate of parsed.v1) {
    const candBytes = hexToBytes(candidate);
    if (constantTimeEqualBytes(macBytes, candBytes)) return { ok: true };
  }
  return { ok: false, error: 'signature_mismatch' };
}
