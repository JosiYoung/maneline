# Mane Line — Client Engagement Setup Guide
**Program:** ManeLine by Silver Lining Herbs
**Audience:** Silver Lining Herbs leadership + anyone onboarding as a data custodian
**Effective date:** April 2026
**Document owner:** Cedric / ManeLine engineering

---

## 1. The promise we make to every waitlist member

Every person who signs up for Mane Line is told, in plain English, that they own their data. This document exists so we can back that claim up with architecture, not marketing.

> **"If Mane Line disappears tomorrow, your profile and your horse's profile are in your own Google Sheet and in a GitHub repository you control. You own the data. We just help you use it."**

To make that promise enforceable instead of aspirational, every record in the system is written to **three independent places** on three different vendor networks. No single provider can lock us, or our customers, out of the data.

---

## 2. The triple-redundancy model

| Layer | System | Role | Cadence | Failure mode it survives |
|---|---|---|---|---|
| **L0 — Source of truth** | Supabase Postgres | Primary, RLS-enforced, user-scoped database | Real-time | App-level bugs, bad writes |
| **L1 — Real-time human layer** | Supabase webhook → Cloudflare Worker → Google Sheets (client-owned account) | Operational visibility, comms engine input | Real-time on insert / update | A full Supabase outage (Sheets still current to last write) |
| **L2 — Durable truth store** | Supabase Edge Function (cron) → JSON + CSV → client-owned GitHub repo | Portable, open-format archive, zero vendor lock-in | Nightly, 07:00 UTC (midnight MST year-round) | Supabase *and* Google both gone tomorrow — JSON opens in any text editor, forever |

Nothing is "the backup." All three are production. Each layer is the fallback for the layer above it.

### What each layer actually protects

- **L0 → L1 fallback:** If Supabase is down, the Google Sheet still shows every signup through the moment of the outage. The comms engine keeps running against Sheets.
- **L1 → L2 fallback:** If Google freezes the account or the Sheet is accidentally deleted, the GitHub repo holds a complete nightly snapshot in JSON and CSV. We can repopulate the Sheet from the latest commit in under 10 minutes.
- **L2 → external fallback:** GitHub itself is a Git protocol host. The repo is cloneable. Any local clone, any other Git host (GitLab, Bitbucket, a USB stick), any plain-text editor is a complete valid restore target. There is no proprietary format anywhere in Layer 2.

### What failure *is* survivable, and what isn't

We are honest about this:

- We **do** survive: any single vendor disappearing, a locked Google account, a deleted Sheet, a rotated API key, a compromised Supabase instance (you fall back to the last nightly snapshot).
- We **do not** promise to survive: simultaneous loss of the Supabase database, the Google account, and the GitHub repo on the same day. That is a catastrophe planning problem (lightning, subpoena, adversarial nation-state) — outside the scope of this claim.

---

## 3. Who owns what (custody & responsibility matrix)

The ownership claim is only as strong as who holds the keys. Every layer is registered to an account the **client** owns, not the vendor (Cedric / ManeLine engineering).

| Asset | Registered to | Who holds the key | Portable? |
|---|---|---|---|
| Supabase project | Silver Lining Herbs organization | Silver Lining admin + ManeLine engineering | Yes — `pg_dump` exports standard Postgres |
| Cloudflare Worker + `maneline.co` DNS | Silver Lining Cloudflare account | Silver Lining admin + ManeLine engineering | Yes — Worker code is in this repo; DNS moves with the domain |
| Google Sheet ("ManeLine Waitlist") | Silver Lining Google Workspace account | Silver Lining admin | Yes — File → Download → CSV / Excel anytime |
| GitHub backup repo (`JosiYoung/Databackup`) | Josi Young (Silver Lining owner) | Josi Young | Yes — standard Git, cloneable anywhere |
| Apps Script Web App | Silver Lining Google account | Silver Lining admin | Yes — code is stored as text in this repo too |

**Rule:** ManeLine engineering never holds a sole-owner credential. Every production asset has at minimum one Silver Lining human with full admin rights. This is the difference between *hosting* your data and *owning* your data.

> **Custody note on the GitHub repo.** The Layer 2 archive currently lives at `https://github.com/JosiYoung/Databackup` — a personal GitHub account belonging to the Silver Lining owner. This satisfies the custody rule (a Silver Lining human holds the sole admin key), but when Silver Lining creates a dedicated GitHub organization (e.g., `silverliningherbs`), the repo should be transferred. Transfer takes two minutes, preserves commit history, and requires only one env-var update on the Edge Function (`GITHUB_OWNER`). No data migration, no broken verification drill.

