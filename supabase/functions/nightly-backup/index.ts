// ============================================================
// ManeLine — Nightly Layer 2 Backup
// ------------------------------------------------------------
// Runs on Supabase Edge Functions (Deno runtime).
// Scheduled at 07:00 UTC daily (midnight MST year-round) via pg_cron.
// See supabase/functions/nightly-backup/README.md for the exact cron
// SQL. Supabase's dashboard "Schedules" tab was removed — pg_cron is
// the supported path now.
//
// What it does:
//   1. Reads every backed-up table from Supabase using the
//      SERVICE_ROLE key (bypasses RLS — this is the only place
//      the service_role key is used; it lives in Supabase's
//      own secret store, not in the browser or worker).
//   2. Serializes each table as JSON (pretty) and CSV.
//   3. Commits them to the client-owned GitHub repo via the
//      GitHub Contents API under:
//         snapshots/YYYY-MM-DD/<table>.json
//         snapshots/YYYY-MM-DD/<table>.csv
//         snapshots/YYYY-MM-DD/manifest.json
//      plus a rolling "LATEST/" mirror for easy human checks.
//
//   Tables: profiles, horses (original)
//           + user_profiles, animals, ranches,
//             animal_access_grants, trainer_profiles,
//             trainer_applications  (Phase 0 / Prompt 9.2)
//           + vet_records, animal_media, r2_objects,
//             animal_archive_events  (Phase 1 / Prompt 1.9)
//           + training_sessions, session_payments,
//             stripe_connect_accounts, platform_settings,
//             stripe_webhook_events, session_archive_events
//                                    (Phase 2 / Prompt 2.9)
//           + products, shopify_sync_cursor, orders,
//             order_line_items, expenses, expense_archive_events
//                                    (Phase 3 / Prompt 3.9)
//             Zero card data. Stripe ids are opaque strings;
//             Shopify image URLs are public CDN links.
//           + invitations, on_call_schedule, sms_dispatches,
//             stripe_subscriptions   (Phase 6 / Prompt 6.7)
//             Manifest version bumps to "6.0".
//
// Layer 2 guarantee: open-format (JSON + CSV), standard Git,
// zero ManeLine tooling required to read. If Supabase AND
// Google both vanish tomorrow, the repo alone is a complete,
// portable archive of the business.
//
// ENV VARS required (set via `supabase secrets set`):
//   SUPABASE_URL                (auto-injected by the platform)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected by the platform)
//   GITHUB_TOKEN                (fine-grained PAT — see README Leg 5)
//   GITHUB_OWNER                (default: JosiYoung)
//   GITHUB_REPO                 (default: Databackup)
//   GITHUB_BRANCH               (default: main)
// ============================================================

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const GITHUB_API = "https://api.github.com";

// ---------- helpers ----------

function b64(str: string): string {
  // UTF-8 safe base64 for GitHub Contents API
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) return "";
  // Union of all keys so sparse rows still serialize
  const colSet = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) colSet.add(k);
  const cols = [...colSet];

  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "string" ? v : JSON.stringify(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}

async function loadTable(client: SupabaseClient, table: string, sortBy = "created_at") {
  const { data, error } = await client.from(table).select("*").order(sortBy, { ascending: true });
  if (error) throw new Error(`Supabase read failed for ${table}: ${error.message}`);
  return data ?? [];
}

async function githubPutFile(opts: {
  owner: string;
  repo: string;
  branch: string;
  path: string;
  contentBase64: string;
  message: string;
  token: string;
}) {
  const { owner, repo, branch, path, contentBase64, message, token } = opts;
  const base = `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodeURI(path)}`;
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "maneline-nightly-backup",
    "Content-Type": "application/json",
  };

  // Fetch existing SHA if the file is already present (GitHub requires it for updates).
  let sha: string | undefined;
  const head = await fetch(`${base}?ref=${encodeURIComponent(branch)}`, { headers });
  if (head.ok) {
    const existing = await head.json();
    if (existing && typeof existing === "object" && "sha" in existing) sha = (existing as { sha: string }).sha;
  } else if (head.status !== 404) {
    // 404 is expected for fresh files; any other error is real.
    const text = await head.text();
    throw new Error(`GitHub GET ${path} failed: ${head.status} ${text}`);
  }

  const body = JSON.stringify({
    message,
    content: contentBase64,
    branch,
    ...(sha ? { sha } : {}),
  });

  const put = await fetch(base, { method: "PUT", headers, body });
  if (!put.ok) {
    const text = await put.text();
    throw new Error(`GitHub PUT ${path} failed: ${put.status} ${text}`);
  }
}

