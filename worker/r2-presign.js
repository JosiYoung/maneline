/**
 * AWS Signature v4 presigner for Cloudflare R2 (S3-compatible).
 *
 * Why we roll our own: the official aws-sdk is too heavy for Workers
 * (bundle-size and cold-start tax), and R2's S3 API is a clean subset of
 * SigV4 that we can satisfy with ~120 lines and the Web Crypto SubtleCrypto
 * API — no deps.
 *
 * We use this for BROWSER-DIRECT PUT / GET only. Anything the Worker itself
 * reads or writes to R2 goes through `env.MANELINE_R2.get/put/head/delete`
 * (the binding), which doesn't need SigV4 at all.
 *
 * Credential source: stored as Cloudflare secrets, populated from the
 * R2 → Manage R2 API tokens UI. See docs/INTEGRATIONS.md → "Cloudflare R2".
 *
 *   R2_ACCOUNT_ID         — 32-char hex account id (NOT secret; convenience)
 *   R2_ACCESS_KEY_ID      — access key id for the S3-compat API token
 *   R2_SECRET_ACCESS_KEY  — matching secret access key
 *
 * R2 endpoint shape:  https://<account_id>.r2.cloudflarestorage.com/<bucket>/<key>
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';
const SERVICE = 's3';
const REGION = 'auto';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

const encoder = new TextEncoder();

async function hmacBytes(keyBytes, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return new Uint8Array(sig);
}

async function sha256Hex(message) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(message));
  return toHex(new Uint8Array(digest));
}

function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

async function deriveSigningKey(secretKey, dateStamp) {
  const kSecret = encoder.encode(`AWS4${secretKey}`);
  const kDate = await hmacBytes(kSecret, dateStamp);
  const kRegion = await hmacBytes(kDate, REGION);
  const kService = await hmacBytes(kRegion, SERVICE);
  return hmacBytes(kService, 'aws4_request');
}

// Encode a path segment per SigV4 canonical URI rules. We preserve `/`
// separators and encode everything else strictly (RFC 3986).
function encodePathSegment(seg) {
  return encodeURIComponent(seg).replace(
    /[!'()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function encodeObjectKey(key) {
  return key.split('/').map(encodePathSegment).join('/');
}

// SigV4 canonical query string: keys URI-encoded, sorted ASCII, values
// URI-encoded (spaces as %20, NOT +).
function canonicalizeQuery(params) {
  const entries = Object.entries(params).map(([k, v]) => [
    encodePathSegment(k),
    encodePathSegment(String(v)),
  ]);
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

async function presign({
  method,
  bucket,
  key,
  accountId,
  accessKeyId,
  secretKey,
  expiresSec,
  extraHeaders = {},
}) {
  if (!accountId || !accessKeyId || !secretKey) {
    throw new Error('R2 presign: missing credentials');
  }
  if (!bucket || !key) {
    throw new Error('R2 presign: bucket and key are required');
  }

  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalPath = `/${bucket}/${encodeObjectKey(key)}`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const credential = `${accessKeyId}/${credentialScope}`;

  // Normalize header names to lowercase for the canonical request, and
  // keep track of the original values for signing.
  const headers = { host, ...extraHeaders };
  const normalized = Object.entries(headers).map(([k, v]) => [
    k.toLowerCase(),
    String(v).trim(),
  ]);
  normalized.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = normalized.map(([k]) => k).join(';');
  const canonicalHeaders = normalized.map(([k, v]) => `${k}:${v}\n`).join('');

  const query = {
    'X-Amz-Algorithm': ALGORITHM,
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSec),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = canonicalizeQuery(query);

  const canonicalRequest = [
    method,
    canonicalPath,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD,
  ].join('\n');

  const hashedCanonical = await sha256Hex(canonicalRequest);
  const stringToSign = [ALGORITHM, amzDate, credentialScope, hashedCanonical].join('\n');

  const signingKey = await deriveSigningKey(secretKey, dateStamp);
  const signatureBytes = await hmacBytes(signingKey, stringToSign);
  const signature = toHex(signatureBytes);

  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/**
 * Presigned PUT with an enforced content-type. The browser MUST send the
 * same `Content-Type` header it declared to /api/uploads/sign, otherwise
 * R2 returns 403 — that's the signature binding doing its job.
 */
export function presignPut({
  bucket,
  key,
  contentType,
  accountId,
  accessKeyId,
  secretKey,
  expiresSec = 300,
}) {
  return presign({
    method: 'PUT',
    bucket,
    key,
    accountId,
    accessKeyId,
    secretKey,
    expiresSec,
    extraHeaders: contentType ? { 'content-type': contentType } : {},
  });
}

/**
 * Presigned GET. No headers beyond host are signed, so the browser can
 * open the URL directly (or via <img src>, <a href>, new-tab, etc.).
 */
export function presignGet({
  bucket,
  key,
  accountId,
  accessKeyId,
  secretKey,
  expiresSec = 300,
}) {
  return presign({
    method: 'GET',
    bucket,
    key,
    accountId,
    accessKeyId,
    secretKey,
    expiresSec,
  });
}
