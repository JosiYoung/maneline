# nightly-backup — Layer 2 Edge Function

This is the **Layer 2** durable-truth store of the ManeLine triple-redundancy scheme. It runs on Supabase Edge Functions (Deno) once per night at **07:00 UTC (midnight MST year-round)**, reads `profiles` and `horses`, and commits JSON + CSV snapshots to the client-owned GitHub repo.

See the parent `client-context/CLIENT-ENGAGEMENT-SETUP-GUIDE.md` for why this exists. See the repo-root `README.md` **Leg 5** for full deployment steps.

## What gets written

Every run creates these files on `main`:

```
snapshots/YYYY-MM-DD/profiles.json
snapshots/YYYY-MM-DD/profiles.csv
snapshots/YYYY-MM-DD/horses.json
snapshots/YYYY-MM-DD/horses.csv
snapshots/YYYY-MM-DD/manifest.json
LATEST/profiles.json
LATEST/profiles.csv
LATEST/horses.json
LATEST/horses.csv
LATEST/manifest.json
```

Snapshots are retained forever (Git history is immutable). `LATEST/` is overwritten each night so a human can grab the current state without hunting a date folder.

## Environment variables

Platform-injected (do not set manually):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Set by you via `supabase secrets set`:
- `GITHUB_TOKEN` — fine-grained Personal Access Token. **Only** "Contents: read & write" on the Databackup repo. Nothing else. Rotate quarterly.
- `GITHUB_OWNER` — `JosiYoung` (default)
- `GITHUB_REPO` — `Databackup` (default)
- `GITHUB_BRANCH` — `main` (default)

## Manual invocation (for testing)

`supabase functions invoke` was removed from recent CLI versions. Use a direct HTTP call instead. PowerShell:

```powershell
Invoke-RestMethod `
  -Method POST `
  -Uri "https://<project-ref>.supabase.co/functions/v1/nightly-backup" `
  -Headers @{ Authorization = "Bearer <SUPABASE_ANON_KEY>" }
```

or bash:

```bash
curl -X POST \
  -H "Authorization: Bearer <SUPABASE_ANON_KEY>" \
  "https://<project-ref>.supabase.co/functions/v1/nightly-backup"
```

Expected response:

```json
{
  "ok": true,
  "snapshot_at": "2026-04-16T02:00:01.123Z",
  "profiles": 3,
  "horses": 4,
  "files_written": 10,
  "repo": "JosiYoung/Databackup",
  "branch": "main"
}
```

## Scheduling

The Supabase Dashboard "Schedules" tab on Edge Functions has been removed. `pg_cron` is the supported path. Run this once in the SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'maneline-nightly-backup',
  '0 7 * * *',  -- 07:00 UTC = midnight MST year-round
  $$ select net.http_post(
       url:='https://<project-ref>.supabase.co/functions/v1/nightly-backup',
       headers:=jsonb_build_object(
         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
       )
     ); $$
);
```

Verify: `select * from cron.job;` — you should see one row with `schedule = '0 7 * * *'` and `active = true`.
