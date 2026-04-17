# Mane Line — Waitlist App (Cloudflare Worker + Supabase + Google Sheets)

A full waitlist app for **Mane Line by Silver Lining Herbs**: a beautiful multi-page landing site, magic-link signup with a horse profile, a secure per-user dashboard, and a real-time mirror of every signup into a Google Sheet for the comms engine.

> New to this stack? Good. Everything below is written in plain English. Budget 30–45 minutes for first-time end-to-end setup. Every step has a verify-it checkpoint.

---

## What you are deploying

| File | What it is | Where it runs |
|---|---|---|
| `worker.js` | Multi-page app: home, /join, /what-to-expect, /check-email, /dashboard, webhook forwarder | Cloudflare Worker |
| `wrangler.toml` | Cloudflare deploy config + env variable slots | Your laptop + Cloudflare |
| `supabase-schema.sql` | Database tables (`profiles`, `horses`), Row Level Security, auto-profile trigger | Supabase (one-time paste) |
| `google-apps-script.gs` | Tiny web service that writes waitlist rows into your Google Sheet | Google Apps Script Web App |
| `supabase/functions/nightly-backup/index.ts` | Layer 2 durable archive — nightly JSON/CSV snapshot to GitHub | Supabase Edge Function (Deno) |
| `client-context/CLIENT-ENGAGEMENT-SETUP-GUIDE.md` | Triple-redundancy ownership claim + verification drill | &mdash; |
| `playbooks/CLIENT-ONBOARDING-PHASE-0-PREFLIGHT.md` | Reusable consultant playbook: Intelligence &rarr; Phase 0 &rarr; Coming Soon | &mdash; |
| `playbooks/CLIENT-PRE-FLIGHT-CHECKLIST.md` | Client-facing checklist &mdash; hand to every new client at kickoff | &mdash; |
| `docs/TECH_DEBT.md` | Grep-friendly `TECH_DEBT(phase-N)` marker convention &mdash; every knowing shortcut gets tagged in-source and listed in this file | &mdash; |
| `README.md` | This file | &mdash; |

Architecture in one picture:

```
  Visitor ──HTTPS──▶ Cloudflare Worker ──serves HTML──▶ Browser
                                                        │
                                                        ▼
                                  Supabase (magic-link auth + DB with RLS)
                                                        │
                     on profile insert (webhook)        ▼
  Cloudflare Worker /webhook/sheets ◀──────────── Supabase
          │
          ▼
  Google Apps Script (web app) ──▶ Google Sheet (comms engine source)
```

---

## One-time setup — the whole sequence

There are 4 legs. Do them in order. Each one has a "you're good" check at the end.

### Leg 1 — Run the Supabase schema (5 min)

1. Open your Supabase project &rarr; left sidebar &rarr; **SQL Editor** &rarr; **New query**.
2. Open `supabase-schema.sql` in this folder, copy the whole file, paste into the editor.
3. Click **Run**. You should see "Success. No rows returned."

**Verify:** left sidebar &rarr; **Table Editor** &rarr; you should see `profiles` and `horses` listed under the `public` schema. Both should show a green shield icon meaning RLS is enabled.

### Leg 2 — Deploy the Google Apps Script (10 min)

1. Create a new Google Sheet. Name it **ManeLine Waitlist**.
2. In row 1 of Sheet1, paste this header row:
   ```
   timestamp | event | user_id | email | full_name | phone | location | discipline | marketing_opt_in
   ```
   (One cell per column — don't paste the `|` characters; that's just me showing you the columns.)
3. **Extensions &rarr; Apps Script**. Delete the default `Code.gs` contents. Paste the contents of `google-apps-script.gs`.
4. Generate a long random string (e.g., visit `https://1password.com/password-generator` and pick a 40-char password). Put it inside the quotes on the `SHARED_SECRET` line.
5. Click **Save** (disk icon).
6. Click **Deploy &rarr; New deployment**. Gear icon &rarr; pick **Web app**.
   - Description: "ManeLine Sheets mirror"
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**. Authorize when prompted.
7. Copy the **Web app URL**. Looks like `https://script.google.com/macros/s/XXXX/exec`. Save it somewhere — you'll paste it into a Cloudflare secret in Leg 4.

