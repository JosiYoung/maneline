#!/usr/bin/env node
// scripts/revoke-invitation.mjs — Phase 6.6 escape hatch.
//
// Finds the OPEN (non-accepted, non-archived) invitation for a given email
// and archives it via /api/admin/invitations/:id/archive. After this the
// address is eligible for re-invite via import-beta-invites.mjs, because
// the unique-open-email index only blocks rows with archived_at IS NULL.
//
// Usage:
//   node scripts/revoke-invitation.mjs you@example.com \
//     --base-url https://maneline.co \
//     --supabase-url https://xxxx.supabase.co --supabase-anon-key <anon> \
//     --email admin@maneline.co --password *****
//
// Or with a pre-obtained admin JWT:
//   node scripts/revoke-invitation.mjs you@example.com --base-url ... --jwt <token>

import { argv, exit, env } from 'node:process';

function parseArgs(argvList) {
  const positional = [];
  const flags = {};
  for (let i = 2; i < argvList.length; i++) {
    const a = argvList[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    const key = a.slice(2);
    const next = argvList[i + 1];
    if (next === undefined || next.startsWith('--')) {
      flags[key] = true;
    } else {
      flags[key] = next;
      i++;
    }
  }
  return { positional, flags };
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

async function main() {
  const { positional, flags } = parseArgs(argv);
  const target = (positional[0] || '').toLowerCase();
  if (!target) {
    console.error('Usage: revoke-invitation.mjs <email> [--base-url ...] [--jwt ... | --email ... --password ...]');
    exit(2);
  }

  const baseUrl = flags['base-url'] || env.BASE_URL;
  const supabaseUrl = flags['supabase-url'] || env.SUPABASE_URL;
  const anonKey = flags['supabase-anon-key'] || env.SUPABASE_ANON_KEY;
  const jwtArg = flags.jwt || env.ADMIN_JWT;
  const emailArg = flags.email || env.ADMIN_EMAIL;
  const passwordArg = flags.password || env.ADMIN_PASSWORD;

  if (!baseUrl) { console.error('Missing --base-url (or BASE_URL env).'); exit(2); }
  if (!jwtArg && !(emailArg && passwordArg && supabaseUrl && anonKey)) {
    console.error('Auth required: either --jwt, or (--supabase-url, --supabase-anon-key, --email, --password).');
    exit(2);
  }

  let jwt = jwtArg;
  if (!jwt) {
    console.error(`Signing in as ${emailArg}…`);
    jwt = await signIn(supabaseUrl, anonKey, emailArg, passwordArg);
  }
  const headers = { 'content-type': 'application/json', Authorization: `Bearer ${jwt}` };
  const apiBase = `${baseUrl.replace(/\/$/, '')}/api/admin/invitations`;

  // List open invites and find the one matching this email. We rely on the
  // admin list endpoint (which re-checks silver_lining + audits the read)
  // rather than hitting PostgREST directly from a dev machine.
  const listRes = await fetch(`${apiBase}?status=invited`, { headers });
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => '');
    console.error(`List invites failed (${listRes.status}): ${body}`);
    exit(1);
  }
  const payload = await listRes.json();
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const match = rows.find((r) => (r.email || '').toLowerCase() === target);
  if (!match) {
    console.error(`No OPEN invitation found for ${target}. (Already accepted / archived invites aren't affected.)`);
    exit(1);
  }

  const archiveRes = await fetch(`${apiBase}/${encodeURIComponent(match.id)}/archive`, {
    method: 'POST',
    headers,
  });
  if (!archiveRes.ok) {
    const body = await archiveRes.text().catch(() => '');
    console.error(`Archive failed (${archiveRes.status}): ${body}`);
    exit(1);
  }
  console.log(`Archived invitation ${match.id} for ${match.email} (role=${match.role}, batch=${match.batch || '—'}).`);
  console.log('Address is now eligible for re-invite.');
}

main().catch((e) => {
  console.error(e.stack || e.message || String(e));
  exit(1);
});
