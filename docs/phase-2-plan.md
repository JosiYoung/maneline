# Mane Line — Phase 2 (Trainer Portal + Session Logging + Stripe Payouts) Build Plan

**Owner:** Cedric / OAG
**Window:** Week following Phase 1 sign-off (earliest 2026-04-27)
**Feature map reference:** `MANELINE-PRODUCT-FEATURE-MAP.md` §3.2 (Trainer Portal P0) + §4.4 (Stripe Connect)
**UI reference:** `FRONTEND-UI-GUIDE.md` §5.2 (Trainer Portal — desktop-first with sidebar, Sheet on mobile) and §7 (Stripe Elements pattern). Cream / green / black tokens in `app/src/styles/index.css` lines 31–74.
**Law references:** `playbooks/OAG_ARCHITECTURE_LAWS.md` §2 (Supabase is source of truth; admin reads via Worker + service_role), §7 (RLS on every table day one), §8 (archive-never-delete; agent governance).

---

## 0. What Phase 2 is, and what it isn't

**In scope (derived from `wrangler.toml` lines 36–38 + feature map §3.2):**

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Trainer portal shell** — `/trainer/*` routed under a `TrainerLayout` that mirrors Phase 1 `OwnerLayout` | Approved trainer lands on `/trainer` and sees a PortalHeader + sidebar nav, no "Silver Lining" chrome, pure shadcn (no HeroUI imports) |
| 2 | **Trainer Today / client roster** | Trainer sees every owner/animal they hold an active-or-grace grant on, reusing `app/src/lib/access.ts` helpers `statusFor` / `daysLeftInGrace` (lines 65–75) |
| 3 | **Animal read-only view for trainers** | Trainer opens an animal, sees the Phase 1 `vet_records` + `animal_media` lists via the RLS policies `vet_records_trainer_select` (migration `00005_phase1_owner_core.sql` line 179) and `animal_media_trainer_select` (line 215) |
| 4 | **Session logging** — trainer-authored, owner-readable | Trainer logs a ride/workout/bodywork session with RHF + Zod; owner sees it on the animal detail page within the same refresh cycle; archive-never-delete |
| 5 | **Stripe Connect onboarding (Express)** | Trainer completes Connect Express onboarding; `stripe_connect_accounts` row has a `charges_enabled = true` state; trainer can receive payouts |
| 6 | **Session payment flow** | Owner approves a logged session, pays via Stripe Elements; `PaymentIntent` uses `application_fee_amount` + `transfer_data.destination`; funds route to trainer's Connect account minus platform fee |
| 7 | **Stripe webhook handler** | Worker verifies `STRIPE_WEBHOOK_SECRET`, idempotent on `event.id`, updates `session_payments.status`, writes `audit_log` |
| 8 | **Nightly backup extension** | `training_sessions`, `session_payments`, `stripe_connect_accounts` appear in `snapshots/YYYY-MM-DD/` with Stripe account ids but no card data |

**Explicitly out of scope (defer to later phases):**
- Shopify marketplace browse/checkout — Phase 3 (`wrangler.toml` lines 40–44)
- HubSpot CRM sync — Phase 5 (`wrangler.toml` lines 47–49)
- Protocol Brain chatbot (Workers AI + Vectorize) — Phase 4
- Full Vet View (scoped magic link for 30-day bundles) — Phase 5; the existing stub at `app/src/pages/VetView.tsx` stays inert
- White-label trainer invoices (logo + brand color theming) — Phase 2.5 / v1.1
- Expense tracker per horse + in-expense supplement purchase — Phase 3
- Trainer P&L / Recharts dashboards — Phase 2.5
- Recurring / monthly board billing — v1.1
- Ranch-scoped assistant trainer sub-roles — v2
- Protocol dose-confirm UI (deferred from Phase 1) — Phase 4 couples it to the Protocol Brain
- Push notifications — Phase 2.5

**Phase 2 gate to Phase 3** (mirrors feature map §6 pattern):

> *An approved trainer signs in, sees Duchess in their client roster, logs a 45-minute ride, Duchess's owner opens the animal, approves the session, pays $120 via Stripe Elements, and $108 lands in the trainer's Connect account (platform fee $12).*

If a prompt below lands outside this scope, stop and push it to Phase 2.5 or Phase 3.

---

## UI Contract (non-negotiable)

### Approved tokens Phase 2 MUST use

Every color reference in Phase 2 JSX/TSX resolves to a Tailwind utility backed by one of the tokens in `app/src/styles/index.css`. No new tokens. No hex literals.

| Surface | Token (semantic) | CSS var | Hex anchor | Tailwind utility |
|---|---|---|---|---|
| Page background | `--background` | `#F5EFE0` cream | cream | `bg-background` |
| Card / panel surface | `--card` | `#FFFDF5` warm white | warm white | `bg-card` |
| Primary action (buttons, active nav) | `--primary` | `#3D7A3D` herb green | green | `bg-primary text-primary-foreground` |
| Primary action text | `--primary-foreground` | `#FFFDF5` | cream | `text-primary-foreground` |
| Secondary surface (sidebar inactive, badges) | `--secondary` | `#E4EAD5` sage-cream | sage | `bg-secondary text-secondary-foreground` |
| Accent (success / action) | `--accent` | `#67B04A` | action green | `bg-accent text-accent-foreground` |
| Body copy | `--foreground` | `#1A1A1A` | near-black | `text-foreground` |
| Muted copy | `--muted-foreground` | `#5A5F5A` | warm gray | `text-muted-foreground` |
| Hairline / dividers | `--border` | `rgba(61,122,61,0.22)` | green 22% | `border-border` |
| Destructive (revoke, failed payment) | `--destructive` | `#C13A3A` | | `bg-destructive text-destructive-foreground` |
| Focus ring | `--ring` | `#3D7A3D` | green | `ring-ring` |

### Forbidden patterns (zero tolerance)

- No hex literals anywhere in Phase 2 `.tsx`, `.ts`, or `.css` files. If the palette shifts, only `app/src/styles/index.css` changes (lines 31–74 rule — "touch this file and this file only when the palette shifts").
- No new color tokens introduced. Phase 2 does NOT add `--trainer-brand`, `--payment-green`, etc. The white-label trainer brand color is Phase 2.5.
- No `@heroui/react` imports outside `app/src/components/owner/**`. Grep in the Phase 2 verification drill confirms `app/src/pages/trainer/**` and `app/src/components/trainer/**` are HeroUI-free (FRONTEND-UI-GUIDE.md §4.1 + §10 row 1).
- No `style={{ color: '#...' }}` inline hex, no `bg-[#...]` arbitrary Tailwind values. The VetView legacy-literal pattern (`style={{ color: 'var(--color-ink)' }}` in `app/src/pages/VetView.tsx`) is acceptable only in Phase 0 pages that haven't migrated yet; Phase 2 files use shadcn utilities exclusively.
- No custom card inputs for payments. Stripe Elements `<PaymentElement />` only (FRONTEND-UI-GUIDE.md §7 + §10 row 3).
- No `console.log` for errors — Sonner toast + structured error (FRONTEND-UI-GUIDE.md §10 row 6).
- No `any` in TypeScript — Zod schemas generate types (§10 row 10).