**Verify:** open the Web app URL in a browser tab. You should see `{"ok":true,"service":"maneline-sheets-mirror"}`.

### Leg 3 — Deploy the Cloudflare Worker (10 min)

Prerequisites: [Node.js LTS](https://nodejs.org) installed. Verify with `node --version`.

1. Open a terminal in this folder:
   ```bash
   cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
   ```
2. Log in to Cloudflare (one-time):
   ```bash
   npx wrangler login
   ```
3. Open `wrangler.toml` and paste your Supabase **Project URL** and **anon key** into the `[vars]` section. (Dashboard &rarr; Project Settings &rarr; API.)
4. Set the 3 secrets. Generate two more long random strings first (one for each secret below).
   ```bash
   npx wrangler secret put SUPABASE_WEBHOOK_SECRET
   npx wrangler secret put GOOGLE_APPS_SCRIPT_URL
   npx wrangler secret put GOOGLE_APPS_SCRIPT_SECRET
   ```
   Paste the values when prompted. `GOOGLE_APPS_SCRIPT_SECRET` must match the `SHARED_SECRET` you set in the Apps Script.
5. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints a URL like `https://maneline-coming-soon.yoursubdomain.workers.dev`.

**Verify:** open that URL. You should see the home page. Navigate to `/join`, fill in the form with your own email, submit. You should land on `/check-email` and receive a magic link in your inbox within 60 seconds. Click it. You should land on `/dashboard` and see your profile + your horse.

### Leg 4 — Wire the Supabase webhook to the Worker (5 min)

1. In Supabase: **Database** &rarr; **Webhooks** &rarr; **Create a new hook**.
2. Settings:
   - Name: `ManeLine profiles → Sheets`
   - Table: `profiles`
   - Events: check **Insert** (and optionally **Update**)
   - Type: **HTTP Request**
   - HTTP method: **POST**
   - URL: `https://<your-worker>.workers.dev/webhook/sheets`
   - HTTP Headers: add one header &mdash; **Name:** `x-webhook-secret` &nbsp;&nbsp; **Value:** the value you used for `SUPABASE_WEBHOOK_SECRET` above.
3. Click **Create webhook**.

**Verify:** sign up again with a different test email. Within ~5 seconds, a new row should appear in your Google Sheet.

### Leg 5 — Deploy the Layer 2 nightly GitHub backup (15 min)

This is the **durable, portable** leg of the triple-redundancy scheme described in `client-context/CLIENT-ENGAGEMENT-SETUP-GUIDE.md`. It nightly dumps the full `profiles` and `horses` tables as JSON + CSV into a private GitHub repo you control. If Supabase **and** Google both vanish tomorrow, this repo alone is a complete, portable archive of the business — openable in any text editor, forever.

Prerequisites:
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) installed. Verify with `supabase --version`.
- A GitHub account with admin rights on the target repo. In this setup the target is the already-agreed `JosiYoung/Databackup`.

#### 5a — Create the GitHub backup repo (2 min)

1. Log in to GitHub as `JosiYoung`.
2. Top right **+** &rarr; **New repository**.
3. Name: `Databackup`. Visibility: **Private**. Do NOT initialize with a README, .gitignore, or license &mdash; the Edge Function needs an empty default branch.
4. After creation, note the default branch name. GitHub defaults to `main`.

#### 5b — Provision a fine-grained Personal Access Token (3 min)

This is the only credential that can write to the backup repo. It is scoped as narrowly as GitHub allows — one repo, one permission.

1. GitHub &rarr; avatar &rarr; **Settings** &rarr; **Developer settings** &rarr; **Personal access tokens** &rarr; **Fine-grained tokens** &rarr; **Generate new token**.
2. Token name: `maneline-nightly-backup`.
3. Expiration: **90 days** (we rotate quarterly per the engagement guide §3).
4. Repository access: **Only select repositories** &rarr; pick `JosiYoung/Databackup`.
5. Permissions &rarr; **Repository permissions** &rarr; **Contents: Read and write**. Leave everything else at "No access."
6. Generate token. Copy the `github_pat_...` value — you won't see it again.

