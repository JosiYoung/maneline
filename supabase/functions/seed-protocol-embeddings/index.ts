// ============================================================
// ManeLine — Seed protocol embeddings (Phase 4.2)
// ------------------------------------------------------------
// Runs on Supabase Edge Functions (Deno runtime). Scheduled
// hourly via pg_cron (see README.md) + triggerable on demand.
//
// Flow per run:
//   1. SELECT public.protocols where embed_status='pending'
//      and archived_at is null. Batch up to MAX_PER_RUN (20).
//   2. For each row, compose the embedding input string from
//      name + description + use_case + body_md + keywords, then
//      POST to the Worker's /api/protocols/embed-index route
//      with the X-Internal-Secret header.
//   3. On 200 → UPDATE protocols SET embed_status='synced',
//      embed_synced_at=now(). On non-200 → UPDATE to 'failed'.
//   4. Either way, INSERT one row into public.seed_run_log with
//      (run_id, protocol_id, status, error_message). run_id is
//      a single uuid per Edge Function invocation so operators
//      can diff one run from another.
//
// Drift-check mode: callers can set { mode: 'drift' } in the
// POST body to re-queue any row whose updated_at > embed_synced_at
// (flip embed_status back to 'pending') BEFORE running the
// embed pass. Cedric's hourly cron uses this.
//
// Placeholder-safety: if MANELINE_WORKER_URL or
// WORKER_INTERNAL_SECRET is missing, we exit 200 with
// { skipped: 'worker_not_configured' } — no mutations.
//
// ENV VARS:
//   SUPABASE_URL                 (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY    (auto-injected)
//   MANELINE_WORKER_URL          (secret, e.g. https://maneline.co)
//   WORKER_INTERNAL_SECRET       (secret — matches worker env of
//                                 same name; rotate in pairs)
// ============================================================

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const MAX_PER_RUN = 20;
const WORKER_EMBED_PATH = "/api/protocols/embed-index";

type ProtocolRow = {
  id: string;
  number: string | null;
  name: string;
  description: string | null;
  use_case: string | null;
  body_md: string | null;
  category: string | null;
  keywords: string[] | null;
  linked_sku_codes: string[] | null;
};

type RunBody = { mode?: "normal" | "drift" };

type SeedLogInsert = {
  run_id: string;
  protocol_id: string | null;
  status: "synced" | "failed" | "skipped";
  error_message: string | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function composeEmbeddingText(row: ProtocolRow): string {
  const parts: string[] = [];
  if (row.number) parts.push(`Protocol ${row.number}`);
  parts.push(row.name);
  if (row.description) parts.push(row.description);
  if (row.use_case) parts.push(row.use_case);
  if (row.body_md) parts.push(row.body_md);
  const kw = (row.keywords ?? []).filter(Boolean);
  if (kw.length > 0) parts.push(`Keywords: ${kw.join(", ")}`);
  return parts.join("\n\n");
}

async function callWorkerEmbedIndex(
  workerUrl: string,
  secret: string,
  protocolId: string,
  text: string,
  metadata: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; detail?: string; mutationId?: string | null }> {
  const endpoint = `${workerUrl.replace(/\/$/, "")}${WORKER_EMBED_PATH}`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-secret": secret,
      },
      body: JSON.stringify({ protocol_id: protocolId, text, metadata }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, status: res.status, detail: body.slice(0, 400) };
    }
    const body = await res.json();
    return { ok: true, status: 200, mutationId: body?.mutation_id ?? null };
  } catch (err) {
    return { ok: false, status: 0, detail: (err as Error).message };
  }
}

