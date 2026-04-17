# Phase 0 — Client Pre-Flight Playbook

**Purpose:** A repeatable onboarding playbook for every client engagement, independent of the app we build on top. Phase 0 delivers **the data-ownership foundation** — triple-redundant storage, verifiable custody, and a cutover-ready runtime — before a single line of client-specific product code ships.

**Pilot engagement:** Mane Line by Silver Lining Herbs (April 2026). Every troubleshooting entry below was learned the hard way during that build.

**Document status:** Living. Any new client bug that takes more than 10 minutes to diagnose gets a new entry in §7. That is how this document stays valuable over time.

---

## 0. The engagement arc — Intelligence → Phase 0 → Coming Soon Launch

Every client engagement follows the same three-step arc. **Do them in order.** Skipping or reordering any one of them is the single biggest source of wasted work in the whole playbook.

### 0.1 The end goal — the one sentence that defines "done"

> **"By the end of this engagement, the client has a live, branded, triple-redundant *Coming Soon* page on their own custom domain — with a verifiable data-ownership claim they can honestly make to their customers — before a single line of product code ships."**

Everything below is how we get there. If a proposed step doesn't move the needle toward that sentence, cut it.

### 0.2 The three steps, in order

| # | Step | What it produces | Typical duration |
|---|---|---|---|
| 1 | **Intelligence** — pre-engagement research on the client | A single `Intelligence.md` brief. Who they are, who they serve, how they talk, where they're trying to go. | 2–4 hours (one sitting) |
| 2 | **Phase 0 Pre-Flight** — data-ownership foundation | Triple-redundant infra live, custody transferred, verification drill passed. See §3 (Legs A–G). | 2–3 days of consultant time across ~1 week elapsed |
| 3 | **Coming Soon Launch** — public-facing landing page on the custom domain | Branded waitlist page capturing signups into the triple-redundant system. First real data in the pipe. | 1–2 days of consultant time |

### 0.3 Why this order is non-negotiable (first principles)

- **Intelligence before Phase 0:** Phase 0 involves real decisions — which L1 destination (Sheets vs. Airtable vs. HubSpot), which domain, which email sender, who holds which credential. You cannot make those calls without first understanding how the client already operates. Skip Intelligence and you rebuild Phase 0 twice.
- **Phase 0 before Coming Soon:** The landing page's entire reason for existing is *capturing waitlist signups that you can honestly promise to protect*. If the triple-redundant pipeline isn't live when the page goes up, every signup is a liability, not an asset. Launch the page into the void only after the safety net is verified.
- **Coming Soon before Product:** Coming Soon validates the pipeline, the domain cutover, the comms path, and the ownership claim with *real users*, at zero product risk. By the time Phase 1 (the actual product) ships, the boring infrastructure is already proven in the wild.

### 0.4 What Intelligence covers — the reusable brief template

The Intelligence deliverable is one markdown file, dropped into the client's `client-context/` folder at the start of Phase 0. It answers six questions; nothing more, nothing less.

| Section | The question it answers | Where the data comes from |
|---|---|---|
| **Company snapshot** | Founded when, by whom, where. Ownership structure. Revenue range. Core offer. | Public web research + 30-min founder/owner interview |
| **Customer segments** | Who buys today? Primary vs. secondary. What "job" does the product do for them? | Client interview + reviews audit + testimonials |
| **Competitive landscape** | Who else plays here? What do they do well? Where are the gaps the client can own? | Web research + competitor product walkthroughs |
| **Brand voice** | How does the client already talk? Words they use. Words they avoid. Tone. | Their website, social, podcast/video, customer reviews |
| **Strategic positioning** | Where does this engagement plant them competitively? What is the "so what"? | Synthesis — the consultant's analytical contribution |
| **Signal quotes** | 5–10 verbatim customer/founder quotes we can pull from for landing copy | Reviews + interview transcripts |

**Reference template:** `client-context/Intelligence.md` in the Mane Line repo is the pilot example — adapt the structure for every new engagement.

### 0.5 How Intelligence feeds Phase 0 (the handoff, concretely)

Intelligence doesn't sit in a drawer. Specific outputs of Intelligence plug directly into specific Phase 0 legs:

| Intelligence output | Phase 0 leg it unblocks | Why |
|---|---|---|
| List of vendor accounts the client already owns | Leg A (account provisioning) | Don't duplicate accounts — reuse what exists |
| Comms platform (Google Workspace / Microsoft 365 / other) | Leg D (L1 destination choice) | Destination must match where the client's humans already live |
| Domain name + current DNS host | Leg F (runtime cutover) | Determines whether we do an inter-account transfer or a nameserver repoint |
| Brand voice + signal quotes | Coming Soon page copy (Phase 0.3 deliverable) | Prevents a generic "get notified" page — the voice must sound like the client |
| Strategic positioning | Coming Soon value-prop headline | One clear sentence of why this matters, lifted from the Intelligence synthesis |
| Ownership structure | Leg A + Custody Matrix (§5) | Determines who signs up for what; a sole-proprietor client holds everything, a multi-partner client splits custody |

### 0.6 Intelligence gate — do not start Phase 0 until all six are checked

- [ ] Company snapshot complete (≥ 1 paragraph per sub-item)
- [ ] Customer segments named and prioritized (P1 / P2 / P3)
- [ ] At least 3 competitors reviewed with screenshots / notes
- [ ] Brand voice captured (≥ 5 "words they use" + ≥ 3 "words they avoid")
- [ ] Strategic positioning distilled to one sentence
- [ ] ≥ 5 signal quotes extracted with attribution

