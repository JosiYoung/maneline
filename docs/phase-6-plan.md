# Mane Line — Phase 6 (Closed Beta Launch Hardening) Build Plan

**Owner:** Cedric / OAG
**Window:** Week of 2026-05-25 (per feature map §6 Phase 6 row, "Closed beta")
**Feature map reference:** `MANELINE-PRODUCT-FEATURE-MAP.md` §6 row Phase 6 ("Closed beta — 5 trainers + 20 owners"), §3.3 (Silver Lining admin surfaces — subscriptions panel), §3.4 (Auto-ship open item), §4.6.3 (Emergency support SLA — SMS paging), §9.1 (`integrations/twilio.ts` — new stub).
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 (shadcn Card / Table / Dialog — reused for `/admin/subscriptions`), §10 (error/empty/loading). No new tokens or primitives.
**Law references:** `playbooks/OAG_ARCHITECTURE_LAWS.md` §2 (admin reads via Worker + service_role — subscriptions panel follows the Phase 5 admin pattern), §3 (audit every admin read + write — subscription mutations + SMS dispatches both write `audit_log`), §4 (triple redundancy — `stripe_subscriptions` + `sms_dispatches` flow into L1 Sheets + L2 nightly backup), §7 (RLS day one — new tables service-role-only write), §8 (archive-never-delete — cancelled subscriptions carry `archived_at`, revoked SMS opt-outs keep the row).
**Integrations reference:** `docs/INTEGRATIONS.md` §Twilio (new section), §Stripe Subscriptions (new section under existing Stripe block).

---

## 0. What Phase 6 is, and what it isn't