// ---------- handler ----------

Deno.serve(async (_req) => {
  const startedAt = new Date();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
    const GITHUB_OWNER = Deno.env.get("GITHUB_OWNER") ?? "JosiYoung";
    const GITHUB_REPO = Deno.env.get("GITHUB_REPO") ?? "Databackup";
    const GITHUB_BRANCH = Deno.env.get("GITHUB_BRANCH") ?? "main";

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
    }
    if (!GITHUB_TOKEN) {
      return json({ ok: false, error: "Missing GITHUB_TOKEN secret" }, 500);
    }

    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Layer 2 contents — original + Phase 0 multi-role + Phase 1 owner
    // portal tables. Note: r2_objects is metadata only (object_key,
    // kind, content_type, byte_size) — the actual R2 files stay in
    // Cloudflare, covered by R2 object versioning + bucket policy.
    const TABLES = [
      "profiles",
      "horses",
      "user_profiles",
      "animals",
      "ranches",
      "animal_access_grants",
      "trainer_profiles",
      "trainer_applications",
      "vet_records",
      "animal_media",
      "r2_objects",
      "animal_archive_events",
      // Phase 2 (Prompt 2.9) — trainer portal + Stripe payouts tables.
      // No card data lives in any of these rows; Stripe holds PCI data.
      // We only store account/intent/charge ids as opaque strings, fee
      // config, and idempotency-keyed webhook event bodies.
      "training_sessions",
      "session_payments",
      "stripe_connect_accounts",
      "platform_settings",
      "stripe_webhook_events",
      "session_archive_events",
      // Phase 3 (Prompt 3.9) — Silver Lining marketplace + expenses.
      // Zero card data here too: `orders` stores opaque Stripe session /
      // payment_intent / charge ids + amounts, `products` stores
      // Shopify variant ids + public image URLs. `expenses` is a
      // plain ledger of owner/trainer-reported charges.
      "products",
      "shopify_sync_cursor",
      "orders",
      "order_line_items",
      "expenses",
      "expense_archive_events",
      // Phase 3.5 (P0 catch-up) — supplement protocol tracker.
      // protocols is seeded from supabase/seeds/protocols.sql; the
      // catalog will grow once SLH's real content replaces placeholders
      // before Phase 4 launch. animal_protocols + supplement_doses
      // carry per-animal dosing + append-only dose confirmations.
      "protocols",
      "animal_protocols",
      "supplement_doses",
      // Phase 4 — Protocol Brain (Workers AI + Vectorize).
      // conversations groups owner chat threads; chatbot_runs is the
      // append-only per-turn audit row (user text, assistant text,
      // retrieved protocol ids, fallback/emergency flags, latency).
      "conversations",
      "chatbot_runs",
      // Phase 5 — Admin portal + Vet View + HubSpot sync.
      // audit_log is append-only (OAG §3) — every admin read and
      // every scoped vet_view fetch stamps a row. support_tickets
      // also mirrors to Sheets L1 for triple redundancy.
      // order_refunds is service_role-only; owners see refund state
      // joined onto their own orders. vet_share_tokens carries the
      // 32-byte opaque token + scope jsonb + usage counters.
      // hubspot_sync_log is the successful-send audit; the
      // pending_hubspot_syncs queue carries attempts + dead-letters.
      "audit_log",
      "support_tickets",
      "order_refunds",
      "vet_share_tokens",
      "hubspot_sync_log",
      "pending_hubspot_syncs",
      // Phase 6 — closed-beta onboarding + emergency paging + auto-ship.
      // invitations carries the 32-byte magic-link token; on_call_schedule
      // is the admin-only paging roster; sms_dispatches is the append-only
      // Twilio log (message_sid, status, cost_cents); stripe_subscriptions
      // is the read-through cache of Stripe auto-ship subs (source of truth
      // stays in Stripe). No card data in any of these — Twilio cost is
      // denormalized cents only; Stripe ids are opaque strings.
      "invitations",
      "on_call_schedule",
      "sms_dispatches",
      "stripe_subscriptions",
      // Phase 7 — trainer business (invoices, recurring line items,
      // invoice settings + branding). No card data — Stripe ids and
      // cents amounts only.
      "invoices",
      "invoice_line_items",
      "recurring_line_items",
      "trainer_invoice_settings",
      "trainer_customer_map",
      "trainer_goals",
      // Phase 8 Module 01 — Barn Calendar + Professional Contacts.
      "professional_contacts",
      "barn_event_recurrence_rules",
      "barn_events",
      "barn_event_attendees",
      "barn_event_responses",
      "barn_event_notifications_log",
      "user_notification_prefs",
      // Phase 8 Module 02 — Herd Health dashboard. Thresholds are
      // per-owner overrides; acknowledgements carry snoozed / dismissed
      // cells (owner action).
      "health_thresholds",
      "health_dashboard_acknowledgements",
      // Phase 8 Module 03 — Facility Map + Care Matrix.
      "stalls",
      "stall_assignments",
      "turnout_groups",
      "turnout_group_members",
      "care_matrix_entries",
      // Phase 8 Module 04 — Barn Spending cost-basis overlay (expenses
      // table is already backed up above).
      "animal_cost_basis",
      // Phase 8 Module 05 — subscriptions (Barn Mode entitlement entity,
      // NOT the Phase 6.5 stripe_subscriptions cache), SL link ledger,
      // promo codes, and append-only entitlement-events audit.
      "subscriptions",
      "silver_lining_links",
      "promo_codes",
      "barn_mode_entitlement_events",
    ] as const;

    // Per-table sort override. Most tables sort by created_at (default).
    // - shopify_sync_cursor + platform_settings are singleton rows with no
    //   created_at — sort by `id` so the query succeeds.
    // - stripe_webhook_events uses `received_at` (when Stripe first delivered
    //   the webhook) rather than created_at; see Phase 2 migration.
    const SORT_BY: Partial<Record<(typeof TABLES)[number], string>> = {
      shopify_sync_cursor: "id",
      platform_settings: "id",
      stripe_webhook_events: "received_at",
      // audit_log uses `occurred_at` (see 00013 migration). The other five
      // Phase 5 tables use the default created_at.
      audit_log: "occurred_at",
    };

    const tableData: Record<string, Record<string, unknown>[]> = {};
    const results = await Promise.all(
      TABLES.map((t) => loadTable(client, t, SORT_BY[t] ?? "created_at")),
    );
    for (let i = 0; i < TABLES.length; i++) tableData[TABLES[i]] = results[i];

    const yyyy = startedAt.getUTCFullYear();
    const mm = String(startedAt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(startedAt.getUTCDate()).padStart(2, "0");
    const dateDir = `${yyyy}-${mm}-${dd}`;
    const isoStamp = startedAt.toISOString();

    const manifest: Record<string, unknown> = {
      snapshot_at: isoStamp,
      source: "supabase",
      tables: [...TABLES],
      generator: "maneline-nightly-backup",
      version: "8.0",
    };
    for (const t of TABLES) manifest[`${t}_count`] = tableData[t].length;

    const files: { path: string; body: string }[] = [];

    // JSON + CSV for each table in both dated snapshot and rolling LATEST.
    for (const t of TABLES) {
      const jsonBody = JSON.stringify(tableData[t], null, 2);
      const csvBody = toCsv(tableData[t]);
      files.push({ path: `snapshots/${dateDir}/${t}.json`, body: jsonBody });
      files.push({ path: `snapshots/${dateDir}/${t}.csv`,  body: csvBody });
      files.push({ path: `LATEST/${t}.json`, body: jsonBody });
      files.push({ path: `LATEST/${t}.csv`,  body: csvBody });
    }
    // Manifest in both locations.
    const manifestJson = JSON.stringify(manifest, null, 2);
    files.push({ path: `snapshots/${dateDir}/manifest.json`, body: manifestJson });
    files.push({ path: `LATEST/manifest.json`, body: manifestJson });

    const counts = TABLES.map((t) => `${tableData[t].length} ${t}`).join(", ");
    const commitMessage = `snapshot ${dateDir} — ${counts}`;

    // Commit sequentially to preserve a tidy Git history and avoid GitHub rate-limiting.
    for (const f of files) {
      await githubPutFile({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        branch: GITHUB_BRANCH,
        path: f.path,
        contentBase64: b64(f.body),
        message: commitMessage,
        token: GITHUB_TOKEN,
      });
    }

    const response: Record<string, unknown> = {
      ok: true,
      snapshot_at: isoStamp,
      files_written: files.length,
      repo: `${GITHUB_OWNER}/${GITHUB_REPO}`,
      branch: GITHUB_BRANCH,
    };
    for (const t of TABLES) response[t] = tableData[t].length;

    return json(response);
  } catch (err) {
    return json({ ok: false, error: String(err instanceof Error ? err.message : err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