If any box is unchecked, Phase 0 is premature. Go back and finish the brief. The ~2 hours you save on Intelligence cost ~20 hours of rework in Phase 0.

### 0.7 Client-side Pre-Flight — what the client must prepare

Intelligence is consultant-side work. In parallel, the **client** has their own short checklist: confirm the anchor email, grant Google Workspace access, confirm registrar access, block a 60-min window for Leg A account creation. That list lives in its own deliverable — hand the client `CLIENT-PRE-FLIGHT-CHECKLIST.md` at engagement kickoff.

The GitHub-first SSO chain (create GitHub → use "Continue with GitHub" for Cloudflare and Supabase → invite consultant to Google Workspace) is the anchor rule. It is specified in detail in Leg A (§3) and summarized for the client in the checklist above.

**Phase 0 does not start until both are green:** Intelligence gate (§0.6) and client Pre-Flight checklist (signed).

---

## 1. Why Phase 0 exists — the first principle

Clients don't buy software; they buy **outcomes they can keep when the vendor goes away.** Every Phase 0 engagement must end with the client able to say, truthfully, to their own customers:

> *"Your data is in our account, on our infrastructure, under our credentials. If our tech partner disappears tomorrow, nothing changes for you."*

Marketing can't back that claim. Architecture can. Phase 0 is the architecture.

**The rule:** after Phase 0, we (the consultancy) must be deletable from every production credential without the client losing access to their data. If that isn't true, Phase 0 isn't done.

---

## 2. What Phase 0 delivers — the universal stack

| Layer | System | Role | Cadence |
|---|---|---|---|
| **L0 — Source of truth** | Supabase Postgres + Auth + RLS | Primary database, user-scoped, server-enforced isolation | Real-time |
| **L1 — Real-time human layer** | Supabase webhook → Cloudflare Worker → client-owned destination (Google Sheets, Airtable, etc.) | Operational visibility + comms engine input | Real-time on insert/update |
| **L2 — Durable truth store** | Supabase Edge Function (cron) → private GitHub repo, JSON + CSV | Portable, open-format archive. Zero vendor lock-in. | Nightly |
| **Runtime** | Cloudflare Worker on client's custom domain | The app / landing page / dashboard | Edge-served |
| **Custody** | Every asset registered to a client account, never a vendor/consultant account | Deletable-consultant guarantee | One-time |

Architecture in one picture:

```
 Visitor ──HTTPS──▶ Cloudflare Worker (client account) ──HTML──▶ Browser
                                                                │
                                                                ▼
                             Supabase (client org, magic-link auth, Postgres + RLS)
                                                                │
                              on row insert (webhook)           ▼
 Cloudflare Worker /webhook/{destination} ◀──────────── Supabase
          │
          ▼
 Comms destination (client-owned Google/Airtable/etc.)

                              nightly cron ▼
 Supabase Edge Function ──────▶ private GitHub repo (client-owned)
```

**Client-specific pieces** (the app layer — built in Phase 1+):
- Page copy, branding, form fields, dashboard behavior
- Schema extensions (domain tables beyond profiles/core)
- Business logic in Worker or Edge Functions
- Third-party integrations (payments, comms automation, etc.)

**Phase 0 pieces** (constant across clients):
- Everything in the table above
- Custody model and verification drill
- Troubleshooting repertoire
- Engagement guide deliverable

---

## 3. Phase 0 delivery sequence

Do these in order. Each leg has a verify-it checkpoint. **Do not skip a checkpoint** — each one catches a specific failure mode the next leg depends on.

### Leg A — Client accounts created and verified (Day 1, 45–60 min)

Before any infrastructure is provisioned, every vendor account must be registered to a business email the **client** controls, not the consultant. Custody starts at account creation; retrofitting it later is painful.

#### A.1 The GitHub-first SSO chain (the lean pattern)

Do not create four separate username+password logins. Do this instead:

1. **Create the client's GitHub account first.** Register it with the client's business email (e.g., `owner@clientco.com`). This account becomes the **identity anchor** for everything else.
2. **Sign into Cloudflare with "Continue with GitHub"** on the Cloudflare signup page. No separate password. No second verification email chain.
3. **Sign into Supabase with "Continue with GitHub"** on the Supabase signup page. Same deal.
4. **Google Workspace is the one exception** — Google does not support "Sign in with GitHub." The client must own the Workspace directly and invite the consultant as a delegated user (see A.3).
5. **Domain registrar** — use whatever the client already owns. Usually no new account is created; the consultant just needs DNS access (see Leg F / §6).

**Why this pattern:** one credential (GitHub) becomes the root of trust for three vendors. Rotating the consultant out of the engagement later means the client revokes one OAuth grant per vendor, not resets four passwords. Also: fewer emails to the client during setup, fewer 2FA codes to relay, fewer places for a weak password to exist.

#### A.2 Verification code relay protocol

Every vendor sends a verification code to the client's business email at account creation. The consultant cannot see the client's inbox. Process:

1. Before you start Leg A, book a **60-minute window** with the client where they are at their keyboard with their email open.
2. When a verification email arrives (GitHub → Cloudflare → Supabase, in that order), the client **forwards or screenshots the code to the consultant within 10 minutes.** After that, most codes expire.
3. The consultant enters the code in the vendor's UI. Confirm the account is verified (look for the green checkmark / "email verified" badge) before moving to the next vendor.
4. Log each account in the Custody Matrix (§5) as you complete it. A partially-verified account is the silent killer of Leg B.