#### 5c — Link your Supabase project and set secrets (3 min)

```bash
cd "C:\Users\cedri\OneDrive\Desktop\Maneline.co"
supabase login
supabase link --project-ref <your-supabase-project-ref>
```

(Find the project-ref in your Supabase URL: `https://<project-ref>.supabase.co`.)

Set the secrets the Edge Function reads at runtime:

```bash
supabase secrets set GITHUB_TOKEN=github_pat_xxxxxxxxxxxx
supabase secrets set GITHUB_OWNER=JosiYoung
supabase secrets set GITHUB_REPO=Databackup
supabase secrets set GITHUB_BRANCH=main
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the Edge Functions platform — don't set them manually.

#### 5d — Deploy the function (1 min)

```bash
supabase functions deploy nightly-backup
```

#### 5e — Manual test invocation (1 min)

`supabase functions invoke` was removed from recent CLI versions. Hit the function directly instead. PowerShell:

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
  "snapshot_at": "2026-04-16T...",
  "profiles": 3,
  "horses": 4,
  "files_written": 10,
  "repo": "JosiYoung/Databackup",
  "branch": "main"
}
```

**Verify:** open `https://github.com/JosiYoung/Databackup` in a browser. You should see a new folder `snapshots/YYYY-MM-DD/` with `profiles.json`, `profiles.csv`, `horses.json`, `horses.csv`, `manifest.json`. You should also see a `LATEST/` folder with the same files. Click `profiles.csv` — GitHub renders it as a table. That table is the ownership claim made real.

#### 5f — Wire the cron schedule (2 min)

Supabase removed the dashboard "Schedules" tab, so `pg_cron` is the only path. In Supabase → **SQL Editor**:

```sql
-- enable the extensions once per project
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'maneline-nightly-backup',
  '0 7 * * *',  -- 07:00 UTC = midnight MST year-round (pg_cron is UTC-only)
  $$
    select net.http_post(
      url := 'https://<your-project-ref>.supabase.co/functions/v1/nightly-backup',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
      )
    );
  $$
);
```

Verify with `select jobname, schedule, active from cron.job;` — you want one row, `'0 7 * * *'`, active `true`.

**Verify:** tomorrow morning, re-open `JosiYoung/Databackup`. You should see a second dated folder under `snapshots/`. If you don't, Supabase &rarr; Edge Functions &rarr; `nightly-backup` &rarr; **Logs** shows why. Every successful run also updates `LATEST/manifest.json` — its `snapshot_at` field is the cheapest pulse check.

---

Your flow now looks like this:

1. A horse owner visits `maneline.co` (or your `*.workers.dev` URL).
2. They click **Join the Waitlist**, fill in themselves + their first horse.
3. They get a magic link → sign in → land on `/dashboard` with their barn already set up.
4. Supabase inserts a row in `profiles` → fires a webhook → the Worker forwards it → Google Sheet gets a row.
5. Your comms engine (Klaviyo, Mailchimp, Customer.io, Zapier, n8n, etc.) reads the Sheet and starts sending.

---

## Connect your custom domain (maneline.co)

1. Cloudflare dashboard &rarr; **Workers & Pages** &rarr; click your worker.
2. **Settings** &rarr; **Domains & Routes** &rarr; **Add Custom Domain**.
3. Enter `maneline.co` and also `www.maneline.co`.
4. If the domain is already in your Cloudflare account, DNS is automatic. If it's registered elsewhere, Cloudflare will give you nameservers to paste at the registrar. Propagation is usually under 5 minutes.

---

## Important: what Supabase also needs from you (Auth config)

For magic links to actually land where they should:

1. Supabase &rarr; **Authentication** &rarr; **URL Configuration**.
2. Set **Site URL** to your deployed URL (e.g., `https://maneline.co` or your `workers.dev` URL while testing).
3. Add the same URL to **Redirect URLs**. Also add `http://localhost:8787` while testing locally.
4. (Optional but recommended) **Authentication** &rarr; **Email Templates** &rarr; customize the magic-link email with Mane Line / Silver Lining branding.

