# Phase 8 Module 05 — Barn Mode Subscription + Silver Lining Comp Linkage

**Parent plan:** `docs/phase-8-plan.md`
**Migration file:** `supabase/migrations/00021_phase8_silver_lining_comp.sql`
**Law references:** OAG §2 (every subscription / SL link / promo redemption write goes through the Worker; service_role for the SL verification cron + Shopify Admin API calls — never exposed to the SPA), §3 (`barn_mode_entitlement_events` is an append-only audit of every tier change with reason + source — this satisfies Law 3 for the billing surface), §4 (subscriptions + silver_lining_links + promo_codes all flow into L1 Sheets + L2 nightly backup), §7 (RLS day one on every new table), §8 (archive-never-delete — promo codes flip `archived_at` rather than delete; SL links flip `archived_at` after the 90-day sticky window; cancelled subscriptions retain the row with `status='cancelled'` and `archived_at`).
**Feature-map reference:** §3.1 owner portal (Settings → Subscription), §3.3 Silver Lining admin surfaces (`/admin/promo-codes`, finance-tile comp-source rollup).
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 shadcn `Card` / `Dialog` / `Sheet` / `Select` / `Badge` / `Input`, §3.5 owner bottom-nav (Settings route), §7 Stripe Elements pattern (reused for the SetupIntent card collection at link-time), §10 error/empty/loading.

---

## §A. Scope + success criterion

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Barn Mode subscription — $25/mo platform charge** | Owner on `/app/settings/subscription` sees tier ("Free" or "Barn Mode"), current status, comp source (if any), next renewal date. "Upgrade" button → Stripe Checkout (platform charge, NOT trainer Connect). Price id `STRIPE_PRICE_BARN_MODE_MONTHLY`. Annual (`STRIPE_PRICE_BARN_MODE_ANNUAL`) optional — if set, Checkout offers both toggles. |
| 2 | **Stripe Customer Portal (self-serve)** | `POST /api/barn/subscription/portal` returns a Customer Portal session URL. Owner can update card, cancel, pause, reactivate. Webhook round-trips update our `subscriptions` row. |
| 3 | **Horse #3 soft upsell** | Adding horse #3 (attempting `POST /api/animals` when post-insert count would be 3) — Worker returns 201 with a hint header `X-Barn-Mode-Upsell: soft`. SPA shows a non-blocking shadcn `Dialog` "You've unlocked Barn Mode — $25/mo" with CTA to `/app/settings/subscription`. User can dismiss and keep going. |
| 4 | **Horse #4 hard paywall** | Adding horse #4 when not on Barn Mode (paid or comp) — Worker returns 402 `barn_mode_required` with `{ checkout_url, current_count, limit: 3 }`. SPA renders a hard modal with "Subscribe to add horse" CTA. No dismiss path. |
| 5 | **Silver Lining linked-account comp** | Owner on `/app/settings/subscription` clicks "Link my Silver Lining account," verifies via email + order # (Shopify Admin API), Maneline stamps `silver_lining_links.silver_lining_customer_id`. Nightly cron checks each linked account's active subscribe-and-save; if any contract is `status=active`, `subscriptions.comp_source='silver_lining_sns'` + `tier='barn_mode'` + `status='active'` at $0. 90-day sticky (can't unlink-and-relink to a different Maneline account for 90 days). |
| 6 | **SL cancel → 30-day grace → conversion to $25** | When nightly cron sees the formerly-active SL contract flip to `cancelled`: stamp `silver_lining_links.last_verification_status='cancelled'`, set `subscriptions.comp_expires_at = now() + 30 days`. Cron re-checks daily; on grace expiry, Worker invokes Stripe Checkout attach (using the SetupIntent card collected at link-time) → creates a paid sub at $25/mo. If the card fails, `subscriptions.status='past_due'`, owner gets email + in-app banner, standard Stripe dunning applies. |
| 7 | **Promo code redemption** | Owner on `/app/settings/subscription` enters code → `POST /api/barn/promo-codes/redeem` → writes `subscriptions.comp_source='promo_code_<campaign>'` + `comp_expires_at = now() + grants_barn_mode_months`. Admin panel `/admin/promo-codes` generates codes + views redemption ledger. Single-use; `redeemed_by_owner_id` stamped. |
| 8 | **Append-only entitlement audit** | `barn_mode_entitlement_events` captures every tier transition with `event` (`granted`/`revoked`/`converted`/`cancelled`/`comp_attached`/`comp_detached`) + `reason` + `source` (`stripe_webhook`/`silver_lining_cron`/`promo_code`/`admin_grant`/`horse_count_trigger`). No hard deletes — the full history is forensic-ready. |
| 9 | **Trainer onboarding alias copy** | Trainer invite email template documents the `user+trainer@gmail.com` alias trick for dual-role users (one human who is both owner and trainer). No code change — copy edit to `worker/emails/invitations.ts`. |
| 10 | **Stripe integration posture** | Owner subscriptions charge to **Maneline platform** (no `Stripe-Account` header). Phase 7 trainer invoices continue to charge to trainer Connect accounts. This is the ONE place in the codebase where we route both; the Worker helper `stripe.subscriptions.create` omits the Connect header, while the Phase 7 helper `stripe.invoices.create` includes it. |