**Failure mode to avoid:** do not try to do Leg A asynchronously ("I'll send you the verification link, you enter it whenever"). Codes expire. The client gets pulled into a meeting. You come back 90 minutes later and have to re-send. The hour saved is an hour added.

#### A.3 Google Workspace — the one access-grant exception

Google does not let the consultant create a Workspace on behalf of the client. The client must:

1. Own (or create) a Google Workspace subscription on their domain. If they're on a free `@gmail.com` address, that's a downgrade signal — recommend upgrading to Workspace for production comms.
2. **Invite the consultant** as a user or delegated admin under **Admin Console → Users → Add new user** (or grant Editor access to the specific Google Sheet / Drive folder if scope is narrow).
3. Verify the consultant can log in to the invited account before Leg D starts. Do this in an incognito window to avoid account-mixing.

The consultant's Google access is the only credential the client cannot revoke with a single OAuth click. Make that explicit in the Custody Matrix: "Client controls Workspace; consultant is an invited user, removable via Admin Console."

#### A.4 Leg A account checklist

| Account | Created by | Auth method | Verification | Logged in Custody Matrix |
|---|---|---|---|---|
| GitHub | Consultant (on client's laptop or client relays code) | Email + password | Email code relayed within 10 min | ✅ required |
| Cloudflare | Consultant | **Sign in with GitHub** (OAuth) | Email verification on CF side | ✅ required |
| Supabase | Consultant | **Sign in with GitHub** (OAuth) | Usually none beyond GitHub | ✅ required |
| Google Workspace | **Client** (consultant cannot) | Client's own Google auth + 2FA | Client confirms consultant invite landed | ✅ required |
| Domain registrar | Already owned by client | Client's existing login | Consultant only needs DNS access, not registrar login | ✅ required |

**Why verification first:** Cloudflare inter-account zone transfers (§6) require a verified target account. Supabase Edge Function deploys require a project-ref, which doesn't exist until the project is created. Skipping verification on any one of these costs ~30 min of rework later.

**Client-facing deliverable:** Hand the client `playbooks/CLIENT-PRE-FLIGHT-CHECKLIST.md` **before** Leg A kicks off. That checklist tells them exactly what they need to do (invite you to Google, be at their keyboard for the 60-min window, forward codes) in plain English. A prepared client turns Leg A from 90 minutes of friction into 45 minutes of execution.

**Checkpoint:** All five rows in §A.4 green. Consultant is signed in to GitHub, Cloudflare, and Supabase via the OAuth chain, and has confirmed-working access to the client's Google Workspace. Zero separate passwords to rotate later.

### Leg B — Supabase project + schema + RLS (Day 1, 45 min)

1. **Create the Supabase project** in the client org. Region closest to client's primary customer base. Note the project-ref (the subdomain before `.supabase.co`).
2. **Deploy the schema.** Every engagement ships with at minimum a `profiles` table keyed to `auth.users(id)`, plus a `handle_new_user()` trigger that promotes signup metadata into the profile. Client-specific tables layer on top.
3. **Enable RLS on every table.** Every single one. No exceptions. Policies: `select/update using (auth.uid() = id)` on profiles, `owner_id = auth.uid()` on any user-owned child table.
4. **Verify RLS is actually on.** Do not trust the UI badge — it is unreliable and has misled us before. Run this SQL and keep the output in the engagement record:

   ```sql
   select
     c.relname as table_name,
     c.relrowsecurity as rls_enabled,
     (select count(*) from pg_policies p where p.tablename = c.relname) as policy_count
   from pg_class c
   join pg_namespace n on c.relnamespace = n.oid
   where n.nspname = 'public' and c.relkind = 'r';
   ```

   Every table must show `rls_enabled = true` AND `policy_count > 0`. A table with RLS on but no policies blocks *all* access — that's a silent outage waiting to happen.

5. **Functional RLS test.** From a browser on any real webpage (NOT a `chrome://` internal page — CSP blocks it), open DevTools console and run:

   ```js
   const SUPABASE_URL = '<project-url>';
   const ANON_KEY = '<anon-key>';
   const r = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, {
     headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` }
   });
   console.log(r.status, await r.json());
   ```

   Must return `200 []`. An empty array from an anonymous request proves RLS is enforcing. A populated array means RLS is off or misconfigured and is a P0 defect.

**Checkpoint:** RLS-enforced database, schema deployed, anonymous queries return empty arrays.

### Leg C — Cloudflare Worker baseline (Day 1, 30 min)

1. **Create `wrangler.toml`** with real `[vars]` values:
   ```toml
   name = "<client>-<app>"
   main = "worker.js"
   compatibility_date = "<today>"
   [vars]
   SUPABASE_URL = "https://<project-ref>.supabase.co"
   SUPABASE_ANON_KEY = "<anon-key>"
   ```
   **Never commit placeholders.** Never put secrets in `[vars]` — only secrets go through `wrangler secret put`.

2. **Install wrangler** (client-side or consultant-side, depending on custody model): `npm install -g wrangler` or use `npx wrangler` from the project folder.

3. **First deploy** uses your Cloudflare account to get the worker live; transfer to the client's account happens in Leg F. Deploy to `*.workers.dev` as an intermediate step.

4. **Set secrets** (same list every engagement, with client-specific values):
   ```bash
   npx wrangler secret put SUPABASE_WEBHOOK_SECRET
   npx wrangler secret put <other-destination-secrets>
   ```

**Checkpoint:** `https://<worker-name>.workers.dev` returns the app's home page.

