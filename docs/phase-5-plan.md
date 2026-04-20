# Mane Line — Phase 5 (Admin Portal + Vet View + HubSpot sync) Build Plan

**Owner:** Cedric / OAG
**Window:** Week of 2026-05-18 (per feature map §6 Phase 5 row)
**Feature map reference:** `MANELINE-PRODUCT-FEATURE-MAP.md` §6 row Phase 5 (“Admin Portal + Vet View + HubSpot sync”), §3.1 (Vet View — “Share 12-month record with vet”), §3.3 (Silver Lining admin surfaces: KPI dashboard, user directory, trainer vetting queue, support inbox, refunds, subscriptions), §4.6.2 (HubSpot event taxonomy), §9.1 (`integrations/hubspot.ts` stub).
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 (shadcn Card / Table / Dialog), §10 (error/empty/loading), `BottomNav` / `SidebarNav` patterns from Phases 1 + 2 for admin nav.
**Law references:** `playbooks/OAG_ARCHITECTURE_LAWS.md` §2 (admin reads via Worker + service_role — no anon admin queries), §3 (audit every admin read + write), §4 (triple redundancy — `support_tickets`, `hubspot_sync_log`, `order_refunds` all flow into L1 Sheets + L2 nightly backup), §7 (RLS day one — admin tables are service_role-only write, role-gated read), §8 (archive-never-delete — refunds, support tickets, vet share tokens all carry `archived_at`).
**Integrations reference:** `docs/INTEGRATIONS.md` §HubSpot.

---

## 0. What Phase 5 is, and what it isn't