**Non-goals (v1):** no mid-cycle prorated upgrades (annual ↔ monthly is cancel + new sub via Stripe Portal); no family / barn-sharing seats; no coupon stacking (one active comp source at a time); no retention offers ("Stay for 50% off this month"); no pause-and-resume UX (pause is supported via Stripe Portal but we don't surface a dedicated pause button); no finance reporting for admins on comp vs paid mix beyond the `/admin/promo-codes` ledger and the observability tile; no auto-downgrade on horse-count reduction (user owns the cancel decision).

---

## §B. Data model

### 1. `subscriptions`
```sql
create table if not exists public.subscriptions (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null references auth.users(id) on delete cascade,
  tier                        text not null default 'free' check (tier in ('free','barn_mode')),
  status                      text not null default 'active' check (status in (
                                'active','trialing','past_due','cancelled','paused'
                              )),
  stripe_customer_id          text,
  stripe_subscription_id      text unique,
  stripe_price_id             text,
  stripe_setup_intent_id      text,
  comp_source                 text check (comp_source is null or comp_source in (
                                'silver_lining_sns','promo_code','manual_grant'
                              )),
  comp_campaign               text,
  comp_expires_at             timestamptz,
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  cancel_at_period_end        boolean not null default false,
  last_webhook_event_at       timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  archived_at                 timestamptz,
  constraint subscriptions_owner_active_uniq unique (owner_id)
);

create index if not exists subscriptions_tier_status_idx
  on public.subscriptions(tier, status)
  where archived_at is null;
create index if not exists subscriptions_comp_expiry_idx
  on public.subscriptions(comp_expires_at)
  where comp_expires_at is not null and archived_at is null;

alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (owner_id = auth.uid());
revoke insert, update, delete on public.subscriptions from anon, authenticated;
-- All writes through Worker (service_role).
```

**One row per owner.** The unique constraint enforces a single subscription row per owner (ever). Transitions mutate the row in place; history lives in `barn_mode_entitlement_events`.

### 2. `silver_lining_links`
```sql
create table if not exists public.silver_lining_links (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null references auth.users(id) on delete cascade,
  silver_lining_customer_id   text not null,
  linked_at                   timestamptz not null default now(),
  last_verified_at            timestamptz,
  last_verification_status    text check (last_verification_status is null or last_verification_status in (
                                'active','cancelled','paused','not_found','error'
                              )),
  last_verification_error     text,
  sticky_until                timestamptz not null,
  stripe_setup_intent_id      text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  archived_at                 timestamptz
);

-- One SL customer -> one Maneline account, ever. Sticky across the 90-day window.
create unique index if not exists silver_lining_links_customer_uniq
  on public.silver_lining_links(silver_lining_customer_id)
  where archived_at is null;
create unique index if not exists silver_lining_links_owner_active_uniq
  on public.silver_lining_links(owner_id)
  where archived_at is null;
create index if not exists silver_lining_links_sticky_idx
  on public.silver_lining_links(sticky_until)
  where archived_at is null;

alter table public.silver_lining_links enable row level security;
drop policy if exists "silver_lining_links_select_own" on public.silver_lining_links;
create policy "silver_lining_links_select_own" on public.silver_lining_links
  for select using (owner_id = auth.uid());
revoke insert, update, delete on public.silver_lining_links from anon, authenticated;
```

**`sticky_until` default** = `linked_at + 90 days` — enforced at insert time by the Worker (not a column default because it depends on `linked_at`). An owner who archives a link and tries to link the same `silver_lining_customer_id` to a different Maneline account before `sticky_until` passes gets a 409 from the Worker.

### 3. `promo_codes`
```sql
create table if not exists public.promo_codes (
  id                          uuid primary key default gen_random_uuid(),
  code                        text not null,
  campaign                    text not null,
  grants_barn_mode_months     int not null check (grants_barn_mode_months between 1 and 36),
  single_use                  boolean not null default true,
  expires_at                  timestamptz,
  redeemed_at                 timestamptz,
  redeemed_by_owner_id        uuid references auth.users(id),
  created_by                  uuid references auth.users(id),
  notes                       text check (notes is null or char_length(notes) <= 500),
  created_at                  timestamptz not null default now(),
  archived_at                 timestamptz,
  constraint promo_codes_redeemed_consistency check (
    (redeemed_at is null and redeemed_by_owner_id is null)
    or (redeemed_at is not null and redeemed_by_owner_id is not null)
  )
);

create unique index if not exists promo_codes_code_uniq
  on public.promo_codes(upper(code))
  where archived_at is null;
create index if not exists promo_codes_campaign_idx
  on public.promo_codes(campaign)
  where archived_at is null;

alter table public.promo_codes enable row level security;
-- Codes are service-role only on read (so one owner can't enumerate another's code);
-- admin reads via Worker with explicit role check.
revoke all on public.promo_codes from anon, authenticated;
```

### 4. `barn_mode_entitlement_events`
```sql
create table if not exists public.barn_mode_entitlement_events (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  event             text not null check (event in (
                      'granted','revoked','converted','cancelled',
                      'comp_attached','comp_detached','grace_started','grace_expired'
                    )),
  reason            text,
  source            text not null check (source in (
                      'stripe_webhook','silver_lining_cron','promo_code',
                      'admin_grant','horse_count_trigger','user_action','setup_intent'
                    )),
  prev_tier         text,
  next_tier         text,
  prev_comp_source  text,
  next_comp_source  text,
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists barn_mode_entitlement_events_owner_idx
  on public.barn_mode_entitlement_events(owner_id, created_at desc);
create index if not exists barn_mode_entitlement_events_source_idx
  on public.barn_mode_entitlement_events(source, created_at desc);

alter table public.barn_mode_entitlement_events enable row level security;
drop policy if exists "entitlement_events_select_own" on public.barn_mode_entitlement_events;
create policy "entitlement_events_select_own" on public.barn_mode_entitlement_events
  for select using (owner_id = auth.uid());
revoke insert, update, delete on public.barn_mode_entitlement_events from anon, authenticated;
```

### 5. Horse count enforcement

Hard paywall lives in the Worker (not at the DB) so that the response shape can include `checkout_url` and a helpful message. The DB has a defense-in-depth check constraint via a trigger:

```sql
create or replace function public.enforce_horse_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
  v_on_barn_mode boolean;
begin
  if TG_OP <> 'INSERT' then
    return NEW;
  end if;

  select count(*) into v_count
  from public.animals
  where owner_id = NEW.owner_id and archived_at is null;

  select exists (
    select 1 from public.subscriptions s
    where s.owner_id = NEW.owner_id
      and s.archived_at is null
      and s.status in ('active','trialing')
      and (s.tier = 'barn_mode' or s.comp_source is not null)
  ) into v_on_barn_mode;

  -- Owner already has 3 horses, trying to add a 4th, and is not on Barn Mode: block.
  if v_count >= 3 and not v_on_barn_mode then
    raise exception 'barn_mode_required: owner % has % horses and no Barn Mode subscription', NEW.owner_id, v_count
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists animals_enforce_horse_limit on public.animals;
create trigger animals_enforce_horse_limit
  before insert on public.animals
  for each row execute function public.enforce_horse_limit();
```

The Worker middleware catches this before the DB trigger fires for the common 402 response path; the trigger is backstop for direct-SQL shenanigans.

---

## §C. Worker endpoints

All under `worker/routes/barn/subscription.ts` + `worker/routes/barn/silver-lining.ts` + `worker/routes/barn/promo-codes.ts` + `worker/routes/admin/promo-codes.ts`. Every write writes `audit_log` AND `barn_mode_entitlement_events`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/barn/subscription` | owner | Returns current `subscriptions` row + horse count + entitlement history (last 10 events). |
| `POST` | `/api/barn/subscription/checkout` | owner | Body: `{price: 'monthly' \| 'annual'}`. Returns `{checkout_url}`. Uses `stripe.checkout.sessions.create` with `mode='subscription'`, price id from env, `customer` resolved or created on platform (not Connect), `metadata.owner_id=<>`. |
| `POST` | `/api/barn/subscription/portal` | owner | Returns `{portal_url}` from `stripe.billingPortal.sessions.create`. |
| `POST` | `/api/barn/silver-lining/link` | owner | Body: `{email, order_number}`. Verifies via Shopify Admin API — fetches customer by email, confirms an order with that number exists. Returns `{silver_lining_customer_id, setup_intent_client_secret}` so the SPA can mount a Stripe Elements card form via the same Phase 3 component. |
| `POST` | `/api/barn/silver-lining/link/confirm` | owner | Body: `{setup_intent_id}`. Confirms SetupIntent succeeded (card saved), inserts `silver_lining_links` row with `sticky_until=linked_at+90d`, kicks off an immediate verification (instead of waiting for the nightly cron). |
| `GET` | `/api/barn/silver-lining/status` | owner | Returns the linked row + latest verification status. |
| `POST` | `/api/barn/silver-lining/unlink` | owner | Archives the link row IF `sticky_until < now()`; otherwise 409 with `{sticky_until}`. |
| `POST` | `/api/barn/promo-codes/redeem` | owner | Body: `{code}`. Validates + marks single-use + applies comp to `subscriptions`. |
| `GET` | `/api/admin/promo-codes?campaign=` | admin (`role='silver_lining'`) | List. |
| `POST` | `/api/admin/promo-codes` | admin | Body: `{campaign, grants_barn_mode_months, single_use, expires_at?, count}`. Generates `count` codes. |
| `POST` | `/api/_internal/silver-lining-verify-tick` | service-role cron | Nightly. Scans `silver_lining_links` where `archived_at is null`, calls Shopify Admin API per row, updates `last_verification_status`, flips `subscriptions.comp_source` accordingly, triggers grace + conversion logic. |

### Webhook handler additions (`/webhooks/stripe`)
Routes the following events to the Phase 8 subscription handler (co-resident with the Phase 7 invoice handler):
- `checkout.session.completed` (mode=subscription) → upsert `subscriptions` row with `tier='barn_mode'`, `status='active'`, `stripe_subscription_id`, period fields.
- `customer.subscription.updated` → sync status / period fields.
- `customer.subscription.deleted` → flip `status='cancelled'`, write `entitlement_event event='cancelled'`.
- `invoice.payment_failed` → flip `status='past_due'`, write `entitlement_event event='grace_started'` (card-failure grace).

### Silver Lining verification cron (detail)
```
pg_cron: silver_lining_verify_tick
schedule: 0 6 * * *  # 06:00 UTC daily
body: select net.http_post(
  'https://worker.maneline.co/api/_internal/silver-lining-verify-tick',
  body := '{}'::jsonb,
  headers := '{"X-Internal-Secret": "<secret>"}'::jsonb
);
```

Per-link loop:
1. `GET https://{SILVER_LINING_SHOPIFY_STORE_DOMAIN}/admin/api/2024-01/customers/{silver_lining_customer_id}/subscription_contracts.json` with `X-Shopify-Access-Token: {SILVER_LINING_SHOPIFY_ADMIN_TOKEN}`. **TODO(phase-8): confirm exact endpoint path with SLH — Shopify's native subscription_contracts endpoint may not exist; the SKU may live in ReCharge or similar. If SLH uses ReCharge, switch to `https://api.rechargeapps.com/subscriptions?shopify_customer_id={id}` with their token. Leave the integration module pluggable via `SILVER_LINING_BACKEND=shopify|recharge` env var.**
2. Parse response; determine if any contract is `status=active`.
3. If active AND `subscriptions.comp_source is null` → grant comp: set `tier='barn_mode'`, `status='active'`, `comp_source='silver_lining_sns'`, `comp_expires_at=null`. Write entitlement event `comp_attached`.
4. If NOT active AND `subscriptions.comp_source='silver_lining_sns'`:
   - If `comp_expires_at is null` → start 30-day grace: `comp_expires_at=now()+30d`. Entitlement event `grace_started`.
   - If `comp_expires_at < now()` → convert to $25: Worker attaches the saved payment method (from `stripe_setup_intent_id`) via Stripe Checkout-session-equivalent and creates a Stripe subscription. Entitlement event `converted`. If the attach fails → `status='past_due'`, entitlement `grace_expired` with error reason.
5. If Shopify API errors → `last_verification_status='error'`, `last_verification_error=<msg>`; DO NOT alter `comp_source` on a single API failure (wait until 3 consecutive failures before any state change — prevents outage-triggered billing drift).

---

## §D. UI

### `/app/settings/subscription`
- Header card: current tier badge (`Free` / `Barn Mode`), status pill, comp source chip if applicable, renewal date, cancel/manage button.
- "Upgrade to Barn Mode" section if `tier='free'`: price tiles ($25/mo; annual if `STRIPE_PRICE_BARN_MODE_ANNUAL` is set), "Start subscription" button → Checkout.
- "Link my Silver Lining account" section if no active link row: input fields (email + order number), "Verify & link" button → opens Stripe Elements card form (SetupIntent) in a shadcn `Dialog`.
- "Silver Lining status" section if linked: shows customer id (truncated), last verification status, `sticky_until`, unlink button (disabled while sticky).
- "Promo code" section: input + redeem button.
- "Billing history" section: list of entitlement events (last 20) with plain-English labels ("You started Barn Mode on 2026-06-10", "Your Silver Lining comp was applied").

### Soft upsell modal (horse #3)
Shadcn `Dialog`, non-blocking. Triggered by the `X-Barn-Mode-Upsell: soft` header on the `POST /api/animals` response. Copy: "You've just added your third horse — welcome to Barn Mode territory. Unlock SMS reminders, health reports, and unlimited horses for $25/mo." Two buttons: "See Barn Mode" (→ /app/settings/subscription) and "Maybe later" (dismiss).

### Hard paywall modal (horse #4)
Shadcn `Dialog`, no close button, no Escape close. Triggered on 402. Copy: "Adding a 4th horse requires Barn Mode — $25/mo unlocks unlimited horses plus SMS + health reports." One button: "Subscribe now" (→ checkout_url). Cancel action navigates back to previous page.

### Admin `/admin/promo-codes`
- Table of codes with filter by campaign.
- "Generate codes" dialog: campaign name, months granted, count, expiry.
- CSV export of redeemed codes.

### Empty / loading / error
- Loading: shadcn `Skeleton` rows.
- Empty billing history: "No changes yet — you're on the Free tier."
- Errors: Sonner toast with retry; Stripe-specific errors (e.g., card declined) surface the Stripe error message verbatim (already trimmed by the Stripe SDK).

---

## §E. Silver Lining verification job — operational notes

**Rate limit.** Shopify Admin API allows ~2 req/s per store under default plan. With N linked owners, the nightly job loops N rows; at 500ms sleep between requests we handle 10k accounts in 83 minutes. Acceptable for v1; revisit with bulk fetch when linked-count > 5k.

**Error budgets.** Three consecutive failures per link row → emit an alert to Cedric's Twilio on-call number (reuse Phase 6 `dispatchEmergencyPage` with `category='silver_lining_verification_failure'`). After 7 consecutive failures, archive-flag the link with `last_verification_status='error'` and notify the owner via email ("We couldn't verify your Silver Lining subscription — please re-link").

**Idempotency.** Every link row carries `last_verified_at`; the cron handler checks `last_verified_at > now() - 22h` and skips if the row was already verified recently (prevents double-billing conversion if the cron re-fires).

**Testing.** Seed a test SL customer in a Shopify sandbox store (SLH provides one as part of Dependency 6). Verify: (a) active contract → comp attaches; (b) cancel contract → 30-day grace; (c) grace expires → conversion to $25 succeeds with saved card; (d) card fails → `status='past_due'`, email fires.

---

## §F. Trainer onboarding alias copy

Add to `worker/emails/invitations.ts` in the trainer branch:

> **Are you both a trainer and a horse owner?**
> You can run both portals from one human — just sign up your trainer account with a `+trainer` alias on your Gmail (e.g., `jane+trainer@gmail.com`). Email still lands in your regular inbox. You'll get separate billing for each role. Full dual-role bundling is coming in a future release.

Same blurb in the owner welcome email if `user_profiles.role='owner'` AND the email was detected as a Google alias.

---

## §G. Stripe integration notes

- **Owner subscriptions charge to Maneline platform.** Worker helper is `createOwnerSubscription(env, owner_id, price_id)` — NO `Stripe-Account` header. Lives in `worker/integrations/stripe-platform.ts` (new).
- **Phase 7 trainer invoices continue to charge to trainer Connect accounts.** Existing `createConnectInvoice` helper remains unchanged, lives in `worker/integrations/stripe-connect.ts`.
- **SetupIntent at SL link time.** Card collection happens via `stripe.setupIntents.create` with `customer=<platform_customer_id>`, `usage='off_session'`. Stored as `silver_lining_links.stripe_setup_intent_id`. At grace-conversion time, the saved payment method is passed to `stripe.subscriptions.create` as `default_payment_method`.
- **Webhook signing.** Same `STRIPE_WEBHOOK_SECRET` as Phase 6 (shared signing secret). New events routed to the Phase 8 handler by `event.type`.
- **Idempotency keys.** All Stripe mutations use `Idempotency-Key: barn_mode:<owner_id>:<action>:<nonce>` so webhook re-delivery never double-acts.
- **PCI scope.** No card data ever hits the Worker; Stripe Elements on the SPA collects directly into Stripe. We only see the SetupIntent id + the resulting payment method id.
- **Tax.** v1 does not enable Stripe Tax (consumer subscription, no B2B). Revisit when we have > 100 paying owners.

---

## §H. Verify block

### 1. Migration integrity
```bash
psql $DATABASE_URL -c "
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on c.relnamespace = n.oid
  where n.nspname='public'
    and c.relname in ('subscriptions','silver_lining_links','promo_codes','barn_mode_entitlement_events')
  order by c.relname;
"
# Expect: 4 rows, all RLS enabled
```

### 2. Horse count enforcement (DB trigger)
Seed owner with 3 horses, no subscription:
```bash
psql $DATABASE_URL -c "
  insert into animals(owner_id, species, name) values ('$OWNER_ID','horse','Test4');
"
# Expect: ERROR barn_mode_required ... 3 horses and no Barn Mode subscription
```

Grant comp manually, retry:
```bash
psql $DATABASE_URL -c "
  insert into subscriptions(owner_id, tier, status, comp_source)
  values ('$OWNER_ID','barn_mode','active','manual_grant');
  insert into animals(owner_id, species, name) values ('$OWNER_ID','horse','Test4');
"
# Expect: both insert 1 row
```

### 3. Horse #4 hard paywall (Worker layer)
Revoke the comp, try via API:
```bash
psql $DATABASE_URL -c "update subscriptions set archived_at=now() where owner_id='$OWNER_ID';"

curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://worker.maneline.co/api/animals \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"species":"horse","name":"Test5"}'
# Expect: 402

curl -sS -X POST https://worker.maneline.co/api/animals \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"species":"horse","name":"Test5"}' | jq '.error'
# Expect: "barn_mode_required"
```

### 4. Horse #3 soft upsell header
Seed owner with 2 horses, add a 3rd via API:
```bash
curl -sS -i -X POST https://worker.maneline.co/api/animals \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"species":"horse","name":"Third"}' | grep -i "X-Barn-Mode-Upsell"
# Expect: X-Barn-Mode-Upsell: soft
```

### 5. Stripe Checkout flow (requires live keys)
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/subscription/checkout \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"price":"monthly"}' | jq '.checkout_url'
# Expect: https://checkout.stripe.com/c/pay/... URL