---

## 4. Verification procedure — how the client can prove ownership at any time

Any Silver Lining admin can run the following drill, unassisted, in under 15 minutes. If any step fails, engagement has regressed and we fix it immediately.

1. **Log into the Supabase dashboard** with your Silver Lining credentials. Navigate to Table Editor → `profiles`. Confirm you see rows.
2. **Open the Google Sheet** ("ManeLine Waitlist") in your own Drive. Confirm the row count roughly matches.
3. **Open the GitHub backup repo** in your browser. Navigate to `/snapshots/` and open the latest folder (YYYY-MM-DD). Confirm `profiles.json`, `profiles.csv`, `horses.json`, `horses.csv` are present and non-empty.
4. **Clone the repo locally:** `git clone <repo-url>`. Open `snapshots/<latest-date>/profiles.csv` in Excel or any text editor. Confirm you can read the data with zero ManeLine tooling involved.
5. **Rotate a secret.** In Supabase → Project Settings → API → rotate the anon key. Confirm you can re-issue credentials to ManeLine engineering without our assistance. (Keys belong to you.)

If every step passes, the ownership claim is intact.

We recommend running this drill **quarterly** — first Monday of each quarter is a good cadence.

---

## 5. Privacy + isolation, restated for customers

These guarantees are baked into the database, not into promises:

- Each customer can read and modify **only their own profile row** and **only horses they own**. Enforced by Postgres Row Level Security (RLS).
- The public anon key shipped to the browser **cannot bypass RLS.** Without a valid session token, queries return zero rows.
- Horse data **does not flow into Layer 1 (Google Sheets).** Only the people table mirrors, because Sheets is the comms engine audience. Horse records stay inside Supabase + Layer 2 archive only. This is an intentional design choice.
- Layer 2 snapshots are written to a **private** GitHub repo. Access is controlled at the GitHub organization level.

---

## 6. Data export for the customer (on request)

If any waitlist member or launched customer asks, "Give me my data and delete the rest," we do three things:

1. Query Supabase for every row where `id = user.id` (profiles) and `owner_id = user.id` (horses). Package as JSON.
2. Email the package to the customer.
3. Delete the Supabase rows. The nightly Layer 2 snapshot captures the deletion (subsequent snapshots will show the row absent).

Because L1 and L2 both derive from L0, the deletion propagates on the next sync. **We do not keep data after a verified deletion request.** This is how the ownership claim stays credible under GDPR / CCPA-style scrutiny even before we're legally required to comply.

---

## 7. What gets built in what order (engagement checklist)

This checklist is the delivery order. Each item gates the next; no skipping.

- [x] Layer 0 — Supabase schema with RLS (`supabase-schema.sql`)
- [x] Layer 0 — Magic-link auth, signup flow, dashboard (`worker.js`)
- [x] Layer 1 — Real-time Google Sheets mirror (`google-apps-script.gs` + `/webhook/sheets` in Worker)
- [x] Layer 2 — Nightly GitHub snapshot Edge Function authored (`supabase/functions/nightly-backup/index.ts`, target `JosiYoung/Databackup`, 07:00 UTC = midnight MST, profiles + horses, retain forever)
- [x] Layer 2 — Edge Function deployed, GitHub PAT provisioned, `pg_cron` schedule `0 7 * * *` active (verified live 15 April 2026)
- [ ] Custody transfer — confirm all 5 assets in §3 are registered to Silver Lining accounts, not personal accounts (note: `JosiYoung/Databackup` is owner-personal and can migrate to a Silver Lining org anytime)
- [ ] First verification drill — run §4 end-to-end with Silver Lining admin present
- [ ] Document the waitlist-member-facing data ownership statement (plain English, ≤150 words, on `/what-to-expect`)
- [ ] Quarterly drill calendar entries created in Silver Lining's shared calendar

---

## 8. Layer 2 configuration (resolved)

These decisions were made during engagement kickoff on 15 April 2026 and are now locked into the Edge Function source at `supabase/functions/nightly-backup/index.ts`. Changing any of them is a single env-var swap — no code change required.