**In scope (derived from feature map §6 Phase 5 row + §3.1 + §3.3 + §4.6.2 + current TECH_DEBT phase-5 rows):**

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Admin KPI dashboard** | Silver Lining admin opens `/admin`, sees four live tiles: WAU, MAU, GMV (last 30d), attach rate (orders/owner). Data served by a new Worker endpoint `GET /api/admin/kpis` that reads via service_role and is allowed ONLY for `user_profiles.role = 'silver_lining'`. Every call writes an `audit_log` row. |
| 2 | **Admin user directory** | `/admin/users` lists all `profiles` (+ joined `trainer_profiles` / `animals` counts) with server-side search by email, role filter, CSV export. Service_role reads; every row view logged. |
| 3 | **Trainer vetting queue** | `/admin/trainer-applications` shows `trainer_applications.status='pending'` queue with approve / reject + reason. Approve flips `trainer_profiles.application_status='approved'` + stamps `reviewed_by/reviewed_at/review_notes`. Reject keeps the row but archives. Trainers land off `/trainer/pending-review` on approval. |
| 4 | **Vet View scoped magic link** | Owner on `/app/animals/:id/records` clicks **“Share 12-month record”**; receives a one-tap copy link `https://maneline.co/vet/:token`. Vet opens the link with no auth, sees read-only records (Coggins, medical notes, last 12 months), zero ability to navigate anywhere else. Token expires in 14 days by default (owner-configurable: 24h / 7d / 14d / 30d). Each view writes `audit_log`. |
| 5 | **`vet_share_tokens` table** | Per OAG Law 8 — `owner_id`, `animal_id`, `token` (opaque 32-byte base64url), `scope jsonb` (`{records: true, media: bool, sessions: bool}` — v1: records + media only), `expires_at`, `viewed_at`, `view_count`, `revoked_at`, `archived_at`. RLS: owner sees own; service_role writes. Worker `/vet/:token` handler is the ONLY anon read path. |
| 6 | **HubSpot contact + event sync** | Four behavioral events wire up: `maneline_signup` (on `profiles.insert` with email), `maneline_trainer_applied` (on `trainer_applications.insert`), `maneline_order` (on Stripe `checkout.session.completed` — includes source=`shop`/`in_expense`/`chat`), `maneline_emergency_flagged` (on `chatbot_runs.emergency_triggered=true`). Worker endpoint `POST /webhooks/hubspot-sync` is fired from a pg_cron that drains `pending_hubspot_syncs`. On HubSpot 5xx or timeout, row retries up to 5× with 15m backoff; after 5 failures row flips to `status='dead_letter'` and alerts Cedric. |
| 7 | **`hubspot_sync_log` + `pending_hubspot_syncs` tables** | Queue: `id`, `event_name`, `payload jsonb`, `attempts`, `next_run_at`, `status` (`pending`/`sent`/`dead_letter`), `last_error`, `created_at`. Log: append-only one row per successful send with `hubspot_contact_id`, `hubspot_deal_id`, `payload`, `response jsonb`, `latency_ms`. Both service_role-only. |
| 8 | **Support inbox** | In-app widget in every portal (owner + trainer + admin) posts to `POST /api/support-tickets`. Admin reads at `/admin/support`, claims a ticket, replies via email relay. Categories: `account`, `billing`, `bug`, `feature_request`, `emergency_followup`. Emergency tickets paged via SMS to Cedric (Phase 6 unless he pushes it earlier). |
| 9 | **`support_tickets` table + Sheets L1 mirror** | `id`, `owner_id` nullable (anon tickets allowed for the public landing contact form), `category`, `subject`, `body`, `status` (`open`/`claimed`/`resolved`/`archived`), `assignee_id`, `resolved_at`, `first_response_at`, `archived_at`. Every insert flows to the Sheets L1 mirror via the existing Apps Script relay (per OAG Law 4). |
| 10 | **Refund admin action** | `/admin/orders/:id` gets a **Refund** button. POST to `/api/admin/orders/:id/refund` with `{amount_cents, reason}`; Worker calls Stripe Connect `refunds.create` with Connect `Stripe-Account` header + idempotency key `refund:{order_id}:{attempt}`; on success inserts `order_refunds` row and archives the `orders` row to `status='refunded'`. |
| 11 | **`order_refunds` table** | `id`, `order_id` FK, `stripe_refund_id`, `amount_cents`, `reason text` (admin free-form), `refunded_by` (admin user id), `stripe_status` (`pending`/`succeeded`/`failed`), `created_at`, `updated_at`. RLS: owner reads own (via join on `orders.owner_id`); admin writes via service_role. |
| 12 | **`audit_log` table** | Per OAG §3. `id`, `actor_id` (user id or `null` for system), `actor_role`, `action` (e.g. `admin.kpi.read`, `vet_view.record.read`, `admin.user.search`), `target_table`, `target_id`, `context jsonb` (query params, result count, etc.), `ip`, `user_agent`, `created_at`. Append-only; service_role-only write; admin-only read via `/admin/audit`. |
| 13 | **Admin RLS reconciliation** | Migration 00002's REVISIT block (phase-5 TECH_DEBT row) is closed by this phase: the `admin_*` RLS policies dropped in 00004 are explicitly *not* reintroduced; admin reads route through the Worker + service_role (OAG Law 2). Remove the TECH_DEBT marker once Phase 5 sub-prompt 5.1 lands. |
| 14 | **Nightly backup extension** | `vet_share_tokens`, `hubspot_sync_log`, `pending_hubspot_syncs`, `support_tickets`, `order_refunds`, `audit_log` all appear in `snapshots/YYYY-MM-DD/` JSON + CSV. Manifest version bumps to `5.0`. |
| 15 | **Observability extension** | `/api/_integrations-health` adds: `hubspot.status` (`live` if `HUBSPOT_PRIVATE_APP_TOKEN` set AND `hubspot_sync_log` has a row in the last 24h), `hubspot.queue_depth` (pending rows older than 15m), `hubspot.dead_letter_count_24h`, `admin.audit_writes_24h`, `vet_view.scoped_reads_24h`. |

**Explicitly out of scope (defer to Phase 6 or v1.1):**
- **Admin surface for protocol editing (`/admin/protocols`)** — noted as 4.5 follow-up in `docs/phase-4-plan.md` §4. Deferred until SLH provides an editorial cadence; until then, protocol writes are SQL.
- **Admin chat inspector (`/admin/chat-inspector`)** — Phase 4 plan §0.B2 deferred this to v1.1.
- **Trainer chat surface (`/trainer/chat`)** — same, v1.1.
- **Subscription / auto-ship management** (`/admin/subscriptions`) — Stripe Subscriptions is not live yet; `order_refunds` ships in Phase 5 but the subscription panel waits until Phase 6 once SLH decides on an auto-ship SKU list.
- **Dog parity flip** — data layer is species-agnostic, but the horse-first UI copy stays through Phase 5.
- **SMS paging for emergency support tickets** — Phase 6 (needs Twilio account + opt-in flow).
- **HubSpot Marketing Hub features (workflows, lists)** — out of scope; we only sync contacts + events, not workflow definitions.
- **SSO / SAML for admin** — Phase 7+ if SLH enterprise lands.
- **Multi-admin role tiers** (super-admin vs. support-agent) — v1.1 once Cedric knows how SLH ops structures itself.