# Complete the checkout in a browser with Stripe test card 4242 4242 4242 4242
# Then:
psql $DATABASE_URL -c "
  select tier, status, stripe_subscription_id, current_period_end
  from subscriptions where owner_id='$OWNER_ID';
"
# Expect: tier=barn_mode, status=active, non-null stripe_subscription_id
```

### 6. Silver Lining link + verification
Seed a test SL customer id in the Shopify sandbox:
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/silver-lining/link \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"email":"sl-test@example.com","order_number":"1001"}' | jq
# Expect: {silver_lining_customer_id: "<shopify id>", setup_intent_client_secret: "seti_..."}

# Complete SetupIntent in browser. Then:
curl -sS -X POST https://worker.maneline.co/api/barn/silver-lining/link/confirm \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"setup_intent_id":"seti_..."}' | jq
# Expect: {status: "active", comp_source: "silver_lining_sns"}

psql $DATABASE_URL -c "
  select event, source, next_tier, next_comp_source
  from barn_mode_entitlement_events
  where owner_id='$OWNER_ID' order by created_at desc limit 3;
"
# Expect at least: comp_attached / setup_intent entry, source 'setup_intent' or 'silver_lining_cron'
```

### 7. Nightly cron — SL cancel → grace
Simulate SL cancellation in sandbox (flip the subscribe-and-save contract to cancelled in Shopify). Run the cron manually:
```bash
curl -sS -X POST https://worker.maneline.co/api/_internal/silver-lining-verify-tick \
  -H "X-Internal-Secret: $INTERNAL_SECRET"

psql $DATABASE_URL -c "
  select comp_source, comp_expires_at, status
  from subscriptions where owner_id='$OWNER_ID';
"
# Expect: comp_source still 'silver_lining_sns', comp_expires_at ~ now() + 30d, status 'active'
```