### Leg D — L1 real-time mirror (Day 2, 45 min)

1. **Create the destination** in the client's account (Google Sheet, Airtable base, whatever).
2. **Create the receiver** — usually a Google Apps Script web app deployed as "Anyone" access, authenticated via a shared secret header we control.
3. **Set the receiver URL and shared secret as Worker secrets:**
   ```bash
   npx wrangler secret put GOOGLE_APPS_SCRIPT_URL
   npx wrangler secret put GOOGLE_APPS_SCRIPT_SECRET
   ```
4. **Wire the Supabase webhook:**
   - Dashboard → Database → Webhooks → Create
   - Table: `profiles` (or whatever L1 ships)
   - Events: Insert (optionally Update)
   - HTTP method: POST
   - URL: `https://<worker>/webhook/<destination>`
   - Custom header: `x-webhook-secret: <value matching SUPABASE_WEBHOOK_SECRET>`

**Checkpoint:** A test signup → a new row appears in the destination within 5 seconds.

### Leg E — L2 nightly GitHub snapshot (Day 2, 60 min)

This is the durability layer. It is what makes the ownership claim enforceable.

1. **Client creates a private GitHub repo.** Empty — no README, no license, no .gitignore. The Edge Function needs an empty default branch.
2. **Client provisions a fine-grained PAT** scoped to:
   - Only select repositories: `<org>/<repo-name>`
   - Repository permissions: Contents = Read and write
   - Everything else: No access
   - Expiration: 90 days (rotate quarterly)
3. **Install Supabase CLI** if not already done. On Windows: `scoop install supabase` (after `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git`). Do not use npm — Supabase does not support it and the shim breaks on `functions deploy`.
4. **Link the project:**
   ```powershell
   supabase login
   supabase link --project-ref <project-ref>   # subdomain only, NOT full URL
   ```
5. **Set function secrets:**
   ```bash
   supabase secrets set GITHUB_TOKEN=<pat>
   supabase secrets set GITHUB_OWNER=<owner>
   supabase secrets set GITHUB_REPO=<repo-name>
   supabase secrets set GITHUB_BRANCH=main
   ```
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by the Edge Functions platform. Do not set them manually.
6. **Deploy the function:**
   ```bash
   supabase functions deploy nightly-backup
   ```
7. **Manual invocation** — `supabase functions invoke` is deprecated in recent CLI versions. Use HTTP:
   ```powershell
   Invoke-RestMethod `
     -Uri "https://<project-ref>.supabase.co/functions/v1/nightly-backup" `
     -Method POST `
     -Headers @{ "Authorization" = "Bearer <anon-key>"; "Content-Type" = "application/json" } `
     -Body "{}"
   ```
   Expected response: `{ ok: true, snapshot_at: ..., profiles: N, horses: N, files_written: 10, ... }`.

8. **Schedule via pg_cron.** The old per-function Schedules tab was removed. Use SQL:
   ```sql
   create extension if not exists pg_cron;
   create extension if not exists pg_net;

   select cron.schedule(
     '<client>-nightly-backup',
     '0 7 * * *',  -- midnight MST (UTC-7). See §7 "UTC-only cron" gotcha.
     $$
       select net.http_post(
         url := 'https://<project-ref>.supabase.co/functions/v1/nightly-backup',
         headers := jsonb_build_object(
           'Content-Type','application/json',
           'Authorization','Bearer <anon-key>'
         ),
         body := '{}'::jsonb
       );
     $$
   );
   ```

**Checkpoint:** Manual invocation returns `ok:true`; GitHub repo shows `snapshots/<today>/*` and `LATEST/*`; `cron.job` shows the scheduled entry as `active=true`.

### Leg F — Custody transfer + custom domain (Day 3, 30 min)

Every asset must end up in a client-owned account. If anything is still in a consultant account at this point, Phase 0 is not done.

1. **Supabase project:** already in client org from Leg B.
2. **Cloudflare Worker:** transfer by re-deploying from client's Cloudflare account:
   ```powershell
   npx wrangler logout
   npx wrangler login         # authenticate as CLIENT
   npx wrangler whoami        # confirm client account before proceeding
   npx wrangler deploy
   # Re-set all secrets (account-scoped, don't transfer):
   npx wrangler secret put SUPABASE_WEBHOOK_SECRET
   npx wrangler secret put GOOGLE_APPS_SCRIPT_URL
   npx wrangler secret put GOOGLE_APPS_SCRIPT_SECRET
   ```
   Then delete the Worker from the consultant account.
3. **Domain cutover.** Path depends on where it's registered today (see §6).
4. **Update Supabase Auth config** — this is the single easiest step to forget and the most expensive when forgotten:
   - Authentication → URL Configuration → Site URL = `https://<clientdomain>`
   - Redirect URLs = `https://<clientdomain>/**` + `https://www.<clientdomain>/**`
5. **Brand BOTH email templates:** Confirm Signup (new users) and Magic Link (returning users). See §7.
6. **GitHub repo:** already owned by the client per Leg E.
7. **Google Sheet / destination:** already owned by the client per Leg D.

**Checkpoint:** §8 verification drill passes end-to-end with the client driving, consultant only observing.

### Leg G — Engagement guide delivery + handoff (Day 3, 30 min)

1. **Deliver the Client Engagement Setup Guide** (custody matrix, verification drill, incident response). Reference template: `client-context/CLIENT-ENGAGEMENT-SETUP-GUIDE.md` in the Mane Line repo — copy + adapt per engagement.
2. **Calendar invite for quarterly verification drills.** First Monday of each quarter.
3. **Credential rotation schedule.** GitHub PAT rotates every 90 days. Supabase anon key on compromise only.
4. **Runbook for P1 incidents** (forthcoming per client engagement).