**Phase 5 gate to Phase 6:**

> *An SLH ops admin logs in, opens `/admin`, sees today's WAU/MAU/GMV/attach-rate, drills into `/admin/users` and exports a CSV of the owner list, approves a pending trainer application (email sent, trainer lands on `/trainer` with the pending-review gate cleared), pulls up a completed order on `/admin/orders/:id` and issues a $10 refund (Stripe Connect fires, `order_refunds` row exists, owner sees the refund status on `/app/orders/:id`). Separately, an owner on `/app/animals/:id/records` generates a share link, pastes it into a WhatsApp to her vet; the vet opens the link on a phone (no auth), sees the last 12 months of records, and the `vet_share_tokens` row shows `view_count=1, viewed_at=<now>`. Meanwhile, HubSpot's contact list grows by the day's signup + trainer application + order + emergency flag, with zero duplicates and `pending_hubspot_syncs` sitting empty after the next cron tick. Nightly backup the next morning contains all six new tables.*

If a prompt below drifts past this gate, push it to Phase 6 or v1.1.

---

## 1. Dependencies + prerequisites

Before any Phase 5 sub-prompt starts, verify:

| # | Prerequisite | Check |
|---|---|---|
| 1 | Phase 4 code-complete (Protocol Brain live) | `docs/phase-4-plan.md` §4.10 drill green OR deferred rows blocked only on client deliverables (current state 2026-04-19: 4.10 deferred on client secrets for Stripe + Shopify; Phase 5 does not depend on those for its own drill) |
| 2 | `HUBSPOT_PRIVATE_APP_TOKEN` + `HUBSPOT_PORTAL_ID` delivered by SLH and set via `npx wrangler secret put` | Health endpoint shows `secrets_present.HUBSPOT_PRIVATE_APP_TOKEN=true` |
| 3 | `STRIPE_SECRET_KEY` + `SLH_CONNECT_ACCOUNT_ID` live (reused from Phase 3) | Refund action needs Connect account id; if not live, refund UI renders disabled with "waiting on keys" copy same as Phase 3 |
| 4 | Silver Lining delivers the **email relay address** for support replies + admin outbound mail | Cedric confirms; stored as `SUPPORT_REPLY_FROM` Worker secret |
| 5 | `pg_cron` available (already used by shopify-catalog-sync + seed-protocol-embeddings) | `select * from cron.job;` lists prior crons |
| 6 | Sheets L1 relay (Apps Script) still accepts new event types | Cedric confirms; add `support_ticket_inserted` + `hubspot_sync_dead_letter` to the allowed event list |
| 7 | Red-team review of the vet-token URL surface (token length, expiry default, rate limit) | Cedric + legal sign off on 32-byte token, 14-day default, `vet:token:{token}` KV rate limit = 60 GETs / 60s (anyone hot-linking hits the wall fast) |
| 8 | Admin role gate already works — `user_profiles.role='silver_lining'` → redirected to `/admin`, everyone else 404s | Phase 0 RLS drill covered this; re-verify on Phase 5 kickoff |
| 9 | `audit_log` write path is cheap enough to run on every admin read | Target: <5 ms p99 added latency. Single INSERT with a partial index on `(actor_id, created_at)`; no join. |

If any row is red, **do not start Phase 5 sub-prompts** — fix first. Rows 2–4 are client deliverables and can arrive during the phase as long as they land before prompts 5.6 (HubSpot), 5.5 (refund), 5.4 (support inbox).

---

## 2. Phase 5 sub-prompts (copy/paste into Claude Code, one at a time)

Same discipline as Phase 4: run each verify block, stop on red, fix before moving on.

### 5.1 — Data model + audit log

