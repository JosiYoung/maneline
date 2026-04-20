# Mane Line — Phase 3.5 Plan (P0 catch-up before Phase 4)

**Date opened:** 2026-04-17
**Owner:** Cedric / OAG
**Status:** In progress
**Gate into Phase 4 (Protocol Brain):** this plan's §A complete + verification green.

## Why this phase exists

The P0 audit in `MANELINE-PRODUCT-FEATURE-MAP.md` §3 turned up three
P0 items that were skipped by Phases 1–3. Phase 4 (the Protocol Brain
RAG chatbot) assumes the supplement-protocol domain exists in the
database for Vectorize seeding. Starting Phase 4 without resolving
these creates debt the chatbot cannot compensate for.

Six other P0 items are explicitly scheduled for Phase 5 (Admin + Vet
View + HubSpot) — we do **not** re-build them here, we record the
verification gates in `docs/TECH_DEBT.md` so nothing falls off before
public launch.

## A. Ship in Phase 3.5 (this doc)

### A.1 — Supplement protocol tracker (Phase 4 prerequisite)

**Migration:** `supabase/migrations/00011_phase3_5_protocols.sql`

Tables:
- `protocols` — SLH's numbered SKU playbooks. Service-role writes only.
  Columns: `id`, `number` (nullable, e.g. `#17`), `name`,
  `description`, `use_case`, `body_md` (Phase-4 RAG source),
  `associated_sku_placeholder`, `product_id` (nullable FK to
  `products`), `archived_at`, timestamps.
- `animal_protocols` — owner assigns a protocol to an animal with
  start/end. Columns: `id`, `animal_id` (FK), `protocol_id` (FK),
  `started_on`, `ended_on` (nullable), `dose_instructions`,
  `notes`, `archived_at`, timestamps.
- `supplement_doses` — one row per confirmed dose. Columns: `id`,
  `animal_protocol_id` (FK), `dosed_on` (date), `dosed_at_time`
  (nullable time), `confirmed_by` (uuid), `confirmed_role`
  (owner/trainer), `notes`, `created_at`.
- Index: `(animal_protocol_id, dosed_on desc)` and
  `(animal_id, started_on desc) where archived_at is null` via a
  view.

**RLS pattern (mirrors `expenses`):**
- `protocols`: authenticated SELECT where `archived_at is null`;
  anon + authenticated denied INSERT/UPDATE/DELETE. Admin ops go
  through service role.
- `animal_protocols`: owner CRUD on their animals; trainer SELECT
  via `do_i_have_access_to_animal`; trainer INSERT `supplement_doses`
  allowed when they have access.
- `supplement_doses`: owner SELECT on their animals; trainer SELECT
  on granted animals; owner + trainer INSERT with role-stamp +
  access check; no DELETE.

**Seed:** `supabase/seeds/protocols.sql` is wired into the migration
via a data-seed block guarded by `on conflict do nothing` so local
resets repopulate without fighting production data. The seed is
flagged in a header comment as placeholder content — real SLH
content lands before Phase 4 launch per the seed file's existing
warning.

**Data layer:** `app/src/lib/protocols.ts` exposes
`listProtocols()`, `listActiveAnimalProtocols(animalId)`,
`assignProtocol(...)`, `endAnimalProtocol(...)`,
`listRecentDoses(...)`, `confirmDoseToday(...)`.

**Owner UI:**
- New `Protocols` card on `/app/animals/:id` — below Expenses.
  Shows active protocols, dose-confirm button, "Assign protocol"
  dialog.
- Today view — small chip on each `AnimalCard` showing
  `doses-due-today` count (0 if no active protocols).
- `todaysSnapshot.protocolCount` on `AnimalCard` now wires to
  real data (today this is hard-coded to 0).

**Trainer UI:** read-only protocol list on
`/trainer/animals/:id` plus a dose-confirm CTA when they have
access. (Assigning/ending a protocol stays owner-only.)

### A.2 — Two-way comms loop: flag-note + acknowledgement

**Migration:** `supabase/migrations/00012_phase3_5_flag_notes.sql`

Tables:
- `trainer_notes` — trainer flags a note to owner, optionally tied
  to a session. `id`, `trainer_id`, `owner_id`, `animal_id`,
  `session_id` (nullable), `body_md`, `severity`
  (info/attention/urgent), `created_at`, `archived_at`.
- `trainer_note_acknowledgements` — owner acks. `id`, `note_id`
  (unique), `acknowledged_by`, `acknowledged_at`.

**RLS:**
- `trainer_notes`: owner SELECT where `owner_id = auth.uid()`;
  trainer SELECT their own rows where they still have access;
  trainer INSERT only when `do_i_have_access_to_animal(animal_id)`
  is true and `owner_id` matches the animal's owner; no UPDATE
  (correction = archive + new row).
- `trainer_note_acknowledgements`: owner INSERT where the note's
  `owner_id = auth.uid()`; SELECT same rule; no UPDATE/DELETE.

**UI:**
- Trainer: "Flag to owner" button on `SessionDetail.tsx` and a
  standalone `/trainer/clients` flag CTA.