**In scope (derived from Phase 5 §5 gate + phase-5 TECH_DEBT carryovers + Phase 5 out-of-scope items confirmed by Cedric on 2026-04-20):**

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Closed-beta onboarding runbook** | `docs/onboarding-closed-beta.md` — a step-by-step checklist SLH ops runs for each of the 5 trainers + 20 owners: (a) invite email with magic link + 6-digit PIN, (b) pre-seed `user_profiles` + `trainer_profiles` from an SLH-supplied CSV, (c) auto-approve trainer applications for the list, (d) welcome-tour UI pass on first login. An admin page `/admin/onboarding` shows progress (`invited`/`activated`/`first_session_logged`) per user. |
| 2 | **Invite email + magic-link deep-linking** | `POST /api/admin/invitations` takes `{email, role, barn_name?}`, inserts `invitations` row, sends branded magic-link email via `RESEND_API_KEY` (new secret — migrating off ad-hoc Supabase default emails for beta brand polish). Deep-link format `https://maneline.co/welcome?i=<token>` routes to `/app` or `/trainer` post-auth with a one-time welcome-tour flag. |
| 3 | **`invitations` table** | `id`, `email`, `role` (`owner`/`trainer`), `token` (32-byte base64url), `invited_by` (admin id), `invited_at`, `accepted_at`, `accepted_user_id`, `expires_at` (default 14d), `archived_at`. Unique index on `email` WHERE `accepted_at IS NULL`. RLS service-role only; admin reads via Worker. |
| 4 | **Emergency on-call rotation (Twilio SMS)** | When a `support_tickets` row inserts with `category='emergency_followup'`, Worker `dispatchEmergencyPage` sends SMS via Twilio `messages.create` to the current on-call number. On-call schedule stored in `on_call_schedule` table (`starts_at`, `ends_at`, `user_id`, `phone_e164`, `archived_at`). SMS body: `"Mane Line emergency ticket #{id} — {owner_email} — {subject} — https://maneline.co/admin/support/{id}"`. Every dispatch writes an `sms_dispatches` row (Twilio message_sid, status, cost_cents, delivered_at). Twilio status-callback webhook `/webhooks/twilio-status` updates delivery state. |
| 5 | **`on_call_schedule` + `sms_dispatches` tables** | See feature #4. `sms_dispatches` is append-only, service-role-write. Admin UI at `/admin/on-call` manages the schedule (shadcn Table + add/edit Dialog). Default roster at launch: Cedric 24/7 until SLH ops nominates a backup. |
| 6 | **SMS opt-in + compliance** | Every `sms_dispatches` row references a `phone_e164` that appears in `on_call_schedule` — admin-only roster, no end-user SMS in v1. Twilio toll-free 10DLC registration handled out-of-band by Cedric (one-time). STOP/HELP keywords handled by Twilio default. `TECH_DEBT(phase-6)` marker for "end-user SMS opt-in flow" — deferred past closed beta. |
| 7 | **Durable Object rate limiter** | Migrate `worker.js:rateLimitKv` → a new `RateLimiter` Durable Object class. Single DO per bucket key (`vet:token:{token}`, `chat:rate:{user_id}:{YYYY-MM-DD}`, `upload:read:{user_id}`, `support:tickets:{user_id_or_ip}`, `refund:admin:{admin_id}`). Uses `state.blockConcurrencyWhile` to serialize reads+writes so a 65-parallel burst gets a deterministic 60 × 200 + 5 × 429. Retains 60s window semantics. Closes the phase-5 TECH_DEBT row ("KV-based rate limiter is best-effort under burst"). |
| 8 | **`/admin/subscriptions` panel (stretch)** | Stripe Subscriptions panel for SLH auto-ship SKUs. Worker endpoints `GET /api/admin/subscriptions?status=`, `POST /api/admin/subscriptions/:id/cancel`, `POST /api/admin/subscriptions/:id/pause`. Reads Stripe `subscriptions.list` via Connect (same Stripe-Account header pattern as Phase 5.5 refunds) and mirrors into `stripe_subscriptions` cache (source of truth = Stripe; DB row = read-through cache, refreshed via `customer.subscription.*` webhooks). UI: `/admin/subscriptions` shows active + past_due + cancelled; clicking a row opens `/admin/orders/:id`-style detail with cancel/pause actions. |
| 9 | **`stripe_subscriptions` table + webhook handler** | `id` (Stripe sub id PK), `owner_id` FK, `customer_id`, `status` (Stripe values), `current_period_start/end`, `cancel_at_period_end`, `items jsonb` (price_id + sku + qty per item), `last_synced_at`, `archived_at`. Worker endpoint `/webhooks/stripe` handles `customer.subscription.created/updated/deleted` + `invoice.payment_succeeded/failed` — upserts the cache row, and on `invoice.payment_succeeded` inserts an `orders` row with `source='subscription'` so the GMV/attach-rate math from Phase 5.2 stays correct. |
| 10 | **Phase 5 drill deferrals closed** | Re-run phase-5 §5.9 steps 8, 10, 11, 14, 15, 16 end-to-end once Stripe live keys + HubSpot token + Resend key land. Resolves the second phase-5 TECH_DEBT row ("Admin drill partially deferred"). Not a new code sub-prompt — a verification pass that runs after 6.1–6.4. |
| 11 | **Nightly backup extension** | `invitations`, `on_call_schedule`, `sms_dispatches`, `stripe_subscriptions` all appear in `snapshots/YYYY-MM-DD/` JSON + CSV. Manifest version bumps to `6.0`. |
| 12 | **Observability extension** | `/api/_integrations-health` adds: `twilio.status` (`live` if `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` set AND last dispatch ≤ 7d ago OR zero dispatches ever), `twilio.dispatches_24h`, `twilio.delivery_failures_24h`, `stripe.subscriptions_active_count`, `stripe.subscriptions_past_due_count`, `onboarding.invited_count`, `onboarding.activated_count`, `rate_limiter.mode` (`"kv"` or `"durable_object"` — flips to DO after 6.3 ships). |

**Explicitly out of scope (defer to Phase 7 or v1.1):**
- **Dog parity flip** — still contingent on SLH delivering dog protocols + a dog product line. Data layer has been species-agnostic since Phase 0; copy flip is a one-hour job whenever SLH ships content. Phase 7.
- **HubSpot Deal pipelining** — Phase 5 explicitly resolved "behavioral events, not Deals." Only revisit if SLH asks for conversion-metric pipelines beyond what the events dashboard already shows.
- **Admin protocol editor (`/admin/protocols`)** — still waiting on SLH editorial cadence. SQL-only writes remain the v1 posture.
- **Admin chat inspector / trainer chat surface** — v1.1 (unchanged from Phase 5).
- **End-user SMS** (ticket status updates to owners, emergency acknowledgement to owner) — needs 10DLC end-user opt-in flow + TCPA review. Phase 7 at earliest.
- **Multi-region Twilio failover / secondary SMS provider** — v1 is Twilio-only. If Twilio has a multi-hour outage during beta, admin pages see the ticket in `/admin/support` within 30s anyway (OAG Law 4 triple redundancy — Sheets L1 + inbox widget + SMS).
- **PagerDuty integration** — Twilio SMS covers the 5-person ops team; PagerDuty is overkill until headcount + acknowledgement/escalation requirements justify it.
- **Auto-ship SKU self-serve** (owner picks subscription items from `/app/shop`) — Phase 7. Phase 6 ships the admin-read + admin-cancel side only; subscription creation happens via Stripe Checkout links SLH emails out manually for the 20 beta owners.
- **Multi-admin role tiers** — still v1.1.