**Scope.** Migration `supabase/migrations/00013_phase5_admin_vet_hubspot.sql`. Six new tables + `audit_log` + RLS day one + archive-never-delete. Also drops the stale `admin_*` REVISIT block tagged in migration 00002. Closes the two phase-5 TECH_DEBT rows about admin RLS.

**Tables (exact shape):**
- `audit_log` — see feature #12 above. Partial index `(actor_id, created_at DESC)` + `(action, created_at DESC)`.
- `vet_share_tokens` — see feature #5. Unique index on `token`.
- `hubspot_sync_log`, `pending_hubspot_syncs` — see feature #7.
- `support_tickets` — see feature #9. Partial index `(status, created_at)` for the admin queue read.
- `order_refunds` — see feature #11. Unique index on `stripe_refund_id`.

**Verify.** Migration applies; `select count(*) from audit_log` = 0; RLS policies exist per role via `pg_policies`.

### 5.2 — Admin KPI dashboard + user directory

**Scope.** Worker endpoints `GET /api/admin/kpis` + `GET /api/admin/users?q=&role=&page=`. SPA pages `/admin` (KPI tiles), `/admin/users` (table + search + CSV export). Both go through service_role; each read writes an `audit_log` row with `action='admin.kpis.read'` / `action='admin.user.search'`. CSV export is a second endpoint `GET /api/admin/users.csv` for streaming download.

KPI aggregations (all service_role SQL):
- WAU = distinct `user_profiles.id` with a write to any owner/trainer surface in last 7d
- MAU = same, 30d window
- GMV = `sum(orders.amount_cents)` where `status='paid' and created_at > now() - 30d`
- Attach rate = `count(distinct orders.owner_id) / count(distinct user_profiles.id where role='owner')` in last 30d

**Verify.** Admin loads `/admin`, four tiles render with non-null values; `audit_log` has the two reads stamped.

### 5.3 — Trainer vetting queue

**Scope.** Page `/admin/trainer-applications`. Worker endpoints: `GET /api/admin/trainer-applications` (list pending + recent decisions), `POST /api/admin/trainer-applications/:id/approve` + `/reject` with `{reason?}`. On approve, update `trainer_profiles.application_status='approved'`, stamp `reviewed_by=<admin>`, `reviewed_at=now()`, `review_notes=<reason>`; on reject, keep the row, mark `application_status='rejected'`, stamp same, archive. Send email via `SUPPORT_REPLY_FROM` on either decision. Emit `maneline_trainer_decision` HubSpot event (see 5.6).

**Verify.** A pending trainer is approved from the UI; on next login, the `/trainer/pending-review` gate clears; `trainer_profiles.application_status='approved'` in DB.

### 5.4 — Support inbox (widget + admin reader)

**Scope.** SPA widget component `app/src/components/shared/SupportWidget.tsx` mounted on every portal shell (owner + trainer + admin) — floating button opens a shadcn Sheet with category select + subject + body. Anonymous landing version posts without auth (category restricted to `feature_request` + `bug`). Worker endpoints: `POST /api/support-tickets` (rate-limited 10/hour/user or IP), `GET /api/admin/support-tickets?status=`, `POST /api/admin/support-tickets/:id/claim`, `POST /api/admin/support-tickets/:id/resolve`. Admin UI at `/admin/support`.

On insert: Sheets L1 relay + HubSpot `maneline_support_ticket_opened` event.

**Verify.** Owner submits a ticket from the widget; admin sees it in `/admin/support`; admin claims + resolves; Sheets L1 has the row.

### 5.5 — Refund admin action

**Scope.** Worker endpoint `POST /api/admin/orders/:id/refund` takes `{amount_cents, reason}`, validates admin role, calls `stripe.refunds.create` with `Stripe-Account: <connect_id>` + `Idempotency-Key: refund:{order_id}:{attempt_number}`. On Stripe `succeeded`, insert `order_refunds` row + update `orders.status='refunded'` + `archived_at=now()`. On Stripe `pending`, insert row with `stripe_status='pending'` and wait for the webhook (`charge.refunded`) to flip to `succeeded`. UI: `/admin/orders/:id` gets a Refund button + a Refund modal (amount defaulted to full, reason textarea). Owner-side: `/app/orders/:id` shows a "Refunded — $X" line under the order once the row lands.