Fast-forward: set `comp_expires_at` to `now() - 1 day`, re-run cron:
```bash
psql $DATABASE_URL -c "update subscriptions set comp_expires_at = now() - interval '1 day' where owner_id='$OWNER_ID';"
curl -sS -X POST https://worker.maneline.co/api/_internal/silver-lining-verify-tick \
  -H "X-Internal-Secret: $INTERNAL_SECRET"

psql $DATABASE_URL -c "
  select tier, status, comp_source, stripe_subscription_id
  from subscriptions where owner_id='$OWNER_ID';
"
# Expect: tier=barn_mode, status=active, comp_source=null, stripe_subscription_id non-null (converted to paid)
```

### 8. 90-day sticky enforcement
Archive a link, attempt to re-link the same SL customer to a different Maneline account within 90 days:
```bash
psql $DATABASE_URL -c "update silver_lining_links set archived_at=now() where owner_id='$OWNER_ID';"

# As owner B:
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://worker.maneline.co/api/barn/silver-lining/link \
  -H "Authorization: Bearer $OWNER_B_JWT" -H "Content-Type: application/json" \
  -d '{"email":"sl-test@example.com","order_number":"1001"}'
# Expect: 409
```

### 9. Promo code redemption
```bash
curl -sS -X POST https://worker.maneline.co/api/admin/promo-codes \
  -H "Authorization: Bearer $ADMIN_JWT" -H "Content-Type: application/json" \
  -d '{"campaign":"swag_bag_q2","grants_barn_mode_months":3,"single_use":true,"count":1}' | jq '.codes[0].code'
# capture code -> $CODE

curl -sS -X POST https://worker.maneline.co/api/barn/promo-codes/redeem \
  -H "Authorization: Bearer $FREE_OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"code":"'$CODE'"}' | jq
# Expect: {status:"redeemed", comp_source:"promo_code", comp_campaign:"swag_bag_q2", comp_expires_at: now()+3 months}

# Redeem again -> 409 (single_use)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://worker.maneline.co/api/barn/promo-codes/redeem \
  -H "Authorization: Bearer $OTHER_OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"code":"'$CODE'"}'
# Expect: 409
```