**Phase 6 gate to Phase 7 (open beta / public launch):**

> *The 5 trainers and 20 owners from the SLH list have all logged in at least once (`onboarding.activated_count = 25`), 80% have logged a session or expense (`first_session_logged >= 20`), and closed-beta feedback from `support_tickets` + `/admin/onboarding` has burned down to < 5 open tickets. An emergency support ticket inserted at 2 AM pages Cedric's phone within 30s (Twilio `delivered` status in `sms_dispatches`, Grafana alert green). The rate-limiter flip is complete: `/api/_integrations-health` shows `rate_limiter.mode='durable_object'`, and a 65-parallel burst against `/api/vet/:token` returns exactly 60 × 200 + 5 × 429. At least one paid auto-ship subscription is live in Stripe — the admin can see it on `/admin/subscriptions`, cancel it from the UI, and the cancellation webhook round-trips back into `stripe_subscriptions` + `audit_log`. Nightly backup the next morning contains all four new tables. All phase-5 TECH_DEBT rows tagged `phase-5` are resolved and deleted from `docs/TECH_DEBT.md`.*

If a prompt below drifts past this gate, push it to Phase 7 or v1.1.

---

## 1. Dependencies + prerequisites

Before any Phase 6 sub-prompt starts, verify:

| # | Prerequisite | Check |
|---|---|---|
| 1 | Phase 5 code-complete with drill 🟢 on the non-deferred steps | `docs/phase-5-plan.md` §5.9 — 15 of 20 steps green, 5 deferred on client secrets; same "deferred on client deliverables" allowance applies to Phase 6 |
| 2 | SLH delivers the closed-beta list CSV (`email, role, barn_name, phone?`) | Cedric confirms CSV lands in `/supabase/seed/beta-invites.csv` (gitignored; pre-seeded into staging, then prod by `admin/import-invitations.ts` script) |
| 3 | `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_FROM_NUMBER` delivered by Cedric (toll-free 10DLC registered) | Health endpoint shows `secrets_present.TWILIO_*=true`; a live test SMS to Cedric's phone from `/api/_internal/sms-test` returns `delivered` |
| 4 | `RESEND_API_KEY` delivered by Cedric — replaces ad-hoc Supabase default emails for the invitation flow | Confirm via a test invite to `corbettcollc+phase6@gmail.com` that renders with the Mane Line brand header/footer |
| 5 | `STRIPE_SECRET_KEY` + `SLH_CONNECT_ACCOUNT_ID` live (carryover from Phase 3) | Phase 5 row; if still deferred on kickoff, 6.4 (subscriptions panel) ships with endpoints returning `501 stripe_not_configured` |
| 6 | `STRIPE_WEBHOOK_SECRET` (subscription webhooks) delivered — same endpoint `/webhooks/stripe` as Phase 3 checkout, new event types | `stripe listen --forward-to localhost:8787/webhooks/stripe` dry-runs `customer.subscription.created` |
| 7 | `HUBSPOT_PRIVATE_APP_TOKEN` delivered (carryover from Phase 5) | If still deferred, `onboarding.activated` event still queues into `pending_hubspot_syncs` and drains whenever the token lands — no hard block for Phase 6 |
| 8 | Durable Objects bindings approved in wrangler config | `npx wrangler deploy --dry-run` parses new `[[durable_objects.bindings]]` block; migration `new_classes = ["RateLimiter"]` applied |
| 9 | Cedric confirms closed-beta consent language (emergency ticket → SMS to on-call) is legally adequate | Legal review of the `on_call_schedule` roster policy — admin-only SMS, no end-user messages, so TCPA scope is employer/contractor notification only. Document the decision in `docs/INTEGRATIONS.md` §Twilio. |