- Owner: red banner at top of `/app` when unacknowledged notes
  exist, tap to open, Acknowledge button writes ack row.
- Badge on `OwnerBottomNav` home icon while unread > 0.

### A.3 — White-label invoice builder (alongside session pay)

**Decision (2026-04-17, confirmed by Cedric):** invoice builder
runs **alongside** the Phase 2.7 session-level approve-and-pay
flow. Session pay remains for one-off ride confirmation; invoices
bundle multiple sessions + expenses for monthly/periodic billing.
A session that has been paid via session-pay cannot be re-billed
via an invoice (enforced by `training_sessions.payment_status`
check in the invoice-line-items insert path).

**Migration:** `supabase/migrations/00013_phase3_5_invoices.sql`

Tables:
- `invoices` — header. `id`, `trainer_id`, `owner_id`,
  `animal_id` (nullable — invoices can span animals under one
  owner), `status` (draft/sent/paid/void),
  `stripe_invoice_id`, `subtotal_cents`, `platform_fee_cents`,
  `total_cents`, `currency`, `due_on`, `sent_at`, `paid_at`,
  `void_reason`, `notes`, timestamps.
- `invoice_line_items` — line. `id`, `invoice_id`, `kind`
  (session/expense/manual), `session_id` (nullable FK),
  `expense_id` (nullable FK), `description`, `quantity`,
  `unit_price_cents`, `line_total_cents`, `sort_order`,
  `created_at`. CHECK: `kind='session'` requires `session_id`
  not null; `kind='expense'` requires `expense_id` not null.

**RLS:**
- Owner SELECT where `owner_id = auth.uid()`, no mutation.
- Trainer CRUD while `status='draft'` on rows they authored;
  once `status='sent'` the row is frozen (no UPDATE except via
  service-role for Stripe webhook transitions).
- `invoice_line_items`: trainer CRUD while parent is draft,
  owner SELECT when parent owner matches.

**Worker:**
- `POST /api/invoices/:id/send` — mint a Stripe invoice via
  Connect (destination = trainer's Connect acct,
  `application_fee_amount` computed from `platform_settings`).
  Falls back to `status='awaiting_trainer_setup'` when the
  Connect account isn't onboarded (mirrors existing Phase 2
  pattern).

**UI:**
- `/trainer/invoices` — list + "New invoice" builder with
  "Pull sessions" / "Pull expenses" pickers that respect the
  no-double-bill rule.
- `/app/invoices` — owner list; tap → Stripe hosted invoice URL
  (no app-side card capture needed since Stripe hosts).

## B. Deferred to Phase 5 — tracked as verification gates

Each of these rows already lives as a `TECH_DEBT(phase-5)` stub
in `docs/TECH_DEBT.md` after this PR:

| P0 item | Phase-5 verification gate |
|---|---|
| Trainer vetting admin queue | `/admin/trainer-applications` lists `trainer_profiles.application_status='submitted'`; approve flips to `approved` and clears the pending-review gate in app. |
| Vet View scoped magic link | Owner generates link in `/app/animals/:id/records` → URL `/vet/:token` renders only the animal's records; token expires per server-side ttl; audit_log captures view events. |
| HubSpot sync | `profiles.insert` + `orders.insert` + `trainer_applications.insert` each drive a Worker webhook that upserts a HubSpot contact / deal / event; failures land in `pending_hubspot_syncs` and retry on cron. |
| Admin KPI dashboard + user directory | `/admin` renders WAU, MAU, GMV (30d), attach rate; `/admin/users` searchable across owners + trainers + animals. |
| Support inbox (`support_tickets`) | In-app help widget writes a ticket row; `/admin/support` reads it; Sheets L1 mirror updates. |
| Refunds + subscription mgmt | `/admin/orders/:id` has an Issue Refund action that calls Stripe + writes an `order_refunds` row; subscription panel at `/admin/subscriptions`. |

## C. Verification drill (Phase 3.5)

Blocks Phase 4 kickoff until every row is 🟢.

| # | Step |
|---|---|
| 1 | `supabase migration list` shows 00011, 00012, 00013 applied |
| 2 | `select count(*) from protocols` ≥ seed size (5 on placeholder seed) |
| 3 | As an owner, assign a protocol to an animal; dose-confirm today; row appears in `supplement_doses` |
| 4 | As a trainer with access, confirm a dose; RLS accepts |
| 5 | As a trainer without access, confirm a dose; RLS rejects |
| 6 | Trainer flags a note to owner; owner sees banner + acks; `trainer_note_acknowledgements` row exists |
| 7 | Trainer drafts an invoice that pulls a session + an expense; sends; Stripe invoice id lands on row |
| 8 | A paid-via-session-pay session is NOT selectable in invoice builder |
| 9 | Owner opens `/app/invoices`; hosted URL opens |
| 10 | `nightly-backup` v5 captures `protocols`, `animal_protocols`, `supplement_doses`, `trainer_notes`, `trainer_note_acknowledgements`, `invoices`, `invoice_line_items` |