### 10. Cancel flow
Owner opens Customer Portal, cancels at period end:
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/subscription/portal \
  -H "Authorization: Bearer $OWNER_JWT" | jq '.portal_url'
# Complete cancel in browser

# After Stripe webhook:
psql $DATABASE_URL -c "
  select cancel_at_period_end, status from subscriptions where owner_id='$OWNER_ID';
"
# Expect: cancel_at_period_end=true, status='active' (still active until period end)
```

### 11. Entitlement audit completeness
```bash
psql $DATABASE_URL -c "
  select event, source, count(*)
  from barn_mode_entitlement_events
  where owner_id='$OWNER_ID'
  group by event, source order by event;
"
# Expect rows for: granted / stripe_webhook, comp_attached / silver_lining_cron,
# grace_started / silver_lining_cron, converted / silver_lining_cron, etc.
```

### 12. Static grep
```bash
! grep -R "@heroui/react" app/src/pages/settings/subscription 2>/dev/null
! grep -R "Stripe-Account" worker/routes/barn/subscription.ts 2>/dev/null
# Owner subscriptions must NOT use Stripe Connect headers

! grep -R "delete from subscriptions\|delete from silver_lining_links\|delete from promo_codes" worker 2>/dev/null
```

### 13. Observability tile
```bash
curl -sS https://worker.maneline.co/api/_integrations-health | jq '.subscriptions, .silver_lining, .promo_codes'
# Expect:
# subscriptions: { barn_mode_paid_count: N, barn_mode_comp_count: M }
# silver_lining: { linked_count: L, last_verification_run_at: <ts>, verification_failures_24h: 0 }
# promo_codes: { redeemed_24h: P }
```

---

**End of 05-pricing-and-silver-lining-comp.md — ships with 4 new tables + 1 enforcement trigger + nightly verification cron + Stripe platform integration. Blocks Phase 8 launch: the hard paywall at horse #4 depends on this module, and nothing else gates subscription.**