If any row is red, **do not start Phase 6 sub-prompts** — fix first. Rows 2–7 are client deliverables and can arrive during the phase as long as they land before the sub-prompt that depends on them.

---

## 2. Phase 6 sub-prompts (copy/paste into Claude Code, one at a time)

Same discipline as Phase 4/5: run each verify block, stop on red, fix before moving on.

### 6.1 — Data model: invitations, on-call, SMS dispatches, subscriptions cache

**Scope.** Migration `supabase/migrations/00014_phase6_beta_launch.sql`. Four new tables (`invitations`, `on_call_schedule`, `sms_dispatches`, `stripe_subscriptions`) + RLS day one + archive-never-delete.

**Tables (exact shape):**
- `invitations` — see feature #3. Unique index on `token`; partial unique on `lower(email)` where `accepted_at IS NULL`.
- `on_call_schedule` — `id`, `user_id` FK, `phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$')`, `starts_at`, `ends_at`, `notes`, `archived_at`. Exclusion constraint on overlapping active intervals (`tstzrange(starts_at, ends_at, '[)')` with `&&`) so the schedule can never have two people on-call simultaneously.
- `sms_dispatches` — `id`, `ticket_id` FK nullable (future non-ticket dispatches), `to_phone`, `on_call_user_id`, `twilio_message_sid`, `body text`, `status text` (`queued`/`sent`/`delivered`/`failed`/`undelivered`), `error_code int`, `cost_cents int`, `sent_at`, `delivered_at`, `created_at`. Append-only; service-role-only.
- `stripe_subscriptions` — see feature #9. Partial index `(status, current_period_end)` for the admin panel read.

**Verify.** Migration applies; RLS policies exist per role via `pg_policies`; overlapping-interval exclusion rejects a bad insert in SQL test.

### 6.2 — Invitation flow + welcome tour

**Scope.** Worker endpoints `POST /api/admin/invitations` (single), `POST /api/admin/invitations/bulk` (CSV upload — multipart/form-data, parses to `invitations` rows). SPA admin page `/admin/onboarding` shows the invite list with status chip (`invited`/`activated`/`first_session_logged`) and a "Resend" button per unexpired row. On first login for an `invited` user, set `invitations.accepted_at=now()`, `accepted_user_id=auth.uid()` via a server-side callback at `/api/auth/claim-invite`. Welcome-tour flag: `user_profiles.welcome_tour_seen_at` — SPA renders a 3-step shadcn Dialog on first `/app` or `/trainer` load, posts to `/api/profiles/dismiss-welcome-tour` on completion.

Resend emails via Resend API (`RESEND_API_KEY`). Email template lives in `worker/emails/invitation.ts` with a shared header/footer module (closes the phase-5 open item "Email template library").

**Verify.** Bulk upload 25-row CSV; admin sees 25 `invited` rows; Cedric's test email gets the magic link; click → `/app` loads with welcome tour dialog; dismiss persists.

### 6.3 — Durable Object rate limiter migration

**Scope.** New class `RateLimiter` in `worker/durable-objects/rate-limiter.js` with methods `checkAndIncrement(key, limit, windowMs)` using `state.blockConcurrencyWhile`. Wrangler config adds:

```toml
[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"

[[migrations]]
tag = "v2"
new_classes = ["RateLimiter"]
```

Replace every call site of `rateLimitKv(...)` in `worker.js` with `rateLimitDO(env, key, limit, windowMs)` which forwards to the DO. Keep the old `rateLimitKv` function for one release as a fallback (`env.RATE_LIMITER_MODE === "kv"` flag) — switch the default to DO, flag-off KV on first 24h green, then delete the fallback in 6.9.

Health endpoint: `rate_limiter.mode` reports the active mode.

**Verify.** 65-parallel curl burst against `/api/vet/:token` returns exactly 60 × 200 + 5 × 429 (deterministic, run 3×). `wrangler tail` shows zero `KV PUT failed: 429` errors. Delete the phase-5 TECH_DEBT row.

### 6.4 — Emergency SMS paging

**Scope.** Worker function `dispatchEmergencyPage(env, ticket)` called from the `support_tickets` insert path when `category='emergency_followup'`. Resolves the current on-call row (`select * from on_call_schedule where now() between starts_at and ends_at and archived_at is null limit 1`), composes the SMS body, posts to Twilio `messages.create` with `statusCallback=https://maneline.co/webhooks/twilio-status`. Inserts an `sms_dispatches` row with `status='queued'` and the Twilio `message_sid`.