**Verify.** Test order → refund $1 → Stripe dashboard shows refund → `order_refunds` row `stripe_status='succeeded'` → owner sees "Refunded $1.00" on `/app/orders/:id`.

**Blocked on Stripe keys** (see Dependency 3). If keys are not live on kickoff, 5.5 lands with the UI wired + the endpoint returning `501 stripe_not_configured` same as Phase 2 pattern.

### 5.6 — HubSpot sync queue + cron

**Scope.** Worker endpoint `POST /api/_internal/hubspot-enqueue` called from Postgres triggers on `profiles.insert`, `trainer_applications.insert`, `orders.insert`, `chatbot_runs` (when `emergency_triggered=true`), `trainer_profiles.application_status` update. Each trigger composes a payload and INSERTs into `pending_hubspot_syncs`. pg_cron runs every 5m: `select drain_hubspot_syncs()` — a plpgsql function that picks `status='pending' and next_run_at <= now()` rows (LIMIT 50), marks them `status='sending'`, and POSTs to a Worker `/api/_internal/hubspot-send` endpoint (gated by `X-Internal-Secret`). The Worker calls HubSpot's v3 contacts API (`upsert` via `idProperty=email`) + events API (`behavioral_event_completions`). On 2xx → insert `hubspot_sync_log` + flip `status='sent'`; on 4xx with validation error → flip to `dead_letter` immediately; on 5xx / timeout → bump `attempts`, set `next_run_at = now() + '15m' * 2^attempts`, and when `attempts >= 5` flip to `dead_letter`.

Observability: add `/api/_integrations-health` fields per feature #15.

**Verify.** Insert a fake `profiles` row; next cron tick drains; `hubspot_sync_log` has the row; HubSpot portal shows the new contact.

**Blocked on HubSpot token** (Dependency 2). If not live, endpoint returns `501 hubspot_not_configured` and the queue accumulates but never drains — Phase 5 drill can run against a sandbox HubSpot if SLH provides one; otherwise the HubSpot piece is the last to ship.

### 5.7 — Vet View scoped magic link

**Scope.** Owner UI: `/app/animals/:id/records` gets a **Share 12-month record** button that opens a shadcn Dialog — expiry picker (24h / 7d / 14d / 30d) + scope checkboxes (records default on, media optional). POST `/api/vet-share-tokens` returns `{token, url}`. Copy-to-clipboard + a "Revoke" link on the same dialog. Worker anon endpoint `GET /vet/:token` validates + serves a read-only HTML shell (or redirects to an SPA route that renders without auth — pick SPA for consistency with Phase 4.4 routing). Each view writes `audit_log` with `action='vet_view.record.read'` + IP + UA. Rate limit `vet:token:{token}` = 60 GETs / 60s via KV.

**Verify.** Owner generates link, pastes in a separate browser profile (no auth), sees records, `vet_share_tokens.view_count` increments, `audit_log` has the read row; revoke removes access on next refresh.

### 5.8 — Observability + backup extension

**Scope.** `/api/_integrations-health` additions per feature #15. `nightly-backup/index.ts` TABLES list adds the six new tables; manifest version → `5.0`. No other edits.

**Verify.** Next nightly-backup invocation shows `support_tickets_count`, `vet_share_tokens_count`, `hubspot_sync_log_count`, `pending_hubspot_syncs_count`, `order_refunds_count`, `audit_log_count` in the manifest.

### 5.9 — Admin drill (20 steps)

Mirrors the Phase 3/4 drill pattern. Steps include: migration applies clean, RLS policies enumerated, admin redirected from `/admin` when role≠silver_lining, KPIs non-null with seeded data, user directory search returns expected row, CSV export stream ≥200 OK, trainer approve → pending-review gate clears, trainer reject → notified email sent, support ticket round-trip, refund $1 hits Stripe + `order_refunds` + owner UI, refund webhook idempotency (simulate replay), vet share link works in a clean browser, revoke works, vet rate-limit at 61st request returns 429, HubSpot queue drains, HubSpot dead-letter after 5 failures alerts Cedric, audit_log count per action type matches expectations, nightly backup contains all six tables, `/api/_integrations-health` shows `hubspot.status=live`, static grep: zero `@heroui/react` in `pages/admin/**`, zero hex literals, zero `console.log` on error paths.