### Component sourcing

- **shadcn/ui** everywhere in the trainer portal: nav, forms, tables, dialogs, tabs, badges, buttons.
- **HeroUI** stays scoped to `app/src/components/owner/**` (FRONTEND-UI-GUIDE.md §4.1). Phase 1 already enforces this; the verify block from Prompt 1.5 grep (`grep -rn "@heroui/react" src/pages/trainer src/pages/admin` → zero) re-runs in Phase 2 §4.
- **Stripe Elements** only in `app/src/components/shared/PaymentForm.tsx` (new) + the owner-side "Pay session" page.
- **lucide-react** icons only.
- **Sonner** for toasts (already mounted at app root).
- **RHF + Zod** for every form — no exceptions (FRONTEND-UI-GUIDE.md §3.4).

---

## 1. Dependencies + prerequisites

Before any Phase 2 sub-prompt starts, verify:

| # | Prerequisite | Check |
|---|---|---|
| 1 | Phase 1.9 sign-off row is 🟢 (14-step drill passed end-to-end against deployed Worker + Supabase). Phase 1 plan §5 currently shows 1.9 as 🟡 pending human drill. | `docs/phase-1-plan.md` sign-off table — every row 🟢 |
| 2 | `vet_records_trainer_select` + `animal_media_trainer_select` RLS policies live in prod (applied from `supabase/migrations/00005_phase1_owner_core.sql` lines 179–181 and 215–217) | `select polname from pg_policies where tablename in ('vet_records','animal_media') and polname like '%trainer%'` returns both rows |
| 3 | At least one trainer row exists with `trainer_profiles.application_status = 'approved'` AND at least one `animal_access_grants` row against that trainer (seeded during Phase 1 drill step 8) | SQL spot check |
| 4 | Stripe platform account provisioned. Connect enabled. Express onboarding flow available in dashboard. Test-mode clocks accessible. | Cedric confirms in writing |
| 5 | `STRIPE_SECRET_KEY` (test mode `sk_test_...`) set via `npx wrangler secret put STRIPE_SECRET_KEY` — matches `wrangler.toml` line 37 | `npx wrangler secret list` shows `STRIPE_SECRET_KEY` |
| 6 | `STRIPE_WEBHOOK_SECRET` (`whsec_...`) set via `npx wrangler secret put STRIPE_WEBHOOK_SECRET` — matches `wrangler.toml` line 38 | `npx wrangler secret list` shows `STRIPE_WEBHOOK_SECRET` |
| 7 | `VITE_STRIPE_PUBLIC_KEY` (`pk_test_...`) added to `app/.env.local` for local dev and to the Cloudflare Pages build env for deploy (FRONTEND-UI-GUIDE.md §12) | `.env.local` present, `npm run build` succeeds |
| 8 | Stripe CLI installed locally for webhook forwarding during development: `stripe listen --forward-to http://localhost:8787/api/stripe/webhook` | `stripe --version` prints |
| 9 | `npm i @stripe/react-stripe-js @stripe/stripe-js` confirmed in `app/package.json` (listed in FRONTEND-UI-GUIDE.md §2.2 step 4 — confirm already present from Phase 0 scaffold) | `grep "@stripe/react-stripe-js" app/package.json` returns a line |
| 10 | Phase 0 deferred verifications (§6.1 of feature map) still green — SMTP, signup-land for all three roles | Re-run before kickoff |

If any row is red, **do not start Phase 2 sub-prompts** — fix first.

---

## 2. Phase 2 sub-prompts (copy/paste into Claude Code, one at a time)

> Same discipline as Phase 1: paste verbatim, run each verify block, stop on red, fix before moving on.

---

### Prompt 2.1 — Data model: `training_sessions`, `session_payments`, `stripe_connect_accounts`

**Scope.** Create migration `supabase/migrations/00006_phase2_trainer_sessions.sql`. Five new tables with RLS day one, archive-never-delete, `updated_at` triggers, check constraints, and helper functions the Worker will call. Tables: `training_sessions`, `session_payments`, `stripe_connect_accounts`, `platform_settings` (singleton row — global fee config), `stripe_webhook_events` (webhook log, consumed by sweep in Prompt 2.8). `session_archive_events` is included too per §8 precedent.

**Files touched.**
- `supabase/migrations/00006_phase2_trainer_sessions.sql` (new)

**UI tokens.** N/A (migration only).

**Compliance citations.**
- OAG §7 — RLS + at least one policy per table, enable before any INSERT path opens.
- OAG §8 — soft-archive columns (`archived_at timestamptz null`) on `training_sessions`. `session_payments` uses `status` lifecycle (`pending` → `succeeded` | `failed` | `refunded`) instead of delete. `stripe_connect_accounts` uses `deactivated_at` timestamp.
- Admin reads route through Worker service_role only (mirrors Phase 0 hardening `00004_phase0_hardening.sql`).

**Tables (exact shape).**

