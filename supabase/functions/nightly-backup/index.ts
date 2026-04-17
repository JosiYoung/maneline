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

async function loadTable(client: SupabaseClient, table: string) {
  const { data, error } = await client.from(table).select("*").order("created_at", { ascending: true });
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
    ] as const;

    const tableData: Record<string, Record<string, unknown>[]> = {};
    const results = await Promise.all(TABLES.map((t) => loadTable(client, t)));
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
      version: "2.0",
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