async function requeueDrift(client: SupabaseClient): Promise<number> {
  // Any row where the content changed after its last embed — flip
  // back to pending so the main loop below re-embeds it.
  //
  // PostgREST can't express "updated_at > embed_synced_at" in a
  // single filter, so we pull the candidates in one select and
  // UPDATE by id list. Protocol rows are small (~hundreds).
  const { data: candidates, error: selErr } = await client
    .from("protocols")
    .select("id, updated_at, embed_synced_at")
    .eq("embed_status", "synced")
    .is("archived_at", null);
  if (selErr) throw new Error(`drift_select: ${selErr.message}`);

  const stale = (candidates ?? []).filter(
    (r) =>
      r.embed_synced_at == null ||
      new Date(r.updated_at).getTime() > new Date(r.embed_synced_at).getTime(),
  );
  if (stale.length === 0) return 0;

  const ids = stale.map((r) => r.id);
  const { error: updErr } = await client
    .from("protocols")
    .update({ embed_status: "pending" })
    .in("id", ids);
  if (updErr) throw new Error(`drift_update: ${updErr.message}`);
  return ids.length;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const MANELINE_WORKER_URL = Deno.env.get("MANELINE_WORKER_URL") ?? "";
  const WORKER_INTERNAL_SECRET = Deno.env.get("WORKER_INTERNAL_SECRET") ?? "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "missing_supabase_env" }, 500);
  }
  if (!MANELINE_WORKER_URL || !WORKER_INTERNAL_SECRET) {
    return json({ ok: true, skipped: "worker_not_configured" });
  }

  const run_id = crypto.randomUUID();
  const startedAt = Date.now();
  let body: RunBody = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as RunBody;
    } catch {
      body = {};
    }
  }
  const mode = body.mode === "drift" ? "drift" : "normal";

  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Leg 1: drift re-queue (only when explicitly requested) ---
  let requeued = 0;
  if (mode === "drift") {
    try {
      requeued = await requeueDrift(client);
    } catch (err) {
      return json(
        { ok: false, run_id, error: (err as Error).message },
        500,
      );
    }
  }

  // --- Leg 2: fetch pending batch ---
  const { data: pending, error: pendingErr } = await client
    .from("protocols")
    .select(
      "id, number, name, description, use_case, body_md, category, keywords, linked_sku_codes",
    )
    .eq("embed_status", "pending")
    .is("archived_at", null)
    .limit(MAX_PER_RUN);

  if (pendingErr) {
    return json(
      { ok: false, run_id, error: `select_pending: ${pendingErr.message}` },
      500,
    );
  }

  const rows: ProtocolRow[] = pending ?? [];
  if (rows.length === 0) {
    return json({
      ok: true,
      run_id,
      mode,
      requeued,
      processed: 0,
      synced: 0,
      failed: 0,
      duration_ms: Date.now() - startedAt,
    });
  }

  // --- Leg 3: embed + upsert each row, log outcome ---
  const logRows: SeedLogInsert[] = [];
  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    const text = composeEmbeddingText(row);
    if (!text.trim()) {
      await client
        .from("protocols")
        .update({ embed_status: "failed" })
        .eq("id", row.id);
      logRows.push({
        run_id,
        protocol_id: row.id,
        status: "failed",
        error_message: "empty_text",
      });
      failed += 1;
      continue;
    }

    const metadata = {
      protocol_id: row.id,
      number: row.number,
      category: row.category,
      linked_sku_codes: row.linked_sku_codes ?? [],
    };

    const res = await callWorkerEmbedIndex(
      MANELINE_WORKER_URL,
      WORKER_INTERNAL_SECRET,
      row.id,
      text,
      metadata,
    );

    if (res.ok) {
      const { error: updErr } = await client
        .from("protocols")
        .update({
          embed_status: "synced",
          embed_synced_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updErr) {
        logRows.push({
          run_id,
          protocol_id: row.id,
          status: "failed",
          error_message: `db_update: ${updErr.message}`.slice(0, 500),
        });
        failed += 1;
      } else {
        logRows.push({
          run_id,
          protocol_id: row.id,
          status: "synced",
          error_message: null,
        });
        synced += 1;
      }
    } else {
      await client
        .from("protocols")
        .update({ embed_status: "failed" })
        .eq("id", row.id);
      logRows.push({
        run_id,
        protocol_id: row.id,
        status: "failed",
        error_message: `worker_${res.status}: ${res.detail ?? "unknown"}`.slice(0, 500),
      });
      failed += 1;
    }
  }

  if (logRows.length > 0) {
    const { error: logErr } = await client.from("seed_run_log").insert(logRows);
    if (logErr) {
      // Non-fatal: embeddings landed, audit row didn't. Surface in response.
      return json({
        ok: true,
        run_id,
        mode,
        requeued,
        processed: rows.length,
        synced,
        failed,
        log_insert_error: logErr.message.slice(0, 300),
        duration_ms: Date.now() - startedAt,
      });
    }
  }

  return json({
    ok: true,
    run_id,
    mode,
    requeued,
    processed: rows.length,
    synced,
    failed,
    duration_ms: Date.now() - startedAt,
  });
});