```
training_sessions
  id uuid PK default gen_random_uuid()
  trainer_id uuid NOT NULL FK auth.users(id)
  owner_id   uuid NOT NULL FK auth.users(id)
  animal_id  uuid NOT NULL FK animals(id)
  session_type text NOT NULL CHECK (session_type in (
    'ride','groundwork','bodywork','health_check','lesson','other'))
  started_at  timestamptz NOT NULL
  duration_minutes int NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 600)
  title text NOT NULL CHECK (char_length(title) between 1 and 120)
  notes text
  trainer_price_cents int CHECK (trainer_price_cents is null or trainer_price_cents >= 0)
  currency text NOT NULL default 'usd' CHECK (currency = 'usd')
  status text NOT NULL default 'logged' CHECK (status in (
    'logged','approved','paid','disputed'))
  created_at timestamptz default now()
  updated_at timestamptz default now()
  archived_at timestamptz

session_payments
  id uuid PK
  session_id uuid NOT NULL UNIQUE FK training_sessions(id)
  payer_id   uuid NOT NULL FK auth.users(id)   -- owner
  payee_id   uuid NOT NULL FK auth.users(id)   -- trainer
  stripe_payment_intent_id text UNIQUE
  stripe_charge_id text
  stripe_event_last_seen text               -- idempotency key on webhook
  amount_cents int NOT NULL CHECK (amount_cents > 0)
  platform_fee_cents int NOT NULL CHECK (platform_fee_cents >= 0)
  currency text NOT NULL default 'usd'
  status text NOT NULL default 'pending' CHECK (status in (
    'pending','processing','succeeded','failed','refunded',
    'awaiting_trainer_setup'))  -- trainer has no Stripe Connect acct or charges_enabled=false
  failure_code text
  failure_message text
  created_at timestamptz default now()
  updated_at timestamptz default now()

stripe_connect_accounts
  id uuid PK
  trainer_id uuid NOT NULL UNIQUE FK auth.users(id)
  stripe_account_id text NOT NULL UNIQUE      -- acct_xxx
  charges_enabled boolean NOT NULL default false
  payouts_enabled boolean NOT NULL default false
  details_submitted boolean NOT NULL default false
  disabled_reason text
  onboarding_link_last_issued_at timestamptz
  fee_override_bps int                        -- NULL = use platform_settings.default_fee_bps
                       CHECK (fee_override_bps is null
                              or (fee_override_bps >= 0 and fee_override_bps <= 10000))
  fee_override_reason text                    -- free-text "VIP partner", "promo Q2", etc.
  fee_override_set_by uuid REFERENCES auth.users(id)
  fee_override_set_at timestamptz
  created_at timestamptz default now()
  updated_at timestamptz default now()
  deactivated_at timestamptz

platform_settings
  id int PK DEFAULT 1 CHECK (id = 1)          -- singleton: exactly one row, ever
  default_fee_bps int NOT NULL DEFAULT 1000   -- 1000 bps = 10.00 %
                  CHECK (default_fee_bps >= 0 and default_fee_bps <= 10000)
  updated_by uuid REFERENCES auth.users(id)
  updated_at timestamptz DEFAULT now()
  -- Seed one row: INSERT INTO platform_settings (id) VALUES (1) ON CONFLICT DO NOTHING.

stripe_webhook_events
  id uuid PK DEFAULT gen_random_uuid()
  event_id text NOT NULL UNIQUE               -- Stripe's evt_xxx — idempotency key
  event_type text NOT NULL                    -- 'payment_intent.succeeded', etc.
  payload jsonb NOT NULL                      -- raw event body (for replay + audit)
  received_at timestamptz NOT NULL DEFAULT now()
  processed_at timestamptz                    -- NULL = not yet handled; sweep picks these up
  processing_attempts int NOT NULL DEFAULT 0
  last_error text
  source text NOT NULL DEFAULT 'webhook'      -- 'webhook' | 'sweep'

session_archive_events
  id uuid PK DEFAULT gen_random_uuid()
  session_id uuid NOT NULL REFERENCES training_sessions(id) ON DELETE CASCADE
  actor_id uuid NOT NULL REFERENCES auth.users(id)
  action text NOT NULL CHECK (action in ('archive','unarchive'))
  reason text
  created_at timestamptz NOT NULL DEFAULT now()
```

**RLS (§7 day one).**
- `training_sessions`
  - owner SELECT where `owner_id = auth.uid()` (includes archived rows).
  - trainer SELECT where `trainer_id = auth.uid()` AND `public.do_i_have_access_to_animal(animal_id)` (re-check grant on every read).
  - trainer INSERT / UPDATE where `trainer_id = auth.uid()` AND grant active (no UPDATE to `status` past `approved` — Worker-only).
  - No DELETE from any role.
- `session_payments`
  - owner SELECT where `payer_id = auth.uid()`.
  - trainer SELECT where `payee_id = auth.uid()`.
  - All INSERT / UPDATE is service_role only (Worker writes via `/api/stripe/sessions/pay` + `/api/stripe/webhook`).
- `stripe_connect_accounts`
  - trainer SELECT where `trainer_id = auth.uid()` — but NOT the fee override columns (use a view).
  - `v_my_connect_account` view exposes trainer-safe columns (everything except `fee_override_*`). Trainer reads the view; fee overrides are admin-only.
  - INSERT / UPDATE service_role only. Fee override columns touched only by the admin endpoint in Prompt 2.6.
- `platform_settings`
  - No client access at any level. Silver Lining admin reads/writes via Worker service_role.
  - `revoke all on public.platform_settings from anon, authenticated`.
- `stripe_webhook_events`
  - No client access. Service_role only (Worker + nightly sweep).
- `session_archive_events`
  - owner SELECT where exists session with `owner_id = auth.uid()`; trainer SELECT where exists session with `trainer_id = auth.uid()`. INSERT service_role only.

**Triggers + helpers.**
- `touch_updated_at` trigger on `training_sessions`, `session_payments`, `stripe_connect_accounts`, `platform_settings` (reuse helper from migration `00002`).
- `public.effective_fee_bps(p_trainer_id uuid)` STABLE SECURITY DEFINER — returns `COALESCE(sca.fee_override_bps, ps.default_fee_bps)`. Single source of truth for fee math. Worker and any future admin report both call this.
- `public.latest_connect_for(p_trainer_id uuid)` SECURITY DEFINER — returns single row or null, used by Worker.
- `public.session_is_payable(p_session_id uuid)` STABLE — returns true when the session is `approved` AND the trainer's `stripe_connect_accounts.charges_enabled = true`. Used by the "Approve & pay" button and the webhook retry path.

**Indexes (additional).**
- `session_payments(status) where status = 'awaiting_trainer_setup'` — drives the retry sweep in Prompt 2.8.
- `stripe_webhook_events(processed_at) where processed_at is null` — drives the webhook sweep in Prompt 2.8.
- `stripe_webhook_events(received_at desc)` — drives the Stripe-side backfill cursor.

**Indexes.**
- `training_sessions(trainer_id, started_at desc) where archived_at is null`
- `training_sessions(owner_id, started_at desc) where archived_at is null`
- `training_sessions(animal_id, started_at desc) where archived_at is null`
- `session_payments(session_id)` (already UNIQUE)
- `session_payments(stripe_payment_intent_id)` (already UNIQUE)
- `stripe_connect_accounts(trainer_id)` (already UNIQUE)

**Seed.** None.

**Dependencies.** Phase 1 migration `00005_phase1_owner_core.sql` applied (provides `do_i_have_access_to_animal`).

**Sign-off row.** 🔴 Not started

---

### Prompt 2.2 — Trainer portal shell: `TrainerLayout`, sidebar nav, route tree

**Scope.** Replace the Phase 0 placeholder `app/src/pages/trainer/TrainerIndex.tsx` with a proper portal shell. Mirror `OwnerLayout` structure but use a shadcn Sheet-based sidebar (FRONTEND-UI-GUIDE.md §5.2).

**Files touched.**
- `app/src/components/trainer/TrainerLayout.tsx` (new)
- `app/src/components/trainer/SidebarNav.tsx` (new — desktop persistent sidebar)
- `app/src/components/trainer/MobileSidebar.tsx` (new — shadcn `Sheet` trigger for mobile)
- `app/src/pages/trainer/TrainerIndex.tsx` (rewrite into a `<Routes>` shell)
- `app/src/pages/trainer/TrainerDashboard.tsx` (new — default `/trainer` landing)
- `app/src/main.tsx` (mount the new trainer route tree under `ProtectedRoute` role=`trainer`)

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §5.2 — "Desktop-first layout with responsive mobile fallback. Left sidebar navigation (Sheet on mobile)."
- FRONTEND-UI-GUIDE.md §3.5 — trainer portal sidebar pattern with shadcn `Sheet`.
- Background `bg-background`, sidebar surface `bg-card`, active nav link `text-primary`, inactive `text-muted-foreground`. No HeroUI.
- lucide icons: `LayoutDashboard`, `Users`, `Calendar`, `DollarSign`, `Menu`, `User`.
- Nav items: Dashboard (`/trainer`), Clients (`/trainer/clients`), Sessions (`/trainer/sessions`), Payouts (`/trainer/payouts`), Account (`/trainer/account`).