---

## 3. UI Contract (non-negotiable)

Same tokens as Phases 2–4. Zero new tokens. Admin surface is shadcn-pure. Tables use shadcn `Table`; the support widget is a shadcn `Sheet`; share dialog is shadcn `Dialog`; KPI tiles are shadcn `Card` — same recipe as Phase 3's shop grid.

Forbidden:
- No direct `supabase.from('audit_log')` queries from the SPA. Every admin read goes through a Worker endpoint (OAG Law 2).
- No admin secrets in client bundle. `HUBSPOT_PRIVATE_APP_TOKEN` lives in Worker secrets only.
- No long-polling on the support inbox — `useQuery` with a 30s `refetchInterval` is enough for v1.
- No bulk delete anywhere — archive-only (OAG Law 8).
- No `any` — Zod on every Worker request body + every admin endpoint response.
- No `console.log` on error paths — Sonner toast (SPA) or structured `logger.error` (Worker). `TECH_DEBT(phase-5)` if a shortcut is unavoidable.

---

## 4. Resolved decisions + open items

### Resolved

1. **Admin reads route through the Worker, not RLS.** OAG Law 2 — `user_profiles.role='silver_lining'` is verified server-side in every admin endpoint; Supabase does service_role queries. This closes the two phase-5 TECH_DEBT rows about admin RLS (00002 REVISIT block + admin_* dropped policies); no new RLS policies are added for admins.
2. **Vet token length = 32 bytes base64url (43 chars).** Same convention as Stripe session ids. Short enough to paste, long enough to be unguessable.
3. **Vet token default expiry = 14 days.** Owner can pick 24h / 7d / 14d / 30d. No "permanent" option — vet access is always time-boxed.
4. **HubSpot queue retry = 15m × 2^attempts, max 5 attempts, then dead-letter.** Email Cedric on dead-letter so a real human looks.
5. **Support widget lives on all portals, but anon tickets are restricted** to categories `bug` and `feature_request`. Billing + account tickets require a logged-in session so we have an identity.
6. **Refunds are full-or-partial.** Partial refund minimum is $1 (Stripe's minimum for most currencies). Admin-only; no owner-initiated refunds.
7. **HubSpot behavioral events, not custom Deal objects.** Per feature map §4.6.2 — v1 CRM posture is "own the contact, let HubSpot do the lifecycle math." Deals only arrive in Phase 6 if SLH decides to pipeline-track orders.

### Open items to resolve during Phase 5 (not gating code-complete)

- **Does SLH ops want a "bulk approve" trainer action?** Probably not for v1 — manual review is the point. Flag in 5.3 review.
- **Should emergency support tickets page Cedric via SMS?** Phase 6 unless he pushes it in — needs Twilio secret + opt-in flow.
- **Admin impersonation ("sign in as user")?** Off the table for v1 — too much audit-log rope. Revisit post-launch if support volume requires it.
- **Data retention on `audit_log`?** Default: keep 180 days, archive older rows to R2 quarterly. Decide before the 90-day mark.
- **Email template library** — transactional emails (trainer approval, refund issued) currently get ad-hoc copy per endpoint. Consolidate into a `worker/emails/` module with a shared header/footer once we have ≥3 templates live.
- **Rate limit on `/api/admin/users?q=` search** — current plan is no limit for admin role. Revisit if someone scripts a scrape.

---

## 5. Phase 5 gate to Phase 6

Phase 5 is complete when the 5.9 admin drill is 🟢 (with the same "deferred on client deliverables" allowance as Phase 3/4 — HubSpot + Stripe keys are the likely deferrals). Phase 6 (closed beta) begins with:
- 5 trainers + 20 owners onboarded from SLH's existing list
- Emergency support on-call rotation live (Cedric + SLH ops)
- `/admin/subscriptions` panel once SLH decides auto-ship SKUs
- Dog parity flip IF SLH delivers dog protocols + SLH product line
- HubSpot Deal pipelining if SLH wants conversion metrics beyond events

*End of docs/phase-5-plan.md — Phase 5 scope: Admin Portal + Vet View + HubSpot sync + support inbox + refunds + audit log.*
