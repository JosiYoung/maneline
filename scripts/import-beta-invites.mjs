#!/usr/bin/env node
// scripts/import-beta-invites.mjs — Phase 6.6 closed-beta bulk invite.
//
// Reads a CSV of closed-beta invitees, authenticates against Supabase as a
// silver_lining admin, and POSTs the rows to /api/admin/invitations/bulk on
// the Worker, which validates + inserts + emails + audit-logs per row.
//
// Usage:
//   node scripts/import-beta-invites.mjs \
//     --base-url https://maneline.co \
//     --supabase-url https://xxxx.supabase.co \
//     --supabase-anon-key <anon-key> \
//     --email you@example.com --password ***** \
//     --csv supabase/seed/beta-invites.csv \
//     [--batch 2026-05-25-launch] [--dry-run]
//
// Or if you already have an admin JWT:
//   node scripts/import-beta-invites.mjs --base-url ... --jwt <token> --csv ...
//
// Env var fallbacks (helpful for CI-ish runs):
//   BASE_URL, SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_JWT
//
// Exits non-zero if any row fails to insert so CI / the operator sees it.

import { readFile } from 'node:fs/promises';
import { argv, exit, env } from 'node:process';

const BATCH_SIZE = 50;

function parseArgs(argvList) {
  const out = {};
  for (let i = 2; i < argvList.length; i++) {
    const a = argvList[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argvList[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function parseCsv(text) {
  // Minimal CSV: supports double-quoted fields (with embedded commas + "" escapes),
  // skips lines where the first non-whitespace char is '#', skips blank lines,
  // and treats the first non-comment/non-blank line as the header.
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;
  const lines = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { cur.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      cur.push(field);
      lines.push(cur);
      cur = [];
      field = '';
      continue;
    }
    field += ch;
  }
  if (field.length || cur.length) { cur.push(field); lines.push(cur); }

  let header = null;
  for (const line of lines) {
    const first = (line[0] || '').trim();
    if (!first && line.length === 1) continue; // blank
    if (first.startsWith('#')) continue;       // comment
    if (!header) { header = line.map((h) => h.trim()); continue; }
    if (line.every((c) => (c || '').trim() === '')) continue;
    const obj = {};
    for (let i = 0; i < header.length; i++) {
      obj[header[i]] = (line[i] || '').trim();
    }
    rows.push(obj);
  }
  return { header: header || [], rows };
}

async function signIn(supabaseUrl, anonKey, email, password) {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anonKey },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase sign-in failed (${res.status}): ${body}`);
  }
  const payload = await res.json();
  if (!payload?.access_token) throw new Error('Supabase sign-in returned no access_token.');
  return payload.access_token;
}

async function postBulk(baseUrl, jwt, rows, batch) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/admin/invitations/bulk`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ rows, batch }),
  });
  const text = await res.text();
  let payload = null;
  try { payload = JSON.parse(text); } catch { /* non-JSON error body */ }
  if (!res.ok) {
    throw new Error(`Bulk invite failed (${res.status}): ${payload?.error || text}`);
  }
  return payload;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function main() {
  const args = parseArgs(argv);
  const baseUrl = args['base-url'] || env.BASE_URL;
  const supabaseUrl = args['supabase-url'] || env.SUPABASE_URL;
  const anonKey = args['supabase-anon-key'] || env.SUPABASE_ANON_KEY;
  const jwtArg = args.jwt || env.ADMIN_JWT;
  const emailArg = args.email || env.ADMIN_EMAIL;
  const passwordArg = args.password || env.ADMIN_PASSWORD;
  const csvPath = args.csv || 'supabase/seed/beta-invites.csv';
  const batch = args.batch || `beta-${new Date().toISOString().slice(0, 10)}`;
  const dryRun = !!args['dry-run'];

  if (!dryRun) {
    if (!baseUrl) {
      console.error('Missing --base-url (or BASE_URL env).');
      exit(2);
    }
    if (!jwtArg && !(emailArg && passwordArg && supabaseUrl && anonKey)) {
      console.error(
        'Auth required: either --jwt <token>, or (--supabase-url, --supabase-anon-key, --email, --password).',
      );
      exit(2);
    }
  }

  let csv;
  try {
    csv = await readFile(csvPath, 'utf8');
  } catch (e) {
    console.error(`Failed to read CSV at ${csvPath}: ${e.message}`);
    exit(2);
  }

  const { header, rows } = parseCsv(csv);
  if (!header.includes('email') || !header.includes('role')) {
    console.error(`CSV header must include at least 'email' and 'role'. Got: ${header.join(', ')}`);
    exit(2);
  }
  if (!rows.length) {
    console.error('No data rows found in CSV.');
    exit(2);
  }

  // Normalize + validate locally to fail fast.
  const normalized = [];
  const localErrors = [];
  for (const [i, r] of rows.entries()) {
    const email = (r.email || '').toLowerCase();
    const role = (r.role || '').toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      localErrors.push(`row ${i + 1}: invalid email '${r.email}'`);
      continue;
    }
    if (role !== 'owner' && role !== 'trainer') {
      localErrors.push(`row ${i + 1} (${email}): role must be 'owner' or 'trainer', got '${r.role}'`);
      continue;
    }
    const row = { email, role };
    if (r.barn_name) row.barn_name = r.barn_name;
    normalized.push(row);
  }
  if (localErrors.length) {
    console.error(`Local validation failed:\n  ${localErrors.join('\n  ')}`);
    exit(3);
  }

  console.error(`Parsed ${normalized.length} row(s) from ${csvPath}. Batch=${batch}.`);
  if (dryRun) {
    for (const r of normalized) console.log(`DRY  ${r.role.padEnd(8)} ${r.email}${r.barn_name ? `  [${r.barn_name}]` : ''}`);
    console.error('Dry run complete — no invites sent.');
    exit(0);
  }

  let jwt = jwtArg;
  if (!jwt) {
    console.error(`Signing in to ${supabaseUrl} as ${emailArg}…`);
    jwt = await signIn(supabaseUrl, anonKey, emailArg, passwordArg);
  }

  const chunks = chunk(normalized, BATCH_SIZE);
  let ok = 0, already = 0, failed = 0;
  for (const [ci, part] of chunks.entries()) {
    console.error(`Posting chunk ${ci + 1}/${chunks.length} (${part.length} row(s))…`);
    const payload = await postBulk(baseUrl, jwt, part, batch);
    for (const r of payload.results || []) {
      if (r.ok) {
        ok++;
        console.log(`OK   ${r.role.padEnd(8)} ${r.email}${r.email_sent ? '  [emailed]' : r.email_skipped ? '  [email skipped]' : ''}`);
      } else if (r.error === 'already_invited') {
        already++;
        console.log(`SKIP ${r.email}  already_invited`);
      } else {
        failed++;
        console.log(`FAIL ${r.email}  ${r.error || 'unknown'}`);
      }
    }
  }

  console.error(`\nDone. created=${ok}  already_invited=${already}  failed=${failed}  batch=${batch}`);
  exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.stack || e.message || String(e));
  exit(1);
});