**Compliance citations.**
- FRONTEND-UI-GUIDE.md §4.1 — HeroUI is banned here. Verify block greps for `@heroui/react` in `components/trainer` + `pages/trainer` → zero matches.
- Brand (cream/green/black) — only tokens from `app/src/styles/index.css` lines 31–74.
- OAG §2 — admin reads go through Worker; Phase 2 does NOT give the trainer portal any admin surfaces.

**Dependencies.** Prompt 2.1 (routes won't render data without the migration, but the shell compiles independently).

**Sign-off row.** 🔴 Not started

---

### Prompt 2.3 — Trainer Today / client roster

**Scope.** `/trainer` (and `/trainer/clients`) list every owner × animal the trainer has an active-or-grace grant on. Reuse `app/src/lib/access.ts` helpers `statusFor` and `daysLeftInGrace` (lines 65–75). Surface the grace countdown so the trainer knows when access drops.

**Files touched.**
- `app/src/lib/trainerAccess.ts` (new — trainer-side inverse of `listGrants`; reads `animal_access_grants` where `trainer_id = auth.uid()` via RLS).
- `app/src/pages/trainer/TrainerDashboard.tsx` (flesh out: roster cards)
- `app/src/pages/trainer/ClientsIndex.tsx` (new — `/trainer/clients`, shadcn `DataTable`)
- `app/src/components/trainer/ClientCard.tsx` (new — shadcn `Card` with owner name, animal barn_name, grant scope, status badge, grace countdown)

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 shadcn `Card` pattern.
- FRONTEND-UI-GUIDE.md §3.4 shadcn `Badge` — `default` for active, `secondary` for grace with countdown, `outline muted` for expired (hidden from this view).
- shadcn `DataTable` for the Clients index (FRONTEND-UI-GUIDE.md §3.4). Columns: Owner, Animal, Scope, Granted, Status, Actions (→ "Open animal").
- No HeroUI.
- Background `bg-background`, card `bg-card`, hairline `border-border`, primary CTA `bg-primary`.

**Compliance citations.**
- OAG §7 — no direct service_role reads from the client. Query goes through supabase-js anon key; RLS on `animal_access_grants` (from Phase 0 migrations) already filters to the trainer's own grants.
- Reuse `statusFor` / `daysLeftInGrace` from `app/src/lib/access.ts:65-75` — no duplication.

**Dependencies.** Prompt 2.2.

**Sign-off row.** 🔴 Not started

---

### Prompt 2.4 — Animal read-only view for trainers

**Scope.** `/trainer/animals/:id` renders a read-only snapshot of an animal the trainer has access to: basics (barn_name, species, breed, year_born), vet records list, media list, and a "Sessions for this animal" tab (Prompt 2.5 populates the tab).

**Files touched.**
- `app/src/pages/trainer/AnimalReadOnly.tsx` (new — route `/trainer/animals/:id`)
- `app/src/components/trainer/VetRecordsList.tsx` (new — reuses the signed-GET URL flow from `app/src/lib/uploads.ts` `readUrlFor`)
- `app/src/components/trainer/MediaGallery.tsx` (new — thumbnails via `readUrlFor`)
- `app/src/lib/trainerAnimals.ts` (new — `getAnimalForTrainer(id)`: select `animals` row joined against `animal_access_grants` so RLS enforces access; throws 404 if no grant)

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Card`, `Tabs`, `Table`.
- No HeroUI.
- Heading uses Playfair display (already bound to `h1/h2/h3` in `index.css:135-139`).
- Destructive badge on expired Coggins: `bg-destructive/10 text-destructive border-destructive` — matches the Silver Lining admin impersonation banner pattern from FRONTEND-UI-GUIDE.md §5.3.

**Compliance citations.**
- OAG §7 — reads rely on RLS policies `vet_records_trainer_select` (`supabase/migrations/00005_phase1_owner_core.sql:179-181`) and `animal_media_trainer_select` (lines 215–217). No service_role shortcut.
- OAG §8 — the page is read-only. No archive / delete affordances here (those belong to the owner).
- `/api/uploads/read-url` (`worker.js:930`) already rate-limits + verifies `do_i_have_access_to_animal` for the trainer caller — reuse as-is.

**Dependencies.** Prompts 2.1, 2.2, 2.3. Phase 1 Prompt 1.6 signed-GET URL path.

**Sign-off row.** 🔴 Not started

---

### Prompt 2.5 — Session logging (trainer-authored, owner-readable)

**Scope.** Trainer creates a `training_sessions` row via a shadcn form. Owner sees the session on `/app/animals/:id` (extend the Phase 1 `AnimalDetail` page). Archive-never-delete: "delete" is `archived_at = now()` with reason, written to an append-only event table.

**Policy: session logging is independent of Stripe status.** An approved trainer may log sessions (and owners may see them) with or without a completed Stripe Connect account. Session logging is never gated on `charges_enabled`. The form shows an inline banner when the trainer has no active Connect account, reading: *"Payments aren't wired up yet. You can still log sessions and send invoices — once you finish payout setup, any pending charges go through automatically."* Cedric's explicit policy (industry is trust-based; trainer's choice whether to bill before or after a session).

**Files touched.**
- Migration amendment (OPTIONAL, co-located in `00006_phase2_trainer_sessions.sql`): append `session_archive_events` table if Cedric decides an explicit audit (OAG §8 precedent from `animal_archive_events`) is needed. Default: yes — include it in Prompt 2.1.
- `app/src/lib/sessions.ts` (new — `listSessionsForAnimal`, `listMySessions`, `createSession`, `archiveSession`)
- `app/src/components/trainer/SessionForm.tsx` (new — RHF + Zod schema)
- `app/src/components/trainer/SessionsList.tsx` (new — shared between trainer + owner views)
- `app/src/pages/trainer/SessionsIndex.tsx` (new — `/trainer/sessions`, lists every session the trainer authored)
- `app/src/pages/trainer/SessionNew.tsx` (new — `/trainer/sessions/new?animal=:id`)
- `app/src/pages/trainer/SessionDetail.tsx` (new — `/trainer/sessions/:id`)
- `app/src/pages/app/AnimalDetail.tsx` (extend — add a "Sessions" section reading the owner-visible rows)
- `worker.js` (add `POST /api/sessions/archive` — atomic soft-archive + event write, mirroring `handleAnimalArchive` at `worker.js:1111`)

**Zod schema (trainer-authored session).**

```ts
z.object({
  animal_id: z.string().uuid(),
  session_type: z.enum(['ride','groundwork','bodywork','health_check','lesson','other']),
  started_at: z.string().datetime(),
  duration_minutes: z.number().int().min(5).max(600),
  title: z.string().min(1).max(120),
  notes: z.string().max(4000).optional(),
  trainer_price_cents: z.number().int().min(0).max(10_000_00).nullable().optional(),
})
```

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Form`, `Input`, `Textarea`, `Select`, `Button`. Primary submit `bg-primary`. Cancel `variant="outline"`.
- Status chip colors: `logged` → `Badge` default (green primary), `approved` → `Badge` secondary (sage), `paid` → `Badge` with `bg-accent text-accent-foreground` (action green), `disputed` → `Badge variant="destructive"`.
- No HeroUI.

**Compliance citations.**
- OAG §7 — every read + write path goes through RLS defined in Prompt 2.1.
- OAG §8 — no hard deletes. Archive via Worker endpoint + event table. The verification drill (§4 below) greps for forbidden delete patterns on `training_sessions`.
- Brand — cream background, green primary, sage secondary, near-black ink.

**Dependencies.** Prompts 2.1, 2.2, 2.4.

**Sign-off row.** 🔴 Not started

---

### Prompt 2.6 — Stripe Connect Express onboarding

**Scope.** Trainer clicks "Set up payouts" in `/trainer/payouts`. Worker creates a Stripe Connect Express account (or reuses the existing row from `stripe_connect_accounts`), generates an onboarding Account Link, and redirects. On return, Worker refreshes account status and stores `charges_enabled` / `payouts_enabled` / `details_submitted`.

**Files touched.**
- `worker/stripe.js` (new — thin Stripe REST wrapper using fetch + SigV4-style HMAC auth. Stripe's REST API uses Basic auth with `STRIPE_SECRET_KEY:` — no SDK. Keeps the Worker bundle tiny.)
- `worker.js` (add routes):
  - `POST /api/stripe/connect/onboard` — owner=trainer JWT; creates or reuses account; returns `{ onboarding_url }`
  - `GET  /api/stripe/connect/return` — redirect target after Stripe Express completes; pulls account via `GET /v1/accounts/{id}`; updates `stripe_connect_accounts`; redirects to `/trainer/payouts?status=ok|incomplete`
  - `POST /api/stripe/connect/refresh` — re-issue Account Link if a prior link expired
  - `GET  /api/admin/fees` — Silver Lining admin only (service_role after `is_silver_lining_admin` check); returns current `platform_settings.default_fee_bps` and every `stripe_connect_accounts.fee_override_bps != null` row with trainer name
  - `POST /api/admin/fees/default` — admin updates `platform_settings.default_fee_bps`. Body: `{ default_fee_bps: int }`. Writes `audit_log` with prev + new value.
  - `POST /api/admin/fees/trainer` — admin sets a per-trainer override. Body: `{ trainer_id, fee_override_bps | null, reason? }`. Null clears the override. Writes `audit_log` and stamps `fee_override_set_by` / `fee_override_set_at`.
- `app/src/lib/stripeConnect.ts` (new — thin fetch helpers mirroring `access.ts` pattern at lines 77–90)
- `app/src/pages/trainer/PayoutsIndex.tsx` (new — `/trainer/payouts`)
- `app/src/components/trainer/ConnectOnboardCard.tsx` (new — three states: "Not started", "In review", "Ready")
- `app/src/lib/platformFees.ts` (new — admin helpers: `getFees`, `setDefaultFee`, `setTrainerOverride`)
- `app/src/pages/admin/PlatformFeesIndex.tsx` (new — `/admin/settings/fees`, Silver Lining role only, gated by `ProtectedRoute role='silver_lining'`. Two sections: "Default fee" (single number input, shadcn `Input` with `%` adornment, save writes `default_fee_bps`) and "Trainer overrides" (shadcn `Table` with columns: trainer, current override %, reason, "Edit" / "Clear" actions))

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Card`, `Button`, `Badge`, `Alert`.
- FRONTEND-UI-GUIDE.md §7 (Stripe Elements) DOES NOT apply here — Connect onboarding is a redirect, not an Element.
- Ready state badge: `bg-accent text-accent-foreground` (action green). In-review: `bg-secondary`. Not started: `outline`.
- Destructive alert for `disabled_reason` populated by Stripe.

**Compliance citations.**
- OAG §2 — admin actions go through Worker + service_role. The `stripe_connect_accounts` INSERT/UPDATE is Worker-only (RLS enforces — from Prompt 2.1).
- OAG §7 — trainer SELECT only; service_role writes.
- OAG §8 — no deletion. `deactivated_at` column flips if a trainer's Connect account is closed.
- Audit log: every `/api/stripe/connect/*` call writes an `audit_log` row via `ctx_audit` helper (`worker.js:1071`).
- `STRIPE_SECRET_KEY` is read only on the server (Worker secret — `wrangler.toml:37`).

**Dependencies.** Prompt 2.1 (table). Stripe test account enabled. `STRIPE_SECRET_KEY` secret set.

**Sign-off row.** 🔴 Not started

---

### Prompt 2.7 — Session payment flow (owner pays, funds route to trainer)

**Scope.** Owner opens a session in status `logged`, taps "Approve & pay" (owner-only action, flips `status='approved'`), then pays via Stripe Elements. Worker creates a PaymentIntent with `application_fee_amount` (platform take) and `transfer_data.destination = <trainer's acct_xxx>`. Browser confirms the PaymentIntent using `stripe.confirmPayment`.

**Fee math.** Worker calls `public.effective_fee_bps(trainer_id)` — single source of truth — which returns `COALESCE(fee_override_bps, default_fee_bps)`. Fee cents = `CEIL(amount_cents * bps / 10000)`. Default is 1000 bps (10%); admin edits the default in `/admin/settings/fees`. VIPs get a per-trainer override.

**Trainer not ready for payments.** If the trainer has no `stripe_connect_accounts` row, or `charges_enabled = false`, the Worker does NOT create a PaymentIntent. Instead it inserts a `session_payments` row with `status = 'awaiting_trainer_setup'`, `amount_cents` + `platform_fee_cents` locked in at today's rate. Owner sees the CTA swap to a disabled button with helper text: *"[Trainer name] is finishing their payout setup. Your card won't be charged until they're ready — we'll notify you both automatically."* Once the `account.updated` webhook flips `charges_enabled` to true (handled in Prompt 2.8), the Worker auto-creates PaymentIntents for every pending row belonging to that trainer and emails the owner a one-tap confirm link.

**Files touched.**
- `worker/stripe.js` (extend — `createPaymentIntent`, `retrievePaymentIntent`)
- `worker.js` (add routes):
  - `POST /api/sessions/approve` — owner JWT; verifies `owner_id = auth.uid()`; flips `training_sessions.status` `logged`→`approved`; writes `audit_log`
  - `POST /api/stripe/sessions/pay` — owner JWT; creates PaymentIntent, inserts `session_payments` with `status='pending'`, returns `{ client_secret, payment_intent_id }`
- `app/src/lib/sessionPayments.ts` (new — `approveSession`, `startPayment`, `pollPaymentStatus`)
- `app/src/components/shared/PaymentForm.tsx` (new — FRONTEND-UI-GUIDE.md §7 exact pattern, lines 910–961)
- `app/src/pages/app/SessionApproveAndPay.tsx` (new — `/app/sessions/:id/pay`)

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §7 exact pattern (lines 910–961). `<Elements>` + `<PaymentElement />`. Stripe loads `pk_test_...` from `VITE_STRIPE_PUBLIC_KEY`.
- Approve button `bg-primary`. Pay button `bg-accent` (action green) `disabled={!stripe}`.
- On success: sonner `notify.success('Payment sent to your trainer')`, navigate to `/app/animals/:animalId?paid=1`.
- On failure: sonner `notify.error(message)`, keep user on page to retry.
- No custom card inputs (FRONTEND-UI-GUIDE.md §10 row 3).
- Amount displayed using `Intl.NumberFormat('en-US', {style:'currency',currency:'usd'})` — never hand-format.

**Compliance citations.**
- FRONTEND-UI-GUIDE.md §7 — PCI compliance + trust requirement. Non-negotiable.
- OAG §7 — `session_payments` writes are service_role only; owner reads via `payer_id = auth.uid()` RLS.
- OAG §2 — owner SPA never talks to Stripe API directly for intent creation; always via Worker.
- OAG §8 — failed PaymentIntents transition `status` to `failed`, never delete the row.
- Audit log row on approve, create-intent, and webhook-update.

**Dependencies.** Prompts 2.1, 2.5, 2.6. If trainer's `stripe_connect_accounts.charges_enabled` is false, Worker inserts `status='awaiting_trainer_setup'` (does not reject) — retry fires from the `account.updated` webhook in Prompt 2.8.

**Sign-off row.** 🔴 Not started

---

### Prompt 2.8 — Stripe webhook handler (idempotent, event-id keyed)

**Scope.** Single endpoint `POST /api/stripe/webhook` receives every Stripe event. Verifies signature against `STRIPE_WEBHOOK_SECRET`. Handles `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated` (Connect status changes including the "trainer finished setup" retry trigger), `charge.refunded`. Idempotent on Stripe `event.id` via `stripe_webhook_events.event_id UNIQUE`. Belt-and-suspenders: a separate `sweep_stripe_events` Edge Function runs every 5 minutes via `pg_cron` to backfill any events Stripe delivered when the Worker was unavailable (per Cedric's call — industry is money-sensitive, we ship the sweep in Phase 2 rather than 2.5).

**Files touched.**
- `worker/stripe-webhook.js` (new — signature verifier using Web Crypto HMAC-SHA256, mirrors the SigV4 hand-roll in `worker/r2-presign.js`). Single `processStripeEvent(event, env, source)` function — called both by the webhook route and by the sweep, so handler logic lives in one place.
- `worker.js` (add route):
  - `POST /api/stripe/webhook` — no JWT; signature-only auth
- `supabase/functions/sweep-stripe-events/index.ts` (new — Supabase Edge Function. Queries Stripe `GET /v1/events?created[gte]=<cursor>` since the max `received_at` in `stripe_webhook_events`, or falls back to the last 24h. For every event not already in the table, inserts the row and calls the same `processStripeEvent` logic via a Worker-internal endpoint `POST /api/stripe/sweep/process` — service-role-authed, accepts a raw event body. Also retries any `stripe_webhook_events` rows with `processed_at is null` older than 5 minutes, up to 5 attempts, with exponential backoff stored in `processing_attempts`.)
- `pg_cron` schedule (run at end of migration 00006): `select cron.schedule('sweep-stripe-events', '*/5 * * * *', $$ select net.http_post(url := '<edge function url>', headers := jsonb_build_object('Authorization','Bearer '||<service_role>)) $$);`

> `stripe_webhook_events` table itself is already defined in Prompt 2.1.

**Handled events.**
- `payment_intent.succeeded` → find `session_payments` by `stripe_payment_intent_id` → set `status='succeeded'`, capture `stripe_charge_id` → update `training_sessions.status='paid'` → `audit_log`.
- `payment_intent.payment_failed` → `status='failed'` + capture `failure_code` / `failure_message`.
- `account.updated` → update `stripe_connect_accounts.charges_enabled` / `payouts_enabled` / `details_submitted` / `disabled_reason`. **If `charges_enabled` flips `false → true`, find every `session_payments` row for this trainer with `status='awaiting_trainer_setup'` and create a PaymentIntent for each, flipping status to `pending`.** Email the owner a "Your trainer is ready — tap to confirm payment" link per pending session (uses the owner's Supabase email via the Phase 0 SMTP config).
- `charge.refunded` → `status='refunded'`; training_session goes back to `approved`; `audit_log` records who issued (event `request.id`).

**UI tokens.** N/A (server only).

**Compliance citations.**
- OAG §2 — webhook receiver is the Worker; it writes to Supabase via service_role; never direct browser → Stripe.
- OAG §7 — `stripe_webhook_events` RLS: no client access, service_role only.
- OAG §8 — refund flips status, never deletes.
- Every handler writes an `audit_log` row. Signature failure logs + returns 400 without touching DB.
- Idempotency: handler returns 200 immediately if `event_id` already exists in `stripe_webhook_events` with non-null `processed_at`.

**Dependencies.** Prompts 2.1, 2.6, 2.7. `STRIPE_WEBHOOK_SECRET` provisioned.

**Sign-off row.** 🔴 Not started

---

### Prompt 2.9 — Nightly backup extension

**Scope.** Add the three new Phase 2 tables to `supabase/functions/nightly-backup/index.ts`. Keep schedule + retention identical. For `stripe_connect_accounts` and `session_payments`, only metadata (no card data is ever stored in our DB; Stripe holds PCI data — our rows carry only `stripe_account_id`, `stripe_payment_intent_id`, `stripe_charge_id`).

**Files touched.**
- `supabase/functions/nightly-backup/index.ts` (extend the `TABLES` const at line 156)

**Additions.**

```ts
const TABLES = [
  // ... Phase 0 + Phase 1 entries stay ...
  'training_sessions',
  'session_payments',
  'stripe_connect_accounts',
  'platform_settings',        // singleton row — default fee + audit
  'stripe_webhook_events',    // event log — backed up per sweep decision in 2.8
  'session_archive_events',   // from Prompt 2.5, lives in 00006
] as const;
```

**UI tokens.** N/A.

**Compliance citations.**
- OAG §4 (triple redundancy — client-owned GitHub repo at L2). Phase 2 tables must land in `snapshots/YYYY-MM-DD/` with JSON + CSV.
- OAG §7 — backup uses service_role key from Supabase's own secret store (index.ts lines 34–42 — unchanged).
- No PII beyond Stripe account ids. Zero card data. Zero raw webhook bodies if Cedric opts out of `stripe_webhook_events` backup.

**Dependencies.** Prompt 2.1.

**Sign-off row.** 🔴 Not started

---

### Prompt 2.10 — Verification drill

**Scope.** Human-run 18-step end-to-end test (§4 below). Report each step 🟢 / 🔴. Stop on the first 🔴, fix, re-run.

**Files touched.**
- `docs/phase-2-plan.md` (fill in §5 sign-off rows)

**UI tokens.** N/A (verification only).

**Compliance citations.** Every previous sub-prompt's law citations are re-checked here via grep and runtime behavior.

**Dependencies.** Every prior sub-prompt 🟢.

**Sign-off row.** 🔴 Not started

---

## 3. Compliance matrix

| Sub-prompt | OAG §7 (RLS day 1) | OAG §8 (no hard delete) | OAG §2 (admin through Worker) | FRONTEND-UI-GUIDE (UI/brand) | Triple redundancy (OAG §4) |
|---|---|---|---|---|---|
| 2.1 Migration | RLS + policies on all 6 tables (`training_sessions`, `session_payments`, `stripe_connect_accounts`, `platform_settings`, `stripe_webhook_events`, `session_archive_events`) | `archived_at` + lifecycle statuses; no DELETE path | service_role-only writes for `session_payments`, `stripe_connect_accounts`, `platform_settings`, `stripe_webhook_events` | — | feeds Prompt 2.9 |
| 2.2 Trainer shell | — | — | No admin surfaces in trainer portal | §5.2 sidebar, cream/green/black tokens, no HeroUI | — |
| 2.3 Client roster | Reads use RLS on `animal_access_grants` | — | No service_role | §3.4 Card + Badge, §3.5 nav | — |
| 2.4 Animal read-only | `vet_records_trainer_select`, `animal_media_trainer_select` (Phase 1 policies) | Read-only; no mutation UI | `/api/uploads/read-url` reuses Worker auth | §3.4 Card + Tabs | — |
| 2.5 Session logging | RLS enforces trainer/owner split | `session_archive_events` audit + `archived_at` | Archive routed through Worker | §3.4 Form + RHF + Zod | backed up in 2.9 |
| 2.6 Connect onboarding + admin fees | `stripe_connect_accounts` RLS; `platform_settings` no-client-access | `deactivated_at`, no delete; fee edits write audit not DELETE | All Stripe REST + fee edits via Worker; admin UI gated by `ProtectedRoute role='silver_lining'` | §3.4 Card + Alert + Table (admin fees page); no hex | `platform_settings` backed up in 2.9 |
| 2.7 Session payment | `session_payments` RLS; `awaiting_trainer_setup` rows visible only to payer | `status='failed'` / `refunded` / `awaiting_trainer_setup`, no delete | PaymentIntent created server-side; fee math via `effective_fee_bps` helper | §7 Stripe Elements exact pattern | backed up in 2.9 |
| 2.8 Webhook + sweep | `stripe_webhook_events` no-client-access | Refund is a status change; sweep never deletes | Webhook target is Worker; sweep is Edge Function → Worker internal endpoint | — | `stripe_webhook_events` backed up in 2.9 |
| 2.9 Backup | — | Backup is append-only; L2 is client-owned | service_role read in Supabase Edge Function | — | directly implements §4 |
| 2.10 Verification | Drill includes RLS cross-role checks (incl. `platform_settings` and `fee_override_bps`) | Drill greps for `DELETE FROM`, `.delete(` | Drill confirms no browser → Stripe, no browser → fee tables | Drill re-greps `@heroui/react` in trainer + admin trees | Drill confirms today's snapshot has all 6 Phase 2 tables |

---

## 4. Verification drill (18 numbered steps)

Run this before declaring Phase 2 complete. Each step is 🟢 / 🔴. Stop on first red.

1. **[MIGRATION]** `supabase/migrations/00006_phase2_trainer_sessions.sql` applies cleanly in a branch DB. `grep -cE "CREATE POLICY" supabase/migrations/00006_phase2_trainer_sessions.sql` ≥ 8 (coverage for `training_sessions`, `session_payments`, `stripe_connect_accounts`, `platform_settings`, `stripe_webhook_events`, `session_archive_events`). Every new table has `relrowsecurity = true`. `select count(*) from platform_settings;` returns **exactly 1** row with `default_fee_bps = 1000`.
2. **[TRAINER SHELL]** Log in as an approved trainer. Land on `/trainer`. `grep -rn "@heroui/react" app/src/pages/trainer app/src/components/trainer` returns **zero matches**. No "Silver Lining" chrome visible.
3. **[ROSTER]** Trainer sees Duchess in their client roster. Grant status badge reads "Active". Open `/trainer/clients` — shadcn DataTable lists the grant with owner name + animal barn_name. Tokens: background is cream, primary badge is green.
4. **[ANIMAL READ-ONLY]** Trainer opens Duchess at `/trainer/animals/:id`. Coggins PDF row visible. Click "View" → signed GET URL opens in a new tab. Wait 6 minutes, retry → 403 (TTL honored, reused from Phase 1 Prompt 1.6).
5. **[SESSION LOG — NO STRIPE]** Trainer with NO `stripe_connect_accounts` row logs a session `type=ride, duration=45, title='Long trot', price=$120.00`. Session save succeeds. Form shows the "Payments aren't wired up yet" banner above the submit button. Owner sees the session row on `/app/animals/:id` with status `logged`.
6. **[OWNER PRE-PAY — AWAITING SETUP]** Owner approves that session. Attempts to pay. Worker returns a `session_payments` row with `status='awaiting_trainer_setup'`, `amount_cents=12000`, `platform_fee_cents=1200`. Owner UI disables the "Pay" button and shows the "finishing payout setup" helper text. No PaymentIntent exists in Stripe yet (`stripe payment_intents list` shows zero new).
7. **[ARCHIVE, NEVER DELETE]** Trainer archives a different test session via confirm dialog with reason. Row disappears from default list. `grep -rnE "DELETE FROM training_sessions|\.delete\(\)\s*\.from\(['\"]training_sessions" app/src worker.js supabase/` → **zero matches**. `select count(*) from session_archive_events;` ≥ 1.
8. **[CONNECT ONBOARD]** Trainer clicks "Set up payouts" on `/trainer/payouts`. Redirect to Stripe Express. Complete test onboarding (DOB, SSN placeholder, bank). Return URL updates `stripe_connect_accounts.charges_enabled=true`. Badge flips to "Ready" with `bg-accent text-accent-foreground`.
9. **[AUTO-RETRY FROM account.updated]** Within ~5 seconds of step 8, the Worker creates a PaymentIntent for the step-6 pending payment and flips `session_payments.status` from `awaiting_trainer_setup` → `pending`. Owner receives an email "Your trainer is ready — tap to confirm payment". `audit_log` has an `action='session_payment.auto_retry'` row.
10. **[ADMIN FEE EDIT — DEFAULT]** As a `silver_lining` admin, open `/admin/settings/fees`. Change default from 10% to 8%. `platform_settings.default_fee_bps` = 800. `audit_log` records the change. Any new PaymentIntent now uses 800 bps.
11. **[ADMIN FEE EDIT — VIP OVERRIDE]** Same admin sets trainer Acme's `fee_override_bps=500` with reason "VIP partner". Run `select public.effective_fee_bps('<Acme uuid>');` → 500. Run the same for an untouched trainer → 800 (inherits current default). `audit_log` records both writes. Owner pays an Acme session of $200 — Worker computes fee cents = 1000 (5% rounded up), PaymentIntent body shows `application_fee_amount=1000`.
12. **[NORMAL PAY]** Owner completes payment on the step-9 retry using Stripe test card `4242 4242 4242 4242`. PaymentIntent body returned by Worker includes `application_fee_amount` (using `effective_fee_bps`) and `transfer_data.destination = acct_...`. `session_payments.status` = `pending`. Sonner toast "Payment sent to your trainer".
13. **[WEBHOOK]** `stripe trigger payment_intent.succeeded`. Worker receives. Signature verifies. `session_payments.status` → `succeeded`. `training_sessions.status` → `paid`. `stripe_webhook_events` has a row with `processed_at` non-null.
14. **[IDEMPOTENCY]** Replay the same webhook event (`stripe events resend <event_id>`). Worker returns 200 without a second DB mutation. Row count for that event id stays at 1.
15. **[WEBHOOK SWEEP RECOVERY]** Temporarily set `STRIPE_WEBHOOK_SECRET` to an invalid value (or take the Worker down with a deploy). Fire a `charge.refunded` event in Stripe test mode. Confirm `stripe_webhook_events` has NO row yet. Restore the correct secret. Wait ≤ 5 minutes for `pg_cron` to fire `sweep_stripe_events`. Confirm: the sweep inserts the event with `source='sweep'`, processes it to completion (`processed_at` non-null), and `session_payments.status` flips to `refunded`.
16. **[ROLE ISOLATION — RLS]** As owner A, `select * from training_sessions where trainer_id = <other_trainer>;` returns 0 rows. As trainer B with no grant on Duchess, same select returns 0 rows. As trainer B, `select * from platform_settings;` returns 0 rows (service-role-only). As trainer B, `select fee_override_bps from stripe_connect_accounts;` returns NULL/0 even for their own row (view `v_my_connect_account` hides it). Revoke the grant, fast-forward `grace_period_ends_at` 8 days — trainer can no longer read the animal's sessions.
17. **[NO HEX LITERALS]** `grep -rnE "#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}\b" app/src/pages/trainer app/src/pages/admin app/src/components/trainer app/src/components/shared/PaymentForm.tsx` → **zero matches**. `grep -rnE "bg-\[#" app/src` → zero matches in Phase 2 files.
18. **[BACKUP]** Invoke `supabase functions invoke nightly-backup`. Today's folder in the client-owned GitHub repo contains `training_sessions.json`, `session_payments.json`, `stripe_connect_accounts.json`, `platform_settings.json`, `stripe_webhook_events.json`, `session_archive_events.json`. `grep -cE '"number"|card_number|cvc|cvv' snapshots/<date>/session_payments.json` → **zero** (no card data stored anywhere in our system). `platform_settings.json` contains the single singleton row with the current `default_fee_bps`.

Record the result table in §5 below. Phase 2 is not closed until every step is 🟢.

---

## 5. Sign-off (fill in at end of Phase 2)

| Step | Status | Notes |
|---|---|---|
| 2.1 Migration | 🔴 Not started | — |
| 2.2 Trainer shell | 🔴 Not started | — |
| 2.3 Client roster | 🔴 Not started | — |
| 2.4 Animal read-only | 🔴 Not started | — |
| 2.5 Session logging | 🔴 Not started | — |
| 2.6 Stripe Connect onboard | 🔴 Not started | — |
| 2.7 Session payment | 🔴 Not started | — |
| 2.8 Stripe webhook | 🔴 Not started | — |
| 2.9 Backup extension | 🔴 Not started | — |
| 2.10 Verification drill | 🔴 Not started | — |

**Phase 2 complete when every row is 🟢 and the 18-step drill passes end-to-end.** Only then does Phase 3 (Shopify marketplace) begin — see `wrangler.toml` lines 40–44 and feature map §6.

---

## 6. Resolved decisions + remaining open items

### Resolved (2026-04-17, Cedric)

1. **Platform fee rate.** Default 10% (1000 bps), admin-editable at runtime via `/admin/settings/fees`. Per-trainer overrides for VIPs via `stripe_connect_accounts.fee_override_bps`. Fee math is always `COALESCE(override, default)`. See Prompts 2.1 (schema), 2.6 (admin endpoints + UI), 2.7 (payment flow).

2. **Trainer KYC sequencing.** Session logging is never gated on Stripe status. Approved trainers may log sessions and send invoices before, during, or after Stripe Connect onboarding. Payment collection waits for `charges_enabled=true`: if the trainer isn't ready, the `session_payments` row is created with `status='awaiting_trainer_setup'`, and the `account.updated` webhook auto-retries when Stripe flips the flag. See Prompts 2.5 (logging policy), 2.7 (awaiting state), 2.8 (retry trigger).

3. **Webhook durability.** Ship the `pg_cron` sweep in Phase 2 (not deferred to 2.5). Every 5 minutes the `sweep_stripe_events` Edge Function asks Stripe for any events since our last cursor and retries any `stripe_webhook_events` rows stuck with `processed_at is null`. Belt-and-suspenders over Stripe's native 3-day retry — Cedric's call given the money-sensitivity of the domain. See Prompt 2.8.

### Remaining items to watch during Phase 2 (not blockers)

- **Raw webhook body retention.** `stripe_webhook_events.payload jsonb` stores the full Stripe event for replay + audit. Included in nightly backup per Prompt 2.9 — gives full reconstructability but adds repo size over time. If 12-month growth feels large, Phase 2.5 could compact to metadata only.
- **White-label trainer-brand color.** Deferred to Phase 2.5. Trainer receipts + `/trainer/*` portal use Mane Line green (`--primary`) until 2.5 ships the `--trainer-brand` override pattern from FRONTEND-UI-GUIDE.md §5.2 lines 790–812.
- **Session price disputes.** `training_sessions.trainer_price_cents` is trainer-set at log time. Owner either approves-and-pays or the session sits in `logged` forever (no explicit dispute UI in Phase 2). A "counter-propose" affordance is deferred to Phase 2.5 pending real owner/trainer feedback.
- **Email sender identity on auto-retry notification.** The "Your trainer is ready — tap to confirm payment" email in Prompt 2.8 uses Phase 0 SMTP config. Confirm the Supabase Auth sender domain passes SPF/DKIM for transactional emails, or switch to Resend/Postmark in 2.5 if deliverability bites.

---

*End of docs/phase-2-plan.md — Phase 2 scope: Trainer Portal + Session Logging + Stripe Payouts.*