| Decision | Chosen | Note |
|---|---|---|
| GitHub target | `JosiYoung/Databackup` | Personal account of the Silver Lining owner. Migrate to an org when one is created (transfer preserves history). |
| Visibility | Private | Snapshots contain customer emails and horse records. Never public. |
| Backup contents | `profiles` + `horses` | Both tables serialized to JSON and CSV every night. |
| Retention | Forever | Commits are immutable; storage cost is negligible; full audit trail. |
| Schedule | 07:00 UTC daily | Midnight Mountain Standard Time year-round (00:00 MST winter, 01:00 MDT summer). `pg_cron` runs UTC-only, so 07:00 UTC is the fixed anchor. Cron string: `0 7 * * *`. |

Still to do before Layer 2 is live (tracked in the engagement checklist §7 and operationalized in the main `README.md` Leg 5):

1. Create the `Databackup` repo under `JosiYoung` (private).
2. Provision a fine-grained GitHub PAT scoped to **Contents: read & write** on that repo only.
3. `supabase secrets set GITHUB_TOKEN=<pat> GITHUB_OWNER=JosiYoung GITHUB_REPO=Databackup GITHUB_BRANCH=main`.
4. `supabase functions deploy nightly-backup`.
5. Wire the cron schedule (Supabase Dashboard → Schedules, or `pg_cron`).
6. Run `supabase functions invoke nightly-backup` once manually. Verify the repo now contains `snapshots/<today>/*` and `LATEST/*`.
7. Run the §4 verification drill end-to-end.

---

## 9. Escalation & incident response

If any of the following occurs, treat as P1 and notify ManeLine engineering within 1 business day:

- A verification drill (§4) fails at any step
- A row count mismatch >5% between Supabase and the latest GitHub snapshot
- A waitlist member reports seeing another person's data
- A credential in §3 is suspected compromised
- A Layer 1 or Layer 2 job has failed for 48+ consecutive hours

For mid-incident procedures and rollback, see the forthcoming `runbook.md` (to be authored after Layer 2 is live).

### 9a. Known gotchas (learned during kickoff — don't re-learn the hard way)

These are configuration traps that will silently break the signup flow. Every one of them has bitten us at least once. If you hit a weird auth or email issue, start here.

- **Supabase Site URL must be updated at every domain cutover.** Magic-link emails are built using whatever is set at **Authentication → URL Configuration → Site URL**. When we move from the `*.workers.dev` preview URL to `maneline.co`, this field must be changed or every magic link will still point at the old host — symptom is users clicking the email and landing on a 404 or `localhost:3000`. Also add every valid origin (including `http://localhost:8787` for local dev) to **Redirect URLs** — Supabase blocks any redirect target not on the allow-list. Verify after each cutover by requesting a new magic link and inspecting the URL before clicking.
- **Supabase uses two different email templates — brand both.** First-time signups fire the **Confirm Signup** template. Returning users (same email, second OTP request) fire the **Magic Link** template. They are edited in two separate tabs under **Authentication → Email Templates**. A branded Magic Link template will *not* apply to a brand-new signup. Symptom: "my first test looked Mane Line branded, the second one looked like default Supabase" — it's actually reversed (new = unbranded Confirm Signup, returning = branded Magic Link), or vice versa depending on which one you customized first. **Fix:** paste the same branded HTML into both templates. Keep the template HTML checked into this repo (or at minimum this guide) so we can restore it if someone edits it in the dashboard by accident.

---

## 10. Glossary (plain English, for non-technical stakeholders)

- **RLS (Row Level Security):** A Postgres feature that enforces "user A can only see user A's rows" at the database level. Not at the application level. Even a bug in our code cannot leak data across users if RLS is on.
- **Edge Function:** A small program that runs on Supabase's servers on a schedule (like a cron job). Used here to pull data nightly and push it to GitHub.
- **Webhook:** Supabase calls our code automatically every time a new row is inserted. This is how real-time Sheets mirroring works.
- **PAT (Personal Access Token):** A GitHub credential, scoped narrowly, used by the Edge Function to commit backup files. Rotated quarterly.
- **Snapshot:** A full dump of a table at a point in time, committed to Git. Commits are immutable — you can always go back to any past snapshot.
- **Open format:** JSON and CSV are text. They open in any editor. No proprietary tool required, ever.

---

*End of document. Version 1.0. Next review: first Monday of Q3 2026, or earlier on incident.*