If magic links arrive but clicking them lands on `/#error=access_denied`, 95% of the time your Site URL or Redirect URL is wrong.

---

## Privacy & isolation (what the schema guarantees)

- `profiles` table: RLS policies allow a user to **read and update only their own row**. No one can query other profiles.
- `horses` table: RLS policies allow full CRUD **only where `owner_id = auth.uid()`**. Nobody can see anyone else's horses.
- Inserts to `profiles` happen server-side via the `handle_new_user` trigger (fires on `auth.users` insert), so clients don't need insert privileges on `profiles`.
- The anon key you ship to the browser cannot bypass RLS — it's public by design.

To manually test isolation: sign up as user A, sign up as user B in an incognito window, then try `sb.from('horses').select('*')` from user B's console. You should only see user B's horses.

---

## Local development

```bash
npx wrangler dev
```
Serves at `http://localhost:8787`. Add this URL to your Supabase Redirect URLs before testing magic links locally.

Watch live traffic in production:
```bash
npx wrangler tail
```

---

## File roles (cheat sheet)

| When you want to… | Edit this |
|---|---|
| Change page copy or layout | `worker.js` — look for `pageHome`, `pageJoin`, etc. |
| Add/change horse fields | `supabase-schema.sql` (column) + `worker.js` (form + dashboard) |
| Change what writes to Sheets | `google-apps-script.gs` + `worker.js /webhook/sheets` |
| Change timeline/perks text | `worker.js` — `pageWhatToExpect` |
| Rotate a secret | `npx wrangler secret put NAME` |

---

## Troubleshooting quick hits

- **"Invalid API key" in the browser console** &rarr; `SUPABASE_ANON_KEY` in `wrangler.toml` doesn't match your project. Re-copy from Supabase &rarr; Settings &rarr; API.
- **Magic link email never arrives** &rarr; check spam; then check Supabase &rarr; Auth &rarr; Logs for bounce/delivery errors. Supabase's free SMTP throttles at 3/hour per email — swap for Resend/Postmark for production.
- **Magic link opens but dashboard is empty** &rarr; the `handle_new_user` trigger didn't run. Check Supabase &rarr; Database &rarr; Triggers, confirm `on_auth_user_created` exists and is enabled.
- **Webhook returns 401** &rarr; the `x-webhook-secret` header value in Supabase doesn't match `SUPABASE_WEBHOOK_SECRET` in the Worker.
- **Webhook returns 502** &rarr; the Apps Script URL is wrong, or the Apps Script `SHARED_SECRET` doesn't match `GOOGLE_APPS_SCRIPT_SECRET`.
- **Sheet gets rows but fields are empty** &rarr; the Supabase webhook payload shape changed, or the profiles row was created before metadata arrived. Check Leg 1 trigger.
- **Layer 2 Edge Function returns `GitHub PUT ... failed: 404`** &rarr; the repo doesn't exist, or the PAT isn't scoped to it. Confirm `JosiYoung/Databackup` exists, is not archived, and the fine-grained PAT lists it under "Only select repositories."
- **Layer 2 returns `GitHub PUT ... failed: 403` or `401`** &rarr; the PAT expired or was revoked. Regenerate (5b above), then `supabase secrets set GITHUB_TOKEN=<new-pat>`.
- **Layer 2 returns `missing SUPABASE_SERVICE_ROLE_KEY`** &rarr; you haven't deployed the function to a real Supabase project yet. Run `supabase link` then `supabase functions deploy nightly-backup`.
- **Schedule is set but no new commits after 48h** &rarr; check Supabase &rarr; Edge Functions &rarr; `nightly-backup` &rarr; Logs. If nothing is there, the schedule never fired — re-check the cron expression and Schedules UI.

---

## Next steps we might take after you're live

- Swap Supabase's default email sender for [Resend](https://resend.com) or Postmark (better deliverability and branded sender).
- Add a `/export` route (admin-only) that dumps everything to CSV.
- Add a referral system (each user gets a unique link; referrals bump them up the waitlist).
- Wire the dashboard to edit profile + horse fields in place.
- Start layering v1 features on top of the existing `profiles`/`horses` schema — that's the whole point of pre-populating now.
