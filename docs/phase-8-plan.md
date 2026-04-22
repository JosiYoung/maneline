# Mane Line — Phase 8 (Barn Mode — Owner "Barn in a Box") Build Plan

**Owner:** Cedric / OAG
**Window:** Week of 2026-06-08 (after Phase 7 code-complete; runs alongside Phase 7.x hotfix tail)
**Feature map reference:** `MANELINE-PRODUCT-FEATURE-MAP.md` §6 row Phase 7 ("Public launch" — this Phase 8 is the owner-side launch payload that rides the same public-launch window), §3.1 (Owner Portal surfaces — Barn Calendar, Herd Health, Facility Map, Barn Spending all live under `/app`), §3.2 (Trainer Portal mirror — "My Schedule" is a trainer-scoped read of the owner's `barn_events`), §3.3 (Silver Lining admin surfaces — Barn Mode subscription rollups, comp-source finance tile), §3.4 (Subscribe-and-save linkage — this phase wires the verification cron), §4.6.2 (HubSpot event taxonomy — `maneline_barn_mode_started`, `maneline_sl_linked`, `maneline_promo_redeemed`).
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 (shadcn `Card` / `Table` / `Dialog` / `Sheet` — every Phase 8 surface is shadcn-pure), §3.5 owner bottom-nav patterns (Barn tab gets three sub-surfaces — Calendar, Health, Facility — under the existing `/app` shell), §5.1 owner portal rules, §10 (error/empty/loading).
**Law references:** `playbooks/OAG_ARCHITECTURE_LAWS.md` §2 (admin reads via Worker + service_role — Barn Mode entitlement checks + SL verification cron run in the Worker, never on the client), §3 (audit every read + write — subscription transitions, SL link events, promo redemptions, entitlement grants all write `audit_log`), §4 (triple redundancy — all 11 new tables flow into L1 Sheets + L2 nightly backup), §7 (RLS day one — every new table is RLS-enabled at create; public accept/decline token endpoints are the only anon path and are explicitly service-role-gated in the Worker), §8 (archive-never-delete — events, pro contacts, stall assignments, turnout memberships, promo codes, SL links all carry `archived_at` — `update set archived_at = now()` is the only removal path).
**Integrations reference:** `docs/INTEGRATIONS.md` §Stripe Subscriptions (extend with owner-platform subscription block — charges to Maneline platform, not to a trainer Connect account), §Shopify Admin API (new section — `silver_lining_links` verification calls `GET /admin/api/2024-01/customers/{id}/subscription_contracts.json`), §Twilio (extend — owner external-pro SMS opt-in for Barn Calendar invites), §Resend (reuse existing transactional sender — new email templates under `worker/emails/barn/`).

---

## 0. What Phase 8 is, and what it isn't

**In scope (derived from owner product council sign-off 2026-04-18 + Phase 7 gate commitments + SLH comp-flow decision 2026-04-19):**

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Barn Calendar + Professional Contacts + external accept/decline** | Owner on `/app/barn/calendar` sees week/month/agenda view; can create an event (title, start_at, duration, location, animals, notes) and attach attendees from Professional Contacts. In-app attendees (Maneline users) get in-app + email notifications; external attendees get a branded email with `.ics` + a `https://maneline.co/e/:token` public-signed-token link to accept/decline/counter without auth. Trainer lands on `/trainer/my-schedule` and sees the same event (reverse mirror). RRULE-compatible recurrence (farrier every 6 weeks, worming every 3 months, dental annual) materialized on insert. After 3 external-pro accepts via public link, a "claim your Maneline account" email fires (soft-signup growth loop). |
| 2 | **Herd Health Dashboard + scheduler handoff** | Owner on `/app/barn/health` sees a horses-rows × doc-types-columns grid with green (<50% of interval), yellow (50–100%), red (expired), gray (no record) cells. Click a red cell → opens Barn Calendar create-event dialog with pro-role, animals, title, and notes prefilled ("Coggins pull — Knight"). Owner-configurable thresholds pre-populated with the industry defaults (coggins 12m; EEE/WEE/WNV/tetanus annual; flu/rhino 6m; dental annual; farrier 7w; FEC quarterly). PDF export is Barn Mode-paywalled. |
| 3 | **Facility / Boarding Map (editable list + Daily Care Matrix)** | Owner on `/app/barn/facility/:ranch_id` edits stall list (1:1 stall ↔ horse), maintains turnout groups (many-to-many tag), and fills a Daily Care Matrix (feed AM/PM, hay, turnout, blanket, supplements, meds, notes) in-app. "Print today's chart" generates a letter-size PDF (feed chart + turnout groups + care matrix) via the Phase 7 R2 pipeline. Multi-facility owners see a ranch selector. No drag-and-drop visual layout in v1. No barn staff accounts in v1 — owner is the only check-off user. |
| 4 | **Barn Spending (cash-basis expense analytics + per-horse cost basis + disposition)** | Owner on `/app/barn/spending?year=2026` sees category donut, per-horse table, per-ranch breakdown, monthly timeline. Per-horse detail page at `/app/barn/spending/animals/:id` shows acquired_at + acquired_price, cumulative spend, disposition status (Sold/Deceased/Leased-out/Retired/Still owned) + disposition amount. CSV + Schedule-E-friendly PDF export. Phase 7 trainer-billed invoices mirror into `expenses` rows with `source_invoice_id` + `billable_to_owner=false` so the line counts once on payment, never twice. |
| 5 | **Barn Mode subscription — $25/mo owner tier** | Owner adds horse #3 → soft upsell modal ("You've unlocked Barn Mode — $25/mo"). Adding horse #4 → hard paywall (must subscribe). `POST /api/barn/subscription/checkout` opens Stripe Checkout (owner-platform charge, **not** trainer Connect). `POST /api/barn/subscription/portal` opens Stripe Customer Portal for self-serve cancel/update. Gated features behind Barn Mode: SMS reminders (Barn Calendar external attendees), Herd Health PDF export, 4th+ horse slot. User owns the downgrade — archiving horses 4→2 keeps the subscription active until the user cancels. |
| 6 | **Silver Lining subscribe-and-save comp linkage** | Owner on `/app/settings/subscription` clicks "Link my Silver Lining account," verifies via email + order # (Shopify Admin API), Maneline stamps `silver_lining_links.silver_lining_customer_id`. Nightly cron hits Shopify `customers/:id/subscription_contracts.json`; if any S&S contract is `status=active` → `subscriptions.comp_source='silver_lining_sns'`, owner is comped at Barn Mode tier at $0/mo. On S&S cancel → 30-day grace, then Maneline converts to a $25/mo paid sub (card on file required, collected via Stripe at link-time via a $0 SetupIntent). 90-day sticky linkage — one SL customer cannot jump Maneline accounts. |
| 7 | **Promo code redemption** | Marketing campaigns (swag bag, endorser giveaway) hand out one-time codes. Owner on `/app/settings/subscription` enters code → `POST /api/barn/promo-codes/redeem` → `subscriptions.comp_source='promo_code_<campaign>'`, `comp_expires_at = now() + grants_barn_mode_months`. Admin panel `/admin/promo-codes` generates codes + views redemption ledger. Codes are single-use; `redeemed_by_owner_id` gets stamped, `expires_at` enforced. |
| 8 | **Data model — 11 new tables + 7 column adds** | Migrations `00020_phase8_barn_mode_core.sql` (barn calendar + pro contacts + facility + spending + subscription), `00021_phase8_silver_lining_comp.sql` (SL links + promo codes + entitlement events), `00022_phase8_herd_health_thresholds.sql` (thresholds + acknowledgements). RLS day one on every table. Archive-never-delete on every table. Column adds: `animals.color_hex`, `ranches.color_hex`, `animals.acquired_at`, `animals.acquired_price_cents`, `animals.disposition`, `animals.disposition_at`, `animals.disposition_amount_cents`, `expenses.source_invoice_id`, `user_profiles.welcome_tour_barn_seen_at`. |
| 9 | **Horse #4 hard-paywall enforcement** | Worker middleware `requireBarnModeForHorseCount(owner_id, intended_count)` blocks `POST /api/animals` when the post-insert count would exceed 2 AND `subscriptions` row for the owner is not (`comp_source IS NOT NULL` OR `tier='barn_mode' AND status='active'`). Returns 402 `barn_mode_required` with a redirect hint to Stripe Checkout. Horse #3 is a soft upsell only — no 402. |
| 10 | **Notification orchestration (T-48h/T-24h/T-2h reminders + claim-pro email)** | `pg_cron` job every 15m scans `barn_events` for events starting in 48h/24h/2h windows; fires in-app notifications + emails (and SMS for Barn Mode owners to external attendees who opted in). After 3 successful `barn_event_responses.status='confirmed'` from the same `pro_contact_id`, trigger `claim_pro_account` email via `/api/_internal/pro-claim-email`. One-shot per pro contact (`pro_contacts.claim_email_sent_at` stamp). |
| 11 | **Nightly backup extension** | `professional_contacts`, `barn_events`, `barn_event_attendees`, `barn_event_responses`, `barn_event_recurrence_rules`, `stalls`, `stall_assignments`, `turnout_groups`, `turnout_group_members`, `care_matrix_entries`, `health_thresholds`, `health_dashboard_acknowledgements`, `subscriptions`, `silver_lining_links`, `promo_codes`, `barn_mode_entitlement_events` all appear in `snapshots/YYYY-MM-DD/` JSON + CSV. Manifest version bumps to `8.0`. |
| 12 | **Observability extension** | `/api/_integrations-health` adds: `barn.events_created_7d`, `barn.external_responses_7d`, `barn.claim_pro_emails_sent_7d`, `health.overdue_count`, `health.pdf_exports_7d`, `facility.care_matrix_entries_7d`, `spending.invoice_mirrors_7d`, `subscriptions.barn_mode_paid_count`, `subscriptions.barn_mode_comp_count`, `silver_lining.linked_count`, `silver_lining.last_verification_run_at`, `silver_lining.verification_failures_24h`, `promo_codes.redeemed_24h`. |

**Explicitly out of scope (defer to Phase 9 / v1.1):**
- **Income modeling / P&L** — Phase 8 Barn Spending is expense-only, cash basis, descriptive. Lesson fees, show winnings, lease income tracking is Phase 9 at earliest (needs a real interview loop with owners to understand what they already track in QBO / a spreadsheet).
- **Budgets + variance reporting** — same v1.1 slot. No "you spent $X vs budget $Y" UI in Phase 8.
- **Drag-and-drop facility map visual layout** — list-based editable Facility tab ships in Phase 8; a true canvas layout (rows, aisles, shape-drawing) is a v1.1 design project.
- **Barn staff accounts + check-off** — v1.1. Phase 8 Daily Care Matrix is owner-only.
- **Mobile push notifications** — no native app yet; owner notifications are in-app + email. Phase 9 when the mobile shell lands.
- **Dual-role user bundling** (one user who is both owner and trainer) — documented workaround in Phase 8 copy: use the `user+trainer@gmail.com` alias trick at signup.
- **Anomaly detection** (sudden weight drop, dose-miss flags, med-adherence) — v1.1. Phase 8 Herd Health is calendar-based expirations only.
- **State-specific vaccine defaults** — explicitly out of scope; liability firewall. We ship AAEP/industry defaults only, owner-configurable.
- **Serial-code Silver Lining comp** (as primary mechanism) — linked-account is the primary path. Promo codes are only for marketing campaigns, not the core SL customer comp.
- **Barn Calendar push to Google / Apple calendar** — `.ics` emails only in v1. Two-way sync is a v1.1 integration.
- **Multi-user barn sharing** (owner + spouse + barn manager collaborating on the same Barn Calendar) — v1.1.
- **Per-user notification quiet hours** — v1 ships global preferences only; per-user quiet hours is a v1.1 polish.
- **HubSpot Deals pipelining for subscription lifecycle** — we emit the three behavioral events (`maneline_barn_mode_started` / `maneline_sl_linked` / `maneline_promo_redeemed`) and stop. Pipeline mechanics are v1.1 per the Phase 6 decision.

**Phase 8 gate to Phase 9 (owner growth + mobile shell):**

> *The Phase 7 closed-beta owners have all migrated into Phase 8: 20/20 accounts have a `subscriptions` row, ≥12 have linked a Silver Lining customer (`silver_lining_links`) and are running on `comp_source='silver_lining_sns'`, ≥3 are paying the $25/mo tier (either added horse #4 or intentionally subscribed without SL linkage). At least 5 owners have created ≥1 Barn Calendar event; at least 2 events have received a response from an external pro via the public token link; at least one "claim your pro account" email has fired. Herd Health dashboard shows overdue items for every beta owner (non-zero health.overdue_count). Facility Map has ≥1 care-matrix entry per owner-day for ≥3 owners over a 5-day window. Barn Spending shows at least one trainer invoice mirrored into `expenses` with `source_invoice_id IS NOT NULL`. The nightly Silver Lining verification cron has run ≥7 consecutive days without a failure alert. Horse #4 hard paywall has blocked at least one unauthenticated attempt and the test account completed the Stripe Checkout → Barn Mode active round-trip. Nightly backup the next morning contains all 11 new tables. Every phase-8 TECH_DEBT row is either resolved or explicitly re-homed to v1.1.*

If a sub-prompt drifts past this gate, push it to Phase 9 or v1.1.

---

## 1. Dependencies + prerequisites

Before any Phase 8 sub-prompt starts, verify:

| # | Prerequisite | Check |
|---|---|---|
| 1 | Phase 7 code-complete with PR #8 (admin invoice visibility + HubSpot `invoice.paid`) merged | `git log --oneline` shows `776811a Phase 7 PR #8`; Phase 7 drill shows no open 🔴 rows |
| 2 | `RESEND_API_KEY` still live (Phase 6 carryover) | `/api/_integrations-health` shows `resend.status=live`; one test email to `corbettcollc+phase8@gmail.com` renders the new Barn Mode template |
| 3 | `STRIPE_SECRET_KEY` live AND a new **platform** price id (`STRIPE_PRICE_BARN_MODE_MONTHLY`) created in Stripe dashboard for $25/mo — this charges to Maneline's platform account, NOT to a trainer Connect account (unlike Phase 7 invoices) | Cedric confirms the price id in `wrangler secret put STRIPE_PRICE_BARN_MODE_MONTHLY`. Optional `STRIPE_PRICE_BARN_MODE_ANNUAL` left as TODO until pricing decision lands (suggest $250/yr = 2 months free). |
| 4 | Stripe webhook endpoint `/webhooks/stripe` (from Phase 6) extended to route `checkout.session.completed` + `customer.subscription.updated` + `invoice.payment_failed` into the new `subscriptions` table | `stripe listen --forward-to localhost:8787/webhooks/stripe` dry-runs the three events against the Phase 8 handler fork |
| 5 | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` live (Phase 6 carryover) — Phase 8 extends usage to Barn Mode owner → external-pro SMS (opt-in) | Health endpoint `twilio.status=live`; 10DLC registration still valid (no new A2P campaign required since we're already sending from the same number) |
| 6 | **New secret `SILVER_LINING_SHOPIFY_ADMIN_TOKEN`** delivered by SLH (Shopify Admin API access token scoped to `read_customers` + `read_subscription_contracts`) | `wrangler secret put SILVER_LINING_SHOPIFY_ADMIN_TOKEN`; a manual `curl` against `https://silver-lining-herbs.myshopify.com/admin/api/2024-01/customers.json?limit=1` returns 200. **TODO(phase-8): confirm exact Shopify store subdomain with SLH — placeholder assumes `silver-lining-herbs.myshopify.com`.** |
| 7 | **New secret `SILVER_LINING_SHOPIFY_STORE_DOMAIN`** — same as #6 but the hostname itself, stored as a separate secret so the API base URL is configurable without code change | Same `wrangler secret put` drill |
| 8 | Resend sender domain still covers `notifications@maneline.co` for the `.ics`-bearing external-attendee emails (DKIM passing) | Resend dashboard confirms DKIM green for the existing Mane Line sender domain; no new domain required |
| 9 | `pg_cron` still available (used by HubSpot drain, Phase 7 auto-finalize, and now the three Phase 8 crons: barn reminders, SL verification, promo expiry sweep) | `select * from cron.job` lists existing crons; capacity check — we're adding 3 crons, each lightweight |
| 10 | Horse color palette decision — **TODO(phase-8): Cedric pick a 16-swatch palette** (candidates: Tailwind `amber-500 / rose-500 / emerald-500 / sky-500 / violet-500 / fuchsia-500 / orange-500 / teal-500 / indigo-500 / lime-500 / cyan-500 / pink-500 / red-500 / yellow-500 / green-500 / blue-500` feels native, OR a warm barnyard palette). Default assumption: Tailwind-500 set above. Same palette drives `animals.color_hex` and `ranches.color_hex`. | Decision documented in `docs/phase-8/01-barn-calendar.md` §B color section before 01 sub-prompt ships |
| 11 | Legal review of the 90-day sticky SL linkage policy (can't unlink-and-relink a Silver Lining customer to a different Maneline account for 90 days) + 30-day grace on SL cancellation before conversion to $25 | Cedric + legal sign-off documented in `docs/INTEGRATIONS.md` §Silver Lining. Implicit billing consent: Stripe SetupIntent at link time collects a card so the conversion-to-paid is automatic after the grace window. |

If any row is red, **do not start Phase 8 sub-prompts** — fix first. Rows 3, 4, 6, 7, 10, 11 are client/legal deliverables and can arrive during the phase as long as they land before the sub-prompt that depends on them.

---

## 2. Phase 8 sub-prompts (copy/paste into Claude Code, one at a time)

Phase 8 is module-shaped, not drill-shaped. Each module below has its own spec document under `docs/phase-8/`. Execute strictly in the order listed — later modules depend on the data model and Worker scaffolding produced by earlier ones.

| Order | Module spec | What it lands | Depends on |
|---|---|---|---|
| 8.1 | `docs/phase-8/01-barn-calendar.md` | Migration `00020_phase8_barn_mode_core.sql` (calendar + facility + spending + subscription parts), professional contacts table, barn events, attendees, responses, recurrence rules, `animals.color_hex`, `ranches.color_hex`. Worker routes `/api/barn/events/*`, `/api/barn/pro-contacts/*`, `/api/public/events/:token/respond`. SPA `/app/barn/calendar`, `/trainer/my-schedule`. Public accept/decline SPA route `/e/:token`. | Dependency 8 (Resend), 2 (Resend KEY), 10 (color palette) |
| 8.2 | `docs/phase-8/02-herd-health-dashboard.md` | Migration `00022_phase8_herd_health_thresholds.sql`, `health_thresholds`, `health_dashboard_acknowledgements`. Worker routes `/api/barn/herd-health*`. SPA `/app/barn/health` + per-animal health page. PDF export via R2 (reuses Phase 7 PDF pipeline). | 8.1 data model for calendar handoff; reuses existing `vet_records` table (no new core health table) |
| 8.3 | `docs/phase-8/03-facility-map.md` | Migration extend `00020_phase8_barn_mode_core.sql` — `stalls`, `stall_assignments`, `turnout_groups`, `turnout_group_members`, `care_matrix_entries`. Worker routes `/api/barn/facility/*`. SPA `/app/barn/facility/:ranch_id`. Printable PDF. | 8.1 (ranch/animal color foundation already there); no 8.2 dependency |
| 8.4 | `docs/phase-8/04-barn-spending.md` | Migration extend `00020_phase8_barn_mode_core.sql` — column adds on `animals` (cost basis + disposition), `expenses.source_invoice_id`, rollup views. Worker routes `/api/barn/spending/*`. SPA `/app/barn/spending`. Phase 7 invoice → expenses mirror trigger. | Phase 7 `invoices` table (code-complete); 8.1 color infrastructure (optional) |
| 8.5 | `docs/phase-8/05-pricing-and-silver-lining-comp.md` | Migration `00021_phase8_silver_lining_comp.sql` — `subscriptions`, `silver_lining_links`, `promo_codes`, `barn_mode_entitlement_events`. Worker routes `/api/barn/subscription/*`, `/api/barn/silver-lining/*`, `/api/barn/promo-codes/*`, `/api/admin/promo-codes`. SPA `/app/settings/subscription`, paywall modals (soft at horse #3, hard at #4), admin promo panel. Nightly SL verification cron. 402 middleware on `POST /api/animals`. | Dependencies 3, 4, 6, 7, 11. Blocks launch of the hard paywall. |
| 8.6 | **Observability + backup extension** | `/api/_integrations-health` additions per feature #12. `nightly-backup/index.ts` TABLES list adds all 11 new tables; manifest version → `8.0`. Short sub-prompt, no new UI. | All of 8.1–8.5 |
| 8.7 | **Barn Mode drill (25 steps)** | End-to-end verification across all 5 modules plus subscription + SL comp + hard paywall. Mirrors the Phase 6/7 drill style. | All of 8.1–8.6 |

**Execution discipline.** Each module file has its own §F Verify block with concrete curl commands + SQL checks. Run the verify block before moving to the next module. Stop on red, fix, re-run. The Phase 7 pattern of "deferred on client deliverables" holds — if `SILVER_LINING_SHOPIFY_ADMIN_TOKEN` lands late, 8.5 ships with the endpoint returning `501 silver_lining_not_configured` same as the Phase 5/6 pattern.

---

## 3. UI Contract (non-negotiable)

Same tokens as Phases 2–7. Zero new tokens. Every Barn Mode surface is shadcn-pure (`Card`, `Table`, `Dialog`, `Sheet`, `Tabs`, `Select`, `Calendar`, `Popover`, `Badge`, `Progress`). HeroUI stays out of `/app/barn/**` — same posture as Phase 5/6 admin surfaces.

Forbidden:
- No direct `supabase.from('subscriptions')` / `silver_lining_links` / `promo_codes` / `barn_mode_entitlement_events` queries from the SPA — Worker + service_role only (OAG §2).
- No Stripe or Shopify Admin secrets in the client bundle — Worker secrets only.
- No bulk delete anywhere — archive-only (OAG §8). Every table carries `archived_at`; removal flow is `update set archived_at = now()`.
- No `any` — Zod on every Worker request body, every admin endpoint response, every Stripe + Shopify webhook payload.
- No `console.log` on error paths — `logger.error` (Worker) or Sonner toast (SPA). `TECH_DEBT(phase-8)` if a shortcut is unavoidable.
- No state-specific vaccine defaults in the Herd Health threshold seeder — industry (AAEP) defaults only.
- No autonomous Barn Mode downgrade when horse count drops from 4 → 2 — user owns the cancel (OAG §8 spirit: never destroy something the user paid for without their action).
- No direct Stripe Connect charges for Barn Mode subscriptions — owner-platform charges only. Connect charges are reserved for trainer invoices (Phase 7).
- No hard delete on `silver_lining_links` — the 90-day sticky rule is enforced by the `sticky_until` column + archive flip, never by physical row removal.

---

## 4. Resolved decisions + open items

### Resolved

1. **Barn Mode is one SKU, one price.** $25/mo is the single paid owner tier. No freemium micro-upsells (no "calendar-only plan," no "health-only plan"). Free ≤ 2 horses; Barn Mode unlocks everything beyond.
2. **Linked-account is the primary SL comp mechanism.** Serial codes are reserved for marketing campaigns (swag bag, endorser giveaways) and are implemented as the separate `promo_codes` table. One SL customer → one Maneline account, enforced by a unique index, 90-day sticky.
3. **30-day grace on SL cancel, then convert to $25 automatically.** Card on file is mandatory at link-time via a $0 Stripe SetupIntent — no re-collection step at the grace boundary.
4. **User owns the downgrade.** Going from 4 horses → 2 horses does not autonomously cancel Barn Mode. Only the user clicking "Cancel subscription" in the Stripe Customer Portal (or equivalently, the Barn Mode settings panel) ends the subscription. Rationale: we never surprise-bill, and we never surprise-cancel.
5. **Expense-only, cash basis, descriptive.** No income modeling, no budget variance, no accrual. This is explicit — when owners ask, the answer is "Phase 9 after the owner interview loop."
6. **List-based facility tab, not drag-and-drop.** Ships in weeks, not months. Drag-drop is a v1.1 design project.
7. **Owner-only Daily Care Matrix.** Barn staff accounts are v1.1. If the owner delegates, they share their password (not supported, but we don't need to solve for it in v1).
8. **Industry-default Herd Health thresholds.** AAEP guidelines as seed: coggins 12m, core vaccines annual, risk-based 6m, dental annual, farrier 7w, FEC quarterly. No state-specific logic. Owner can edit every threshold per record type.
9. **PDF export is Barn Mode-gated for Herd Health; printable care chart is free.** The gate is ONE feature, not a deep paywall matrix — Herd Health PDF is the one paywalled export because it's the one we heard asked for most (vet-review doc, pre-show packet).
10. **External-pro email-with-`.ics` + public token link is a full accept/decline/counter flow, not a "view only."** The counter-proposal loop is a first-class part of Barn Calendar — if a farrier counters, the owner sees the counter, can accept or edit. No second token round-trip for accepts (the counter accept lives behind the same original token, rotated only on explicit revoke).
11. **Signed tokens, 32-byte base64url, 30-day expiry.** Same convention as Phase 5 vet tokens. Rate-limited at the Worker level (60 GETs + 20 POSTs per token per 60s).
12. **After 3 successful external-pro responses via Maneline, trigger "claim your pro account" email.** Soft-signup growth loop — one-shot per pro contact, non-aggressive, branded as "your clients have been booking you through Mane Line — take it over."

### Open items to resolve during Phase 8 (not gating code-complete)

- **Annual Barn Mode pricing.** TODO — decide during Phase 8 kickoff. Suggest $250/yr = 2 months free. Leave `STRIPE_PRICE_BARN_MODE_ANNUAL` as a nullable env var; the subscription panel skips the toggle if it's unset.
- **Horse color palette final swatches.** TODO per Dependency 10 — Cedric picks 16. Default Tailwind-500 set documented in 01-barn-calendar.md §B.
- **Shopify store subdomain for the SL Admin API.** TODO per Dependency 6 — placeholder `silver-lining-herbs.myshopify.com`; confirm with SLH. Stored as a Worker secret for swap-without-deploy.
- **Minimum $ threshold for SL S&S comp qualification.** v1 posture: any active S&S contract qualifies. Revisit if abuse emerges (e.g., someone signs up for a $5/month S&S just to comp a $25 Maneline plan).
- **Counter-proposal-of-counter-proposal loop.** v1 cap: one counter level. If the owner edits a counter, a fresh notification fires; the external pro responds again on the same token. No "you countered my counter of their counter" chain.
- **Recurrence-rule UX.** RRULE-compatible storage is settled; UI affordance for "every 6 weeks starting 2026-07-01" is a week-1 design polish. Default seed: three templates (farrier Q6W, worming Q3M, dental annual) surfaced as quick-picks in the event create dialog.
- **Owner invitation to pros who soft-signed-up.** After the claim-account email fires, if the pro signs up with a different email than the one in `professional_contacts`, we don't auto-link. Revisit if this turns out to be >10% of the claim funnel.
- **Twilio SMS opt-in UX for Barn Calendar external attendees.** v1: opt-in checkbox in the Professional Contact detail panel, owner-side. The external pro never sees a Maneline consent page. TCPA risk is the owner's assertion — document the consent statement in the event-create dialog.
- **Promo code bulk generation UI.** Admin endpoint exists; v1 admin UI is a single-code form + CSV export of redeemed codes. Bulk generation is a console script (`scripts/generate-promo-codes.ts`) until volume demands a UI.
- **HubSpot sync for `maneline_sl_linked` + `maneline_barn_mode_started` + `maneline_promo_redeemed`.** Events wire through the existing `pending_hubspot_syncs` pipeline; no new infrastructure. Revisit event-property shape with SLH ops once first 20 events fire.

---

## 5. Phase 8 gate to Phase 9

Phase 8 is complete when the 8.7 Barn Mode drill is 🟢 (with the usual "deferred on client deliverables" allowance — SL Shopify token and annual price id are the likely holds). Phase 9 (owner growth + mobile shell) begins with:

- Owner interview loop results feeding Phase 9 scope (income modeling, budgets, anomaly detection)
- Native mobile shell (Expo) — same Supabase + Worker backend, mobile-first UI
- Barn Calendar two-way sync to Google Calendar / Apple Calendar
- Barn staff accounts (multi-user per-owner, scoped to care-matrix check-off + event read)
- Drag-and-drop Facility Map visual layout
- Anomaly detection (weight trends, dose adherence, missed farrier cycle alerts)
- Dual-role user bundling (one user = owner + trainer)

*End of docs/phase-8-plan.md — Phase 8 scope: Barn Mode "Barn in a Box" — Barn Calendar + Herd Health Dashboard + Facility Map + Barn Spending + $25/mo subscription + Silver Lining S&S comp linkage.*