**Phase 0 complete.** Engagement moves to Phase 1 (client-specific app build).

---

## 4. The universal custody matrix template

Populate per client. Every row must resolve to a **client human** in the "Who holds the key" column. No consultant-only rows.

| Asset | Registered to | Who holds the key | Portable? | Portability method |
|---|---|---|---|---|
| Supabase project | Client org | Client admin + consultant (removable) | Yes | `pg_dump` |
| Cloudflare Worker + DNS | Client Cloudflare account | Client admin + consultant (removable) | Yes | Worker code in repo; DNS moves with domain |
| Webhook destination (Sheet/Airtable/etc.) | Client Google/vendor account | Client admin | Yes | Native export |
| GitHub backup repo | Client org or owner account | Client admin | Yes | Standard Git, cloneable anywhere |
| Receiver script (if any) | Client account | Client admin | Yes | Source is in this repo |

**The deletable-consultant test:** pick any row, mentally delete the consultant's access, and ask "can the client still operate the system?" If no for any row, fix before Phase 0 closeout.

---

## 5. The universal pre-flight checklist (copy this per client)

Layer legend:
- **L0** = Supabase Postgres primary (real-time source of truth)
- **L1** = Real-time human-visible mirror (Google Sheet / Airtable / etc.)
- **L2** = Nightly durable archive (private GitHub repo, JSON + CSV)
- **Runtime** = Cloudflare Worker on client-owned custom domain
- **Custody** = Every asset registered to a client account

**Triple-redundancy is not optional.** A Phase 0 engagement that ships with only one or two of the three data layers is not Phase 0 — it's a half-built product and the ownership claim is unenforceable. Every Phase 0 closeout must pass §8.2 below.

```
CLIENT: ___________________________
ENGAGEMENT KICKOFF: _______________

Leg A — Client accounts (Custody foundation)
[ ] Supabase org created, billing set, email verified
[ ] Cloudflare account created, verified, Account ID captured
[ ] GitHub org / owner account ready
[ ] L1 destination account ready (Google/Airtable/etc.)
[ ] Domain registrar access confirmed

Leg B — Supabase project + schema  (LAYER L0)
[ ] Project created in client org; project-ref recorded
[ ] Schema deployed
[ ] RLS SQL verification passes (all tables rls_enabled=true, policy_count>0)
[ ] Functional RLS test returns 200 []
[ ] L0 PROOF: insert a test row; confirm it appears in Table Editor

Leg C — Cloudflare Worker baseline  (Runtime)
[ ] wrangler.toml authored with real [vars], no placeholders
[ ] Worker deploys to *.workers.dev
[ ] SUPABASE_WEBHOOK_SECRET set
[ ] Other destination secrets set

Leg D — Real-time mirror  (LAYER L1)
[ ] Destination created in client account
[ ] Receiver deployed (Apps Script or equivalent)
[ ] GOOGLE_APPS_SCRIPT_URL / equivalent secret set
[ ] GOOGLE_APPS_SCRIPT_SECRET / equivalent set
[ ] Supabase webhook wired with x-webhook-secret header
[ ] L1 PROOF: test signup produces destination row within 5 seconds

Leg E — Nightly durable archive  (LAYER L2)
[ ] Private repo created in client account (empty, no README/license/gitignore)
[ ] Fine-grained PAT provisioned — scoped to one repo, Contents R/W only
[ ] PAT expiration recorded for 90-day rotation
[ ] Supabase CLI installed and working (`supabase --version`)
[ ] Project linked (`supabase link --project-ref <ref>`)
[ ] GITHUB_TOKEN / OWNER / REPO / BRANCH secrets set
[ ] `supabase functions deploy nightly-backup` succeeds
[ ] L2 PROOF: manual HTTP invocation returns ok:true
[ ] L2 PROOF: GitHub repo shows snapshots/<today>/ and LATEST/ with non-empty files
[ ] pg_cron job scheduled and active (verify: cron.job shows active=true)
[ ] Timezone decision documented in client engagement guide (MST/local/UTC)

Leg F — Custody transfer + custom domain  (Custody completion)
[ ] Worker re-deployed from client Cloudflare account (wrangler whoami confirmed)
[ ] All Worker secrets re-set in client account (account-scoped, don't transfer)
[ ] Old Worker deleted from consultant account
[ ] Domain transferred or DNS pointed per §6 scenario
[ ] Supabase Site URL updated to client domain
[ ] Supabase Redirect URLs updated (wildcard entries for apex + www)
[ ] Confirm Signup email template branded
[ ] Magic Link email template branded
[ ] Custody matrix (§4) populated — every row has a client human in "holds the key"

Leg G — Handoff
[ ] Engagement guide delivered
[ ] Quarterly drill calendar invites created in client's shared calendar
[ ] PAT rotation date recorded (90 days out)
[ ] §8.1 verification drill passed with client driving
[ ] §8.2 triple-redundancy proof passed (all three layers independently verified)

═══════════════════════════════════════════════════════════
PHASE 0 CLOSEOUT GATE — all of the following must be true:
═══════════════════════════════════════════════════════════
[ ] L0 is live: test row exists in Supabase, RLS enforced
[ ] L1 is live: same row visible in L1 destination within 5 seconds
[ ] L2 is live: same row appears in next nightly GitHub snapshot,
    AND manual invocation already produced a dated snapshot today
[ ] Custody matrix has zero consultant-only rows
[ ] Deletable-consultant test passed: mentally remove consultant
    access to each asset; client can still operate all three layers

SIGN-OFF:
Consultant: ___________________  Date: _________
Client:     ___________________  Date: _________
```