Webhook endpoint `POST /webhooks/twilio-status` validates the Twilio signature, updates the row's `status` (`sent`/`delivered`/`failed`/`undelivered`), `delivered_at`, `error_code`.

Admin UI: `/admin/on-call` manages the schedule (shadcn Table, add/edit Dialog, roster validation via the DB exclusion constraint).

On-call seed: one row for Cedric, `starts_at=2026-05-25`, `ends_at=2099-01-01` (forever until SLH ops nominates a backup).

**Verify.** Insert a test `support_tickets` row with `category='emergency_followup'` via admin UI; within 30s Cedric's phone rings; `sms_dispatches` row transitions `queued → sent → delivered` as the Twilio callback fires.

**Blocked on Twilio secrets** (Dependency 3). If not live, endpoint logs a warning and writes `sms_dispatches.status='undelivered', error_code=-1` — ticket still reaches `/admin/support` via the existing Phase 5.4 pipeline; no data loss.

### 6.5 — `/admin/subscriptions` panel + Stripe webhook

**Scope.** Worker endpoints per feature #8. SPA page `/admin/subscriptions` with shadcn Table (Active / Past due / Cancelled tabs). Row detail page `/admin/subscriptions/:id` reuses the `/admin/orders/:id` layout pattern: subscription metadata, item list, invoice history (read from Stripe `invoices.list` on demand, not cached).

Cancel action: `POST /api/admin/subscriptions/:id/cancel` with `{at_period_end: true}` (default — no mid-cycle cancellations for v1) → Stripe `subscriptions.update` → webhook updates cache row.

Pause action: `POST /api/admin/subscriptions/:id/pause` with `{behavior: 'mark_uncollectible', resumes_at}` → Stripe `subscriptions.update` with `pause_collection`.

Webhook additions to existing `/webhooks/stripe` handler: `customer.subscription.created/updated/deleted`, `invoice.payment_succeeded` (upserts `stripe_subscriptions` + inserts `orders` with `source='subscription'`), `invoice.payment_failed` (flags the sub row `status='past_due'`).

**Verify.** Create a $1/mo test subscription via Stripe dashboard; webhook populates `stripe_subscriptions`; `/admin/subscriptions` shows it; cancel at period end; row updates within 2s.

**Blocked on Stripe keys** (Dependency 5/6). Same pattern as Phase 5.5 refund — UI wires, endpoint returns `501 stripe_not_configured` until keys land.

### 6.6 — Closed-beta seed + import script

**Scope.** New `supabase/seed/beta-invites.csv` (gitignored) + import runner `scripts/import-beta-invites.ts` that reads the CSV, inserts `invitations` rows with 14-day expiry, enqueues per-row invitation emails via the 6.2 `bulk` endpoint.

For trainers in the CSV: auto-approve their `trainer_profiles.application_status='approved'` on accept-invite (skip the `/admin/trainer-applications` queue — these are SLH-vetted humans). Audit-log stamp: `action='admin.trainer.auto_approve', context={reason: 'closed_beta_import', batch: '2026-05-25'}`.

For owners in the CSV with a pre-supplied `barn_name`: pre-seed a `user_profiles` row (unconfirmed) so their first login lands on `/app` with the barn already set. Emergency escape hatch: `scripts/revoke-invitation.ts <email>` archives the invite and forces a re-invite flow.

**Verify.** Dry-run against staging with the real CSV; admin `/admin/onboarding` shows 25 `invited` rows; one smoke-test invite accepted by Cedric's test account → status flips to `activated` and audit_log shows the auto-approve.

### 6.7 — Observability + backup extension

**Scope.** `/api/_integrations-health` additions per feature #12. `nightly-backup/index.ts` TABLES list adds the four new tables; manifest version → `6.0`. Add `rate_limiter.mode` field — reads from a Worker env var toggled by the 6.3 rollout.

**Verify.** Next nightly-backup invocation shows `invitations_count`, `on_call_schedule_count`, `sms_dispatches_count`, `stripe_subscriptions_count` in the manifest. Health endpoint shows `twilio.status`, `stripe.subscriptions_active_count`, etc.

### 6.8 — Phase 5 deferrals close-out

