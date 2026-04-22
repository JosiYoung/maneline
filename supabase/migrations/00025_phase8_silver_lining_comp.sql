-- =============================================================
-- Phase 8 Module 05 — Pricing + Silver Lining comp + paywall
-- Migration: 00025_phase8_silver_lining_comp.sql
--
-- 4 new tables:
--   1) subscriptions                     — owner tier + status + comp source
--   2) silver_lining_links               — SL customer ↔ Maneline owner
--   3) promo_codes                       — campaign codes + redemption ledger
--   4) barn_mode_entitlement_events      — append-only entitlement audit
--
-- Plus: BEFORE INSERT trigger on animals that enforces the horse #4
-- hard paywall at the DB level (defense-in-depth; Worker middleware
-- handles the 402 response shape).
--
-- Compliance:
--   OAG §2 — every table is service-role-write; selects scoped to
--            auth.uid() via RLS. `promo_codes` select is revoked
--            entirely — admins read through the Worker.
--   OAG §3 — barn_mode_entitlement_events is the entitlement audit
--            log (append-only; no update/delete path).
--   OAG §7 — RLS day-one on all four tables.
--   OAG §8 — archive-never-delete on subscriptions, silver_lining_links,
--            promo_codes. Cancelled subs flip status + archived_at.
-- =============================================================

begin;

-- 1) subscriptions — one row per owner, mutated in place.
create table if not exists public.subscriptions (
  id                          uuid primary key default gen_random_uuid(),
  owner_id                    uuid not null references auth.users(id) on delete cascade,
  tier                        text not null default 'free'
                                check (tier in ('free','barn_mode')),
  status                      text not null default 'active'
                                check (status in ('active','trialing','past_due','cancelled','paused')),
  stripe_customer_id          text,
  stripe_subscription_id      text,
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
  archived_at                 timestamptz
);

-- One ACTIVE (non-archived) row per owner. Archiving permits re-subscribing
-- later without a unique-violation.
create unique index if not exists subscriptions_owner_active_uniq
  on public.subscriptions(owner_id)
  where archived_at is null;
create unique index if not exists subscriptions_stripe_sub_uniq
  on public.subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;
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

drop trigger if exists subscriptions_touch on public.subscriptions;
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();


-- 2) silver_lining_links — SL customer linked to a Maneline owner.
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
  consecutive_failure_count   int not null default 0,
  sticky_until                timestamptz not null,
  stripe_setup_intent_id      text,
  stripe_payment_method_id    text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  archived_at                 timestamptz
);

create unique index if not exists silver_lining_links_customer_uniq
  on public.silver_lining_links(silver_lining_customer_id)
  where archived_at is null;
create unique index if not exists silver_lining_links_owner_active_uniq
  on public.silver_lining_links(owner_id)
  where archived_at is null;
create index if not exists silver_lining_links_sticky_idx
  on public.silver_lining_links(sticky_until)
  where archived_at is null;
create index if not exists silver_lining_links_verify_idx
  on public.silver_lining_links(last_verified_at nulls first)
  where archived_at is null;

alter table public.silver_lining_links enable row level security;

drop policy if exists "silver_lining_links_select_own" on public.silver_lining_links;
create policy "silver_lining_links_select_own" on public.silver_lining_links
  for select using (owner_id = auth.uid());

revoke insert, update, delete on public.silver_lining_links from anon, authenticated;

drop trigger if exists silver_lining_links_touch on public.silver_lining_links;
create trigger silver_lining_links_touch before update on public.silver_lining_links
  for each row execute function public.touch_updated_at();


-- 3) promo_codes — campaign codes, single-use by default.
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
create index if not exists promo_codes_redeemed_idx
  on public.promo_codes(redeemed_at)
  where redeemed_at is not null;

alter table public.promo_codes enable row level security;

-- No RLS SELECT policy: codes are never readable by client. Admin reads
-- always route through the Worker with an explicit role check.
revoke all on public.promo_codes from anon, authenticated;


-- 4) barn_mode_entitlement_events — append-only audit of every tier change.
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

create index if not exists entitlement_events_owner_idx
  on public.barn_mode_entitlement_events(owner_id, created_at desc);
create index if not exists entitlement_events_source_idx
  on public.barn_mode_entitlement_events(source, created_at desc);

alter table public.barn_mode_entitlement_events enable row level security;

drop policy if exists "entitlement_events_select_own" on public.barn_mode_entitlement_events;
create policy "entitlement_events_select_own" on public.barn_mode_entitlement_events
  for select using (owner_id = auth.uid());

revoke insert, update, delete on public.barn_mode_entitlement_events from anon, authenticated;


-- 5) Horse count enforcement trigger — BEFORE INSERT on animals.
--    The Worker middleware returns 402 with checkout_url before this
--    trigger fires on the happy path. This trigger is the defense
--    layer for direct-SQL or service-role callers that skip the middleware.
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

  -- Only count non-archived animals belonging to this owner.
  select count(*) into v_count
  from public.animals
  where owner_id = NEW.owner_id
    and archived_at is null;

  select exists (
    select 1
    from public.subscriptions s
    where s.owner_id = NEW.owner_id
      and s.archived_at is null
      and s.status in ('active','trialing')
      and (
        s.tier = 'barn_mode'
        or (s.comp_source is not null
            and (s.comp_expires_at is null or s.comp_expires_at > now()))
      )
  ) into v_on_barn_mode;

  -- Owner already has 3 non-archived horses, trying to add a 4th, and is
  -- not on Barn Mode (paid or comped): block.
  if v_count >= 3 and not v_on_barn_mode then
    raise exception 'barn_mode_required: owner % has % horses and no Barn Mode subscription',
      NEW.owner_id, v_count
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists animals_enforce_horse_limit on public.animals;
create trigger animals_enforce_horse_limit
  before insert on public.animals
  for each row execute function public.enforce_horse_limit();

commit;