---

## 6. Domain cutover scenarios

`<clientdomain>` may be in any of four states when Phase 0 starts. Know which before you touch anything.

| State | Path |
|---|---|
| Registered at Cloudflare Registrar, in consultant's Cloudflare account | **Transfer Zone** feature inside Cloudflare: Registrar tab → Transfer Domain → paste client Account ID → client accepts. Zero downtime. |
| Registered at external registrar (GoDaddy/Namecheap/etc.), DNS in consultant Cloudflare | Client adds site to their Cloudflare → changes nameservers at registrar → removes from consultant Cloudflare. Small propagation window (<1 hr typically). |
| Already in client's Cloudflare account | Skip to "Add Custom Domain" on Worker. 60-second activation. |
| Registered elsewhere, DNS stays elsewhere | Manually add CNAME at current DNS host to the target Cloudflare gives you. Last resort. Some providers block CNAME at root — forces Scenario 2. |

After any scenario: attach `<clientdomain>` + `www.<clientdomain>` to the Worker via Cloudflare dashboard → Workers & Pages → <worker> → Settings → Domains & Routes → Add Custom Domain. Then update Supabase Site URL per Leg F step 4.

---

## 7. Troubleshooting catalog (every bug we hit, documented)

Every entry here is a real failure mode from the Mane Line pilot. When a new client hits something, add it below with the date and fix so the catalog compounds in value.

### 7.1 RLS "green shield" indicator missing or misleading

**Symptom:** You enabled RLS via SQL, but the Supabase dashboard's green-shield UI indicator doesn't show.

**Fix:** Do not trust the UI. Use the SQL verification query in §3 Leg B step 4. `pg_class.relrowsecurity = true` and at least one policy in `pg_policies` is the ground truth. The UI badge lags or misreports.

### 7.2 RLS verification attempted on a `chrome://` page

**Symptom:** DevTools console throws CSP errors when you try `fetch(SUPABASE_URL, ...)`.

