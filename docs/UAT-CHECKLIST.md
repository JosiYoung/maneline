# Mane Line — User Acceptance Testing Checklist

**Target:** HEAD `af71dc9` (Phase 8 Barn Mode + Phase 9 trainer-paywall / messaging / ratings — all shipped to repo)
**Supabase:** `vvzasinqfirzxfduenjx` (migrations 00002–00029 applied)
**Generated:** 2026-04-24 from a 4-agent audit swarm (smoke test, security, DB schema, QA/workflow).
**Raw findings:** see [`audits/2026-04-24-preflight-swarm.md`](./audits/2026-04-24-preflight-swarm.md).

Use the PIN shortcuts in `memory/demo_pins.md` to sign in as the three dev accounts (owner / trainer / silver_lining) without email round-trips.

---

## How to use this document

- Each section is a flow to walk through in order. Tick the box only when the UI action _and_ the DB write have both been verified (Supabase Studio row confirmation, or the audit_log row if it's a worker-fronted action).
- **🔴 blockers** must pass before public sign-off. **🟡 highs** must be triaged (fix or accept risk). **⚪ lows** are hygiene — log to TECH-DEBT if deferred.
- Anything prefixed `[CONFIG]` is a deploy/secret gate, not a code gate. Those roll up to `docs/phase-8/TECH-DEBT.md`.

---

## 0. Pre-flight (infrastructure sanity)

- [ ] 🔴 `wrangler secret list` confirms all of: `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `WORKER_INTERNAL_SECRET`, `PUBLIC_APP_URL`, `HUBSPOT_TOKEN`, `TWILIO_*`, `SHOPIFY_ADMIN_TOKEN`, `STRIPE_PRICE_BARN_MODE_MONTHLY`, `STRIPE_PRICE_TRAINER_PRO_MONTHLY`. `[CONFIG]`
- [ ] 🔴 `npx wrangler deploy` succeeds on a clean checkout (currently the dev preview has Phase 8+9 SPA code but the Worker was not redeployed — receipts, herd-health endpoints, etc. are gated behind this).
- [ ] 🔴 Supabase Auth → Security → "Leaked password protection (HaveIBeenPwned)" is **enabled**. Currently OFF per advisor.
- [ ] 🟡 Move `btree_gist` out of `public` schema into a dedicated `extensions` schema.
- [ ] 🟡 Add `SET search_path = public, pg_temp` to the 10 functions flagged by advisor (`trg_hubspot_*`, `signed_url_ttl_seconds`, `my_rating_for_session`, `touch_horse_message_reads`, `horse_messages_unread_total`, `touch_updated_at`).
- [ ] 🟡 Confirm `STRIPE_WEBHOOK_SECRET` absence returns 401 not 501 (currently `worker.js:6613-6616` returns 501 — reconnaissance leak).
- [ ] ⚪ Typecheck: `cd app && pnpm tsc --noEmit` → clean.
- [ ] ⚪ Build: `cd app && pnpm build` → no warnings beyond known Tailwind v4 noise.

---

## 1. Owner portal (`/app/*`)

Sign in as `cedric@obsidianaxisgroup.com` (owner demo PIN).

### 1.1 Today & home
- [ ] 🟡 `TodayView` renders an **error Card** (not just a toast) when `animalsQuery.isError`. Currently the UI sticks on skeleton forever — fix at `app/src/pages/app/TodayView.tsx:47-49`.
- [ ] `/app/today` → sections for today's events, at-risk animals, open expenses all render; click-throughs route correctly.

### 1.2 Animals
- [ ] Create a new animal via `/app/animals/new`. DB: new row in `animals` with correct `owner_id`, `archived_at IS NULL`.
- [ ] 🟡 Form-level validation: the zod schemas fire, but `<Input>` fields lack HTML `required`/`maxLength` — browser validation UI is absent. Decide whether to enforce.
- [ ] Edit, archive, and unarchive the animal. DB: `archived_at` flips timestamp ↔ null, row in `animal_archive_events`.
- [ ] Upload a vet record PDF (presign → PUT → commit). DB: `vet_records` row + `r2_objects` row with correct actor prefix in `object_key`.
- [ ] Upload an `animal_media` image and confirm it renders via signed-GET URL.

### 1.3 Sessions, approval & payment
- [ ] As owner, view an incoming logged session at `/app/sessions/:id/pay`.
- [ ] Read-only **Session expenses** panel renders above the payment card when a trainer has attached expenses (verified feature — new in this release).
- [ ] Click "Approve & pay" — DB: `training_sessions.status` flips `logged → approved`; `session_payments` row created; `audit_log` row written.
- [ ] Complete the Stripe test-card flow. DB: `session_payments.status = 'paid'`, `training_sessions.status = 'paid'`.
- [ ] After session enters `approved` or `paid`, `RatingPrompt` becomes eligible. Submit a 5-star rating with comment. DB: `session_ratings` row created; unique constraint prevents a second submission by the same rater.
- [ ] 🟡 `/app/sessions/:id/pay` should also be wrapped in `<ProtectedRoute allowedRoles={["owner"]}>` as defensive depth (RLS covers, but gate is currently missing at `app/src/pages/owner/OwnerIndex.tsx:49`).

### 1.4 Expenses
- [ ] Log a manual expense against an animal. DB: `expenses` row with `recorder_role='owner'`.
- [ ] Attach a receipt (PDF or JPG). DB: `expenses.receipt_r2_object_id` populated + `r2_objects.kind='expense_receipt'` row.
- [ ] Archive the expense. DB: `archived_at` set, `expense_archive_events` row.
- [ ] Confirm `currency` writes as lowercase `'usd'` — CHECK constraint rejects `'USD'` with error `23514`.

### 1.5 Barn Mode (paywall-gated)
- [ ] 🔴 Create a subscription at `/app/settings/barn-mode` using Stripe test card. DB: `subscriptions.status='active'` with `stripe_price_id = STRIPE_PRICE_BARN_MODE_MONTHLY`. `[CONFIG]`-gated.
- [ ] `BarnCalendar` (`/app/barn/calendar`): create a one-off event, invite an attendee, mark declined. DB: `barn_events` + `barn_event_attendees` + `barn_event_responses` rows.
- [ ] 🟡 A11y: the event-list button at `BarnCalendar.tsx:270` is icon-only with no `aria-label`. Add one.
- [ ] Create a recurring event; run the `/api/_internal/barn/materialize-recurrences` cron; verify concrete rows materialized.
- [ ] Herd Health dashboard (`/app/barn/health`): set a threshold, trigger it, acknowledge. DB: `health_thresholds` + `health_dashboard_acknowledgements` rows. **Note:** there is no `herd_health_records` table — shipped schema is thresholds + acknowledgements, despite some internal specs using the older name.
- [ ] Facility Map (`/app/barn/facility`): create a ranch via "New ranch" dialog, add stalls, assign an animal, create a turnout group. DB: `ranches`/`stalls`/`stall_assignments`/`turnout_groups` rows, all owner-scoped.
- [ ] Barn Spending (`/app/barn/spending`): year-to-date aggregates match raw `expenses` sum for the owner.
- [ ] 🟡 `/app/barn/spending/animals/:id` has no top-of-page back link — only breadcrumb via `BarnSubNav`. Adds a dead-end if `BarnSubNav` fails.

### 1.6 Messaging (Phase 9)
- [ ] Text-only message thread on an animal: owner sends, trainer receives, unread count increments. DB: `horse_messages` + `horse_message_reads` rows; `horse_messages_unread_total` helper returns expected value.

### 1.7 Cross-cutting
- [ ] 🟡 Add a top-level `<ErrorBoundary>` around `OwnerLayout` (and the trainer/admin layouts). Current build has none — a child crash nukes the whole portal.

---

## 2. Trainer portal (`/trainer/*`)

Sign in as `cedric+trainer@obsidianaxisgroup.com` (trainer demo PIN).

### 2.1 Dashboard & roster
- [ ] `/trainer` renders pending invites, active clients, today's sessions.
- [ ] Clients list (`/trainer/clients`): animal links route to `/trainer/animals/:id` (read-only view). **Verified: route exists at `TrainerIndex.tsx:34` — earlier audit claim of a broken link was false.**

### 2.2 Sessions
- [ ] Log a session at `/trainer/sessions/new`. DB: `training_sessions.status='logged'`, FKs to animal/owner/trainer all valid.
- [ ] Open the session at `/trainer/sessions/:id`.
- [ ] **New:** click "Add expense" → inline `ExpenseForm` with `sessionId={id}` submits. DB: `expenses.session_id` populated, `recorder_role='trainer'`, visible to the owner on their approve-and-pay view.
- [ ] After owner approves + pays, rate the owner from the same detail view. DB: second `session_ratings` row (unique per rater).
- [ ] 🟡 `SessionsIndex` shows bare "Loading sessions…" text rather than a skeleton. Minor.

### 2.3 Invoices & recurring items
- [ ] Create a draft invoice, add line items, publish. DB: `invoices.status='open'`, line items present.
- [ ] 🟡 `InvoiceDetail` (draft/open states) has no top-of-page back link — only inside the error state. Add one.
- [ ] Mark invoice paid (owner-side flow). DB: `invoices.status='paid'`, `invoice_events` audit row.
- [ ] 🟡 `InvoiceDetail` mutations use raw `(err as Error).message` — wrap with `mapSupabaseError()` for friendlier errors.
- [ ] Recurring items at `/trainer/invoices/recurring`: create, edit, pause. 🟡 Add a "Back to invoices" link on this page — currently dead-ends.

### 2.4 Trainer Pro paywall (Phase 9)
- [ ] With no subscription, a 6th client attempt is blocked at the paywall. DB: no new `animal_access_grants` row.
- [ ] 🔴 Subscribe to Trainer Pro via Stripe test card. DB: `subscriptions.status='active'` with `stripe_price_id = STRIPE_PRICE_TRAINER_PRO_MONTHLY`. `[CONFIG]`-gated.
- [ ] With active subscription, the 6th+ client works.

---

## 3. Admin portal (`/admin/*`) — Silver Lining staff

Sign in as `cedric@silverliningherbs.com` (silver_lining demo PIN).

### 3.1 Dashboard & KPIs
- [ ] `/admin` loads the KPI snapshot. 🟡 The `admin_kpi_snapshot` RPC is called but does **not** write an `audit_log` row — fix per worker.js:905. Every other admin endpoint audits.
- [ ] 🟡 `/admin/settings/pin` is reachable only by URL — add a NavLink or tab to `AdminIndex` TABS array.

### 3.2 Orders & subscriptions
- [ ] Open an order at `/admin/orders/:id`, review line items. DB: `orders` + `order_line_items` join correctly.
- [ ] `/admin/subscriptions/:id`: pause a subscription. 🟡 **Add a back link** — current `SubscriptionDetail` is a dead-end. Verify the pause/resume/cancel mutations actually render a visible error toast on failure.
- [ ] `SubscriptionsIndex` tabs: verify each tab (active/past_due/canceled) renders an empty-state card when no rows.

### 3.3 Users & platform fees
- [ ] UsersIndex: promote/demote a trainer. DB: `user_profiles.role` updated, `audit_log` row written.
- [ ] PlatformFeesIndex: add an override. 🟡 Form lacks HTML `required` attrs — zod catches, but browser UX is weak.

### 3.4 HubSpot + vet hooks
- [ ] Apply as a trainer from public route; verify HubSpot sync row lands in `pending_hubspot_syncs` then clears after `hubspot-sync-log` tick.

### 3.5 Promo codes
- [ ] 🟡 `promo_codes` has RLS enabled with **zero policies** — SPA under user JWT returns empty. Confirm design intent: is this admin-via-service-role-only, or should it have an admin RLS policy?

---

## 4. Data integrity spot-checks

- [ ] Owner A cannot read Owner B's animals, expenses, invoices, or messages (cross-tenant leak test).
- [ ] Trainer without a grant for a given animal cannot read its records.
- [ ] Presigned PUT URLs for R2 expire in ≤ 120s. 🟡 Currently 300s at `worker.js:3584-3592` — narrow this.
- [ ] All R2 object keys start with `${actor_id}/${kind}/` — enforced at commit time (worker.js:3653).
- [ ] `session_ratings` unique constraint blocks a second rating by the same rater (SQL: `insert … on conflict do nothing` returns 0 rows).
- [ ] `expenses.session_id` round-trip: insert via trainer, fetch via `listExpensesForSession`, confirm owner sees it in `/app/sessions/:id/pay`. (Verified in smoke test 2026-04-24.)

---

## 5. Performance & scale

These are **not** blockers for closed-beta UAT, but must be on the roadmap before public launch.

- [ ] 🟡 Consolidate **138 multiple_permissive_policies** (`expenses` has 18, `supplement_doses` 12).
- [ ] 🟡 Resolve **113 auth_rls_initplan** warnings — replace `auth.uid()` with `(select auth.uid())` inside policy bodies.
- [ ] 🟡 Add indexes for the **30+ unindexed FKs** advisor flagged — in particular `horse_messages.sender_id/recipient_id`, `invoice_line_items.product_id`, `animal_media.r2_object_id`, `health_thresholds.owner_id`. Messaging + invoicing are hot paths.
- [ ] ⚪ Evaluate the **92 unused_index** advisor hits; drop any that never served a query path.

---

## 6. Known-documented deferred items (not UAT blockers)

Captured here so they don't get re-discovered as "new" findings on the next audit:

- **`scope='ranch'` in grants RLS** is deferred until `animals.ranch_id` exists (migrations `00004:123`, `00027:105`). Current behaviour: ranch-scope grants type-check but have no effect on per-animal RLS. Owner + animal + owner_all scopes are fully enforced.
- **Receipt-upload worker deploy** — SPA is wired; `expense_receipt` kind will 400 until `worker.js` is redeployed (TECH-DEBT 04-04). The DB-side CHECK constraint on `r2_objects.kind` was expanded in migration `00031` (2026-04-24) so commits will no longer fail with 23514 once the Worker redeploys.
- **`animals` archive audit is Worker-enforced, not DB-enforced.** The Worker `/api/animals/archive|unarchive` endpoints atomically UPDATE `animals.archived_at` + INSERT `animal_archive_events`, but `animals_owner_all` RLS grants `for all` so an owner could bypass via direct `supabase-js` UPDATE. No current code path does this; a defence-in-depth BEFORE UPDATE trigger is tracked in `docs/audits/2026-04-24-preflight-swarm.md` §9.
- **Migration number `00021` is skipped** — appears intentional (renumbered during Phase 8 planning). Document or backfill a no-op file if CI ever requires a contiguous sequence.

---

## 7. Home page hygiene (marketing)

- [ ] ⚪ `Home.tsx:1400` and `Home.tsx:2107` use `dangerouslySetInnerHTML` on hardcoded strings (entity support for `&mdash;` / `&rsquo;`). Safe today; add a comment or replace with a helper component before any CMS sourcing.

---

## Sign-off

| Role | Name | Date | Notes |
|------|------|------|-------|
| Owner UAT | | | |
| Trainer UAT | | | |
| Silver Lining admin UAT | | | |
| Security sign-off | | | |
| DB/infra sign-off | | | |

Once all 🔴 rows are green and all 🟡 rows are either green or accepted into TECH-DEBT with an owner + ETA, the build is ready for the closed-beta invitees.