**Scope.** No new code — re-run phase-5 §5.9 steps 8, 10, 11, 14, 15, 16 against the live-secret environment. Step 8 (trainer reject email) lands automatically once `RESEND_API_KEY` is in place (6.2 wires the sender). Step 14 (strict 429) closes when 6.3 ships. Steps 10–11 (Stripe refund) + 15–16 (HubSpot drain + dead-letter) close when the respective secrets land (Dependency 5 + 7). Delete the phase-5 TECH_DEBT row for partial drill once all six steps are 🟢.

**Verify.** `docs/phase-5-plan.md` §5.9 is 20/20 green. Two phase-5 TECH_DEBT rows removed in the same commit as the drill re-run notes.

### 6.9 — Closed-beta drill (25 steps)

Mirrors the Phase 3/4/5 drill pattern. Steps include:
1. Migration `00014` applies clean on staging + prod.
2. RLS enumerated on all four new tables (`pg_policies`); `sms_dispatches` + `stripe_subscriptions` service-role-only.
3. `POST /api/admin/invitations` requires admin role (403 for owner JWT).
4. Bulk CSV import → 25 `invitations` rows.
5. Test invite email renders with Mane Line brand (visual check).
6. Magic-link accept → `invitations.accepted_at` stamped, `user_profiles` row exists.
7. Welcome tour shows on first login; dismiss persists.
8. Trainer from CSV auto-approved on accept (no pending-review gate).
9. `/admin/onboarding` shows 25 rows with correct status.
10. `on_call_schedule` exclusion constraint rejects overlapping interval insert (SQL test).
11. Emergency `support_tickets` insert → Twilio SMS → Cedric's phone rings < 30s.
12. `sms_dispatches` row transitions `queued → sent → delivered`.
13. Twilio status webhook signature validation rejects a forged POST.
14. `rate_limiter.mode='durable_object'` on health endpoint.
15. 65-parallel burst against `/api/vet/:token` returns exactly 60 × 200 + 5 × 429 (3 consecutive runs).
16. Test subscription created via Stripe dashboard → webhook populates `stripe_subscriptions`.
17. `/admin/subscriptions` shows the active sub.
18. Cancel-at-period-end → webhook updates row within 2s, `audit_log` has `admin.subscription.cancel`.
19. `invoice.payment_succeeded` webhook inserts `orders` row with `source='subscription'`.
20. Phase-5 §5.9 steps 8, 10, 11, 14, 15, 16 all 🟢 (see 6.8).
21. Both phase-5 TECH_DEBT rows deleted.
22. Nightly backup v8 writes all four new tables; manifest `version: "6.0"`.
23. `/api/_integrations-health` returns `twilio.*`, `stripe.subscriptions_*`, `onboarding.*` blocks.
24. Static grep: zero `@heroui/react` in `pages/admin/onboarding/**`, zero hex literals, zero `console.log` on error paths.
25. 25 beta users have `activated_at IS NOT NULL` AND ≥ 20 have `first_session_logged_at IS NOT NULL` at the drill close.

---

## 3. UI Contract (non-negotiable)

Same tokens as Phases 2–5. Zero new tokens. Closed-beta surfaces are shadcn-pure. `/admin/onboarding` uses shadcn `Table`; on-call schedule uses shadcn `Table` + `Dialog`; subscriptions panel reuses the Phase 5 orders layout; welcome tour is a 3-step shadcn `Dialog` with `Progress`.

Forbidden:
- No direct `supabase.from('sms_dispatches')` or `invitations` queries from the SPA — Worker + service_role only (OAG Law 2).
- No Twilio or Stripe secrets in the client bundle.
- No long-polling on `/admin/onboarding` — `useQuery` with a 60s `refetchInterval`.
- No bulk delete anywhere — archive-only (OAG Law 8). On-call schedule rows get `archived_at` on remove, never `DELETE`.
- No `any` — Zod on every Worker request body, every admin endpoint response, every Twilio + Stripe webhook payload.
- No hard-coded phone numbers in source — every outbound SMS target comes from `on_call_schedule`.
- No `console.log` on error paths — `logger.error` (Worker) or Sonner toast (SPA). `TECH_DEBT(phase-6)` if a shortcut is unavoidable.
- No silent SMS failures — every dispatch writes `sms_dispatches` with a terminal status within 5 minutes of send, even if Twilio returns an error.

---

## 4. Resolved decisions + open items

### Resolved