**Fix:** Chrome internal pages (`chrome://`, `about:blank`, new tabs) enforce CSP that blocks external network calls. Navigate to any real webpage (google.com, example.com, the client's own site) first, then open DevTools and run the test.

### 7.3 `wrangler.toml` ships with placeholder values

**Symptom:** Browser console shows `ERR_NAME_NOT_RESOLVED` attempting to reach `your-project-ref.supabase.co`.

**Fix:** Check `wrangler.toml` `[vars]` block. Every engagement, put the real Supabase URL and anon key there before first deploy. Never paste secrets into comments "for later" — they get forgotten and leak.

### 7.4 Supabase CLI not found after install

**Symptom:** `supabase --version` → "not recognized as a cmdlet."

**Fix:** Two causes:
- Installed via npm (unsupported). Uninstall and use `scoop install supabase`.
- Installed correctly but PowerShell hasn't refreshed PATH. Close the window and open a new one, OR run:
  ```powershell
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  ```

### 7.5 `supabase link` rejects the project-ref

**Symptom:** `Invalid project ref format. Must be like 'abcdefghijklmnopqrst'.`

**Fix:** The project-ref is the 20-character subdomain, not the full URL. Not `https://xxx.supabase.co`, not `<https://xxx.supabase.co>`, just `xxx`. PowerShell's `<...>` also interprets as input redirection — don't wrap anything in angle brackets.

### 7.6 `supabase functions invoke` command doesn't exist

**Symptom:** `invoke` is missing from the available subcommands list.

**Fix:** Removed in recent CLI versions. Invoke via HTTP instead:
```powershell
Invoke-RestMethod -Uri "https://<ref>.supabase.co/functions/v1/<fn>" `
  -Method POST `
  -Headers @{ "Authorization"="Bearer <anon-key>"; "Content-Type"="application/json" } `
  -Body "{}"
```

### 7.7 Schedules tab missing on Edge Function

**Symptom:** Dashboard → Edge Functions → your function → no Schedules tab.

**Fix:** The tab was consolidated into a project-level Cron area (Integrations → Cron) or removed entirely on older projects. Always use `pg_cron` + `pg_net` as the canonical path — it works on every project, is inspectable via SQL, and survives dashboard redesigns.

### 7.8 pg_cron fires at wrong time (UTC vs local)

**Symptom:** You scheduled "midnight" but it runs at noon local.

**Fix:** `pg_cron` runs in UTC always. No DST. Calculate:
- Midnight MST = 07:00 UTC year-round → `'0 7 * * *'`
- Midnight MDT (summer) = 06:00 UTC → `'0 6 * * *'`
- Midnight EST = 05:00 UTC → `'0 5 * * *'`
- Midnight PST = 08:00 UTC → `'0 8 * * *'`

Rule of thumb: run `(Get-Date).ToUniversalTime()` in PowerShell before scheduling to anchor your mental model.

### 7.9 pg_cron placeholder text pasted literally

**Symptom:** `ERROR: 22023: invalid schedule: <minute> <hour> * * *`

**Fix:** Placeholders in angle brackets must be replaced with real numbers before running. There is no fix inside Postgres — you have to edit the SQL.

### 7.10 `net.http_request_queue` column mismatch

**Symptom:** `ERROR: 42703: column "created" does not exist`

**Fix:** `pg_net` schema varies by version. Query `net._http_response` instead — it has stable columns (id, status_code, created, error_msg). For requests, just `select * from net.http_request_queue limit 1` to see what columns your version has.

### 7.11 `net._http_response` shows `status_code = NULL`

**Symptom:** Cron ran, pg_net recorded a request, Edge Function logs show it booted, but the response row has NULL status.

**Fix:** `pg_net` populates responses asynchronously. The NULL often resolves within 60 seconds. More importantly — NULL in the pg_net view doesn't mean failure. The authoritative signals are:
- Edge Function Logs tab (booted + completed with no error = success)
- The actual side effect (e.g., new commit in GitHub repo)

Don't chase the NULL; check the ground truth.

### 7.12 Magic link email points to `localhost:3000` or `workers.dev`

**Symptom:** Customer clicks the magic link and lands on localhost or the old preview URL.

**Fix:** Supabase uses Site URL from Authentication → URL Configuration to build every magic link. After custom domain cutover:
1. Change Site URL to `https://<clientdomain>`.
2. Add `https://<clientdomain>/**` and `https://www.<clientdomain>/**` to Redirect URLs.
3. (Optional, recommended) keep the old URL in Redirect URLs during transition, remove after 24 hours.

### 7.13 Branded magic-link email was overwritten by default Supabase template

**Symptom:** "My first test email was branded, the second was plain Supabase."

**Fix:** Supabase ships **two templates** that both fire on auth flows:
- **Confirm Signup** — fires on first-ever OTP request for a new email
- **Magic Link** — fires on subsequent OTP requests for an existing email

They're in separate tabs under Authentication → Email Templates. Branding one without the other leaves new signups getting the default design. **Brand both.** Keep the HTML source checked into the client repo.

### 7.14 Race condition in ES module bootstrap script

**Symptom:** Form submits as a GET with query string in URL instead of calling Supabase. No auth happens.

**Root cause:** ES modules execute after parsing completes, in document order. If the bootstrap `<script type="module">` creates the Supabase client and dispatches a `supabase-ready` event, but the page-handler script (registered later in document order) adds its event listener only at execution time, the event fires before the listener exists.

**Fix:** Use a flag-check-first pattern instead of pure event-based:
```html
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  window.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  window.__READY__ = true;
  window.dispatchEvent(new Event('supabase-ready'));
</script>
<script>
  window.onSupabaseReady = function(cb) {
    if (window.__READY__) { cb(); return; }
    window.addEventListener('supabase-ready', cb, { once: true });
  };
</script>
```

Every page-handler calls `onSupabaseReady(...)` instead of `addEventListener('supabase-ready', ...)`.

### 7.15 HTML entity double-encoded in dashboard text

**Symptom:** User sees literal `&middot;` or `&amp;` in the rendered page where a real character should appear.

**Root cause:** The string passed through an `escape()` / entity-encoding helper already contained an HTML entity, causing the `&` to re-encode as `&amp;`.

**Fix:** Use real Unicode characters (`\u00b7` for middle-dot, `\u2014` for em-dash, etc.) in template literals, and escape **each field individually** before joining:
```js
// BAD — separator gets re-encoded
${escape([a, b, c].filter(Boolean).join(' &middot; '))}

// GOOD — each field escaped, separator is a real character
${[a, b, c].filter(Boolean).map(escape).join(' \u00b7 ')}
```

### 7.16 Flex buttons left-aligned on mobile when layout collapses

**Symptom:** On mobile viewports, CTAs stuck to left edge under centered text.

**Fix:** Any `display:flex` row of CTAs needs `justify-content:center` inside a mobile media query:
```css
.cta-row { display:flex; gap:12px; flex-wrap:wrap; }
@media (max-width:860px) { .cta-row { justify-content:center; } }
```
Same pattern for any chip-row or toolbar that appears under centered headlines.

### 7.17 Cloudflare Registrar inter-account transfer

**Symptom:** Domain is in consultant's Cloudflare Registrar; client needs ownership.

**Fix:** Cloudflare now supports direct inter-account Registrar transfer. Consultant dashboard → zone → Registrar → Transfer Domain → paste client Account ID → client accepts from their dashboard. Nameservers unchanged, zero downtime. (Historically required out-and-back via a third registrar — this is no longer necessary.)

### 7.18 Worker secrets don't transfer with Worker deploy

**Symptom:** Re-deployed the Worker to the client's Cloudflare account; site now throws "missing env var" errors.

**Fix:** Secrets are account-scoped, not code-scoped. After `wrangler deploy` to the new account, re-run every `wrangler secret put` to re-populate secrets. Include this in your Leg F checklist.

---

## 8. Verification drills

### 8.1 The ownership verification drill (run quarterly, and at Phase 0 closeout)

Client drives, consultant observes only. Target: 15 minutes end-to-end.

1. **Supabase:** log into dashboard → Table Editor → `profiles` → confirm rows exist.
2. **L1 destination:** open the Sheet (or equivalent) → confirm row count roughly matches.
3. **L2 repo:** open GitHub repo → `/snapshots/<latest-date>/` → confirm `profiles.json`, `profiles.csv`, and all other child-table files present and non-empty.
4. **Clone L2 locally:** `git clone <repo-url>` → open `profiles.csv` in Excel or any text editor → confirm readable with zero consultant tooling involved.
5. **Rotate a secret:** Supabase → Project Settings → API → rotate anon key → confirm client can re-issue to consultant without consultant assistance.

If any step fails, engagement has regressed. Fix before the next calendar day.

### 8.2 Triple-redundancy live-trace proof (run once at Phase 0 closeout — mandatory)

Purpose: prove that a **single new record** flows cleanly into all three layers within a defined window. This is the test that seals the ownership claim — not just that the layers exist, but that they operate **independently on the same record**.

Run this test with the client present. Estimated time: 20 minutes (10 min test, 10 min waiting for L2).

1. **Create a unique test signup.** Use a fresh email (something like `phase0-verify-<date>@<clientdomain>`) so you can trace exactly this record through every layer.

2. **L0 verification (immediate):** within 5 seconds, open Supabase → Table Editor → `profiles`. Filter by the test email. The row exists. **Record the `created_at` timestamp.**

3. **L1 verification (within 30 seconds):** open the L1 destination (Sheet/Airtable/etc.). Find the row with the test email. It is there, with the same metadata as L0. **Record the row number or ID.**

4. **L2 verification — manual tier (within 2 minutes):** manually invoke the Edge Function via HTTP POST (per §3 Leg E step 7). Open the GitHub repo → `snapshots/<today>/profiles.csv` → find the test email in the file. It is there.

5. **L2 verification — scheduled tier (at next cron fire):** wait until the scheduled cron time passes. Return to the GitHub repo → verify a new dated snapshot folder appeared at the expected time → verify the test email is present in that snapshot too. **This proves the cron-driven path works, not just the manual one.** (Can be verified the morning after Phase 0 closeout if the cron is overnight.)

6. **Deletion propagation check:** from Supabase SQL editor, delete the test row:
   ```sql
   delete from public.profiles where email = 'phase0-verify-<date>@<clientdomain>';
   ```
   - **L0:** row gone from Table Editor.
   - **L1:** row may or may not be removed automatically depending on whether the webhook handles deletes. Note the behavior for the engagement guide.
   - **L2:** the *next* snapshot shows the row absent. Verify next day.

7. **Fill out the closeout sign-off block** in §5's pre-flight checklist. Both consultant and client sign.

**Pass criteria:**
- Steps 2, 3, 4 all find the same record in each layer.
- Step 5 proves the scheduled cron path independently.
- Step 6 proves deletion propagation (even if partially manual).
- All three layers are demonstrably independent vendor networks (Supabase, Google/Airtable, GitHub).

**Fail criteria (any one is a Phase 0 blocker):**
- A layer doesn't show the record.
- A layer shows the record but the client can't independently access it.
- A layer's ground-truth file can't be opened without consultant tooling.

Document the result — timestamps, row IDs, snapshot commit hashes — in the engagement record. This becomes the artifact you point to if a customer ever challenges the ownership claim.

---

## 9. Pre-flight gotchas checklist — read before any client touches anything

These are the bites-in-the-first-hour hazards. Covered in §7 but worth repeating as a stand-alone reminder:

- **Site URL must be updated on every domain cutover** (§7.12). Phase 0 isn't done until this is verified.
- **Brand BOTH email templates** — Confirm Signup and Magic Link (§7.13).
- **pg_cron is UTC-only.** Pick the UTC time that maps to your client's local intent, and document the DST behavior (§7.8).
- **Project-ref is the subdomain only.** Not the full URL (§7.5).
- **Use Scoop, not npm, for the Supabase CLI** (§7.4).
- **Worker secrets don't follow a Worker** across accounts (§7.18). Re-set every one.
- **Verify RLS via SQL, not the UI badge** (§7.1).

---

## 10. Estimated effort per Phase 0

Based on the Mane Line pilot, second-client estimate (once playbook is refined):

| Leg | Best case | Expected | Worst case |
|---|---|---|---|
| A — Client accounts | 30 min | 1 hr | 2 hr (client delays) |
| B — Supabase schema + RLS | 45 min | 1 hr | 2 hr |
| C — Worker baseline | 30 min | 45 min | 1.5 hr |
| D — L1 mirror | 45 min | 1 hr | 2 hr (destination quirks) |
| E — L2 nightly snapshot | 1 hr | 1.5 hr | 3 hr (PAT scope debugging) |
| F — Custody transfer + domain | 30 min | 1 hr | 2 hr (DNS propagation) |
| G — Handoff | 30 min | 45 min | 1 hr |
| **Total** | **~4.5 hr** | **~7 hr** | **~14 hr** |

Over 2–3 elapsed days, paced to the client's availability. Not a single sitting.

---

## 11. What goes into Phase 1 (and beyond)

After Phase 0 closes, Phase 1 begins the app-specific build. Typical Phase 1 scope:

- Domain schema (tables beyond `profiles`)
- Page layouts, branding, copy
- Dashboard or admin views
- Third-party integrations (payments, comms automation, analytics)
- Custom webhooks / Edge Functions for business logic
- Export / import flows
- Staging environment setup

**Phase 0 is infrastructure. Phase 1 is product.** Keeping these separate protects the ownership claim — if Phase 1 ever gets redesigned or replaced, Phase 0 remains intact.

---

## 12. Living-document protocol

- Every new client engagement: add a row to §10 with actual times, and add any new bug to §7.
- Quarterly: review §7 for entries that can be preempted by tooling (e.g., turn a manual check into a script).
- Never delete a §7 entry. Even resolved bugs are educational — future-you will thank current-you.

---

*Document version 1.1. Originating engagement: Mane Line by Silver Lining Herbs, April 2026. Maintained by: Cedric / Obsidian Axis Group (OAG). Next review: first Monday after second client engagement closeout.*
