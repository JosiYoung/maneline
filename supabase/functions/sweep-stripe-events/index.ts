// ============================================================
// ManeLine — Stripe webhook sweep
// ------------------------------------------------------------
// Runs on Supabase Edge Functions (Deno runtime).
// Scheduled every 5 minutes via pg_cron — see
// supabase/functions/sweep-stripe-events/README.md.
//
// Why this exists: the Worker's /api/stripe/webhook endpoint is
// the primary path, but if the Worker was unavailable when
// Stripe delivered (or the signature secret rotated mid-event),
// events can fall on the floor between Stripe's retry attempts.
// Money is sensitive — plan §6 resolved decision #3 — so we run a
// belt-and-suspenders sweep:
//
//   1. Ask Stripe for all events since the newest one we have.
//   2. For each event not yet in stripe_webhook_events, POST it to
//      the Worker's internal /api/stripe/sweep/process endpoint
//      with source='sweep'. The Worker handles idempotency +
//      processing in one place.
//   3. Retry any rows with processed_at IS NULL older than 5 min
//      and processing_attempts < 5 by re-POSTing their payload.
//
// Auth: the Worker endpoint requires the SUPABASE_SERVICE_ROLE_KEY
// as a Bearer. Both this function and the Worker already have
// access to it via their respective secret stores.
//
// ENV VARS:
//   SUPABASE_URL                (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   STRIPE_SECRET_KEY           (secret — same test/live key used by Worker)
//   MANELINE_WORKER_URL         (e.g. https://mane-line.yourdomain.workers.dev)
// ============================================================

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const STRIPE_API = "https://api.stripe.com/v1";
const MAX_ATTEMPTS = 5;
const RETRY_AFTER_MIN_AGE_SEC = 5 * 60;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function stripeListEvents(
  stripeKey: string,
  sinceUnix: number,
): Promise<{ ok: boolean; events: Record<string, unknown>[]; error?: string }> {
  // Stripe caps `limit` at 100. For a 5-minute sweep this is plenty.
  const url = new URL(`${STRIPE_API}/events`);
  url.searchParams.set("limit", "100");
  url.searchParams.set("created[gte]", String(sinceUnix));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Basic ${btoa(`${stripeKey}:`)}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, events: [], error: `stripe_${res.status}: ${text.slice(0, 200)}` };
  }
  const body = await res.json();
  return { ok: true, events: Array.isArray(body?.data) ? body.data : [] };
}

async function postToWorker(
  workerUrl: string,
  serviceRoleKey: string,
  event: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body?: unknown }> {
  const res = await fetch(`${workerUrl.replace(/\/$/, "")}/api/stripe/sweep/process`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ event }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* ignore */ }
  return { ok: res.ok, status: res.status, body };
}

async function getSinceCursor(client: SupabaseClient): Promise<number> {
  // Latest received_at we already have — convert to unix seconds with
  // a 1-minute lookback to cover race windows.
  const { data } = await client
    .from("stripe_webhook_events")
    .select("received_at")
    .order("received_at", { ascending: false })
    .limit(1);
  const latest = Array.isArray(data) && data[0] ? data[0].received_at : null;
  if (!latest) {
    // Fall back to the last 24 hours.
    return Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  }
  const ts = Math.floor(new Date(latest).getTime() / 1000);
  return Math.max(0, ts - 60);
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  const MANELINE_WORKER_URL = Deno.env.get("MANELINE_WORKER_URL") ?? "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "missing_supabase_env" }, 500);
  }
  if (!STRIPE_SECRET_KEY) {
    // Stripe placeholder until processor is verified — no-op gracefully.
    return json({ ok: true, skipped: "stripe_not_configured" });
  }
  if (!MANELINE_WORKER_URL) {
    return json({ ok: false, error: "missing_worker_url" }, 500);
  }

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Leg 1: backfill new events from Stripe ---
  const sinceUnix = await getSinceCursor(client);
  const list = await stripeListEvents(STRIPE_SECRET_KEY, sinceUnix);
  let backfilled = 0;
  let backfillErrors: string[] = [];
  if (!list.ok) {
    backfillErrors.push(list.error ?? "stripe_list_failed");
  } else {
    for (const event of list.events) {
      const eventId = (event as { id?: string }).id;
      if (!eventId) continue;
      // Skip events already in our table.
      const { data: existing } = await client
        .from("stripe_webhook_events")
        .select("id,processed_at")
        .eq("event_id", eventId)
        .maybeSingle();
      if (existing && existing.processed_at) continue;
      if (existing && !existing.processed_at) {
        // Let the retry leg handle it below.
        continue;
      }
      const post = await postToWorker(
        MANELINE_WORKER_URL,
        SUPABASE_SERVICE_ROLE_KEY,
        event,
      );
      if (post.ok) backfilled++;
      else backfillErrors.push(`${eventId}:${post.status}`);
    }
  }

  // --- Leg 2: retry unprocessed rows past the retry threshold ---
  const cutoff = new Date(Date.now() - RETRY_AFTER_MIN_AGE_SEC * 1000).toISOString();
  const { data: stuck } = await client
    .from("stripe_webhook_events")
    .select("id,event_id,payload,processing_attempts")
    .is("processed_at", null)
    .lt("processing_attempts", MAX_ATTEMPTS)
    .lt("received_at", cutoff)
    .order("received_at", { ascending: true })
    .limit(50);

  let retried = 0;
  let retryErrors: string[] = [];
  for (const row of stuck ?? []) {
    const payload = row.payload as Record<string, unknown>;
    const post = await postToWorker(
      MANELINE_WORKER_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      payload,
    );
    if (post.ok) retried++;
    else retryErrors.push(`${row.event_id}:${post.status}`);
  }

  return json({
    ok: true,
    since_unix: sinceUnix,
    backfilled,
    retried,
    backfillErrors: backfillErrors.slice(0, 10),
    retryErrors: retryErrors.slice(0, 10),
  });
});