1. **Twilio is the v1 SMS provider.** Single-provider posture. No PagerDuty, no AWS SNS, no multi-region failover. If Twilio is down during beta, admin sees the ticket via `/admin/support` anyway (OAG Law 4 redundancy through Sheets L1 + inbox widget).
2. **Admin-only SMS for v1.** Only `on_call_schedule` numbers receive messages. No end-user SMS — deferred past closed beta for 10DLC / TCPA scope reasons.
3. **Subscription creation is out-of-band.** SLH emails Stripe Checkout links to the 20 beta owners manually. Phase 6 admin panel is read + cancel + pause only. Self-serve subscription creation from `/app/shop` is Phase 7 if beta data says owners want it.
4. **Rate-limiter DO keyed per bucket, not per hot key.** Single DO class, bucket key becomes the DO name. Simpler than per-key instances; the 60s sliding window + in-DO state fits well under a single DO's throughput ceiling (~1000 req/s per DO, way more than any of our bucket caps).
5. **Resend for transactional emails, not Postmark / SendGrid.** Brand polish for the beta without a long procurement cycle. Revisit at 10k users or whenever SLH has a marketing-automation requirement.
6. **Cancel-at-period-end default.** No mid-cycle cancellations for v1 — too many partial-refund + pro-rating edge cases. If an owner wants an immediate cancel + refund, admin issues a Phase 5.5 refund after the Phase 6 cancel.
7. **Auto-approve closed-beta trainers.** The 5 trainers in the SLH CSV bypass `/admin/trainer-applications` because SLH has already vetted them. Audit-logged as `admin.trainer.auto_approve` with a `batch` context field so any future abuse is traceable.
8. **Welcome tour is dismissible and one-shot.** Owners and trainers each get a 3-step tour on first login. No re-trigger, no help-menu revisit for v1. If users ask for a replay button, that's Phase 7.

### Open items to resolve during Phase 6 (not gating code-complete)

- **Does SLH want a weekly KPI digest email to admin?** Would reuse the Phase 5 `/api/admin/kpis` endpoint + a cron. Probably Phase 7.
- **Should `sms_dispatches` cost cents roll up into a monthly Twilio spend tile on `/admin`?** One-line SQL; add if Twilio bill nears $100/mo.
- **Auto-ship item SKU mapping.** The 6.5 subscription cache stores `items jsonb` but the admin UI needs a human-readable line (e.g. "Joint Formula × 2 / monthly"). Today that reads Shopify product titles via the Phase 3.5 `products` table — verify coverage once SLH publishes the auto-ship SKU list.
- **Emergency SMS retry policy.** Current plan: Twilio's built-in 3-retry on `queued` is the whole retry ladder. If the ops team wants a secondary page to a backup number after 5m without delivery, add a cron that scans `sms_dispatches.status='sent'` + `delivered_at IS NULL` + `sent_at < now() - 5m` and re-dispatches to the second row in `on_call_schedule`.
- **On-call ack flow.** v1 dispatches SMS and hopes. No SMS reply parsing for "ACK 1234" or similar. If mean-time-to-ack is the thing ops wants to track, add a `sms_replies` table + Twilio inbound webhook in Phase 7.
- **Closed-beta exit criteria.** Currently: 25/25 activated, ≥20 logged a session, <5 open tickets. Revisit at week 2 — if ticket volume is still high at week 3, the "open beta" cutover slides.
- **Invitation expiry window.** 14 days is a guess. Check resend rate after the first batch; if >20% of invites expire unaccepted, lower to 7d so the resend loop tightens.

---

## 5. Phase 6 gate to Phase 7

Phase 6 is complete when the 6.9 closed-beta drill is 🟢 (with the usual "deferred on client deliverables" allowance — Twilio, Resend, Stripe live keys are the likely holds). Phase 7 (open beta / public launch) begins with:
- Beta-to-production cutover checklist (rollback plan, data backfill verification, DNS TTL drop)
- Dog parity flip IF SLH delivers dog protocols + a dog product line
- Owner self-serve subscription creation on `/app/shop`
- Public landing page SEO + analytics pass
- Support SLA documented + published (first-response target, emergency-page target)
- HubSpot Deal pipelining if SLH wants conversion-metric pipelines beyond behavioral events

*End of docs/phase-6-plan.md — Phase 6 scope: Closed-beta onboarding + emergency on-call SMS + DO rate-limiter + subscriptions panel (stretch) + Phase 5 deferrals close-out.*
