-- =============================================================
-- Mane Line — Phase 2 (Trainer Portal + Session Logging + Stripe Payouts)
-- Migration: 00006_phase2_trainer_sessions.sql
-- Date:      2026-04-17
--
-- Creates the data model behind Phase 2 Prompt 2.1:
--   • training_sessions           — trainer-authored, owner-readable
--   • session_payments            — owner pays, funds route to trainer
--   • stripe_connect_accounts     — Stripe Connect Express acct per trainer
--   • platform_settings           — singleton: default platform fee (bps)
--   • stripe_webhook_events       — event log (idempotency + sweep)
--   • session_archive_events      — audit of soft-archive transitions
--
-- Fee model (see docs/phase-2-plan.md Prompt 2.7):
--   effective_fee_bps(trainer) = COALESCE(
--     stripe_connect_accounts.fee_override_bps,
--     platform_settings.default_fee_bps
--   )
--   Default seeded at 1000 bps (10 %). Admin edits via Worker.
--
-- Trainer KYC policy (Prompt 2.5):
--   Session logging is NEVER gated on charges_enabled. Payment
--   collection waits: if the trainer is not ready, a
--   session_payments row lands with status='awaiting_trainer_setup'
--   and the account.updated webhook auto-retries later.
--
-- Compliance:
--   OAG §7 — RLS on every table day one.
--   OAG §8 — archive-never-delete; status lifecycles only.
--   OAG §2 — admin surfaces (fee overrides, platform settings,
--            webhook log) are service_role only; trainer reads on
--            stripe_connect_accounts go through column grants so
--            fee_override_* stay hidden.
--
-- Safe to re-run: idempotent creates + drop-if-exists on policies,
-- create-or-replace on functions, revoke is no-op if grant absent.
-- =============================================================


-- =============================================================
-- 1) training_sessions
-- =============================================================
create table if not exists public.training_sessions (
  id                    uuid primary key default gen_random_uuid(),
  trainer_id            uuid not null references auth.users(id),
  owner_id              uuid not null references auth.users(id),
  animal_id             uuid not null references public.animals(id) on delete cascade,
  session_type          text not null check (session_type in (
                          'ride','groundwork','bodywork','health_check','lesson','other'
                        )),
  started_at            timestamptz not null,
  duration_minutes      int not null check (duration_minutes > 0 and duration_minutes <= 600),
  title                 text not null check (char_length(title) between 1 and 120),
  notes                 text,
  trainer_price_cents   int check (trainer_price_cents is null or trainer_price_cents >= 0),
  currency              text not null default 'usd' check (currency = 'usd'),
  status                text not null default 'logged' check (status in (
                          'logged','approved','paid','disputed'
                        )),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz
);

create index if not exists training_sessions_trainer_started_idx
  on public.training_sessions(trainer_id, started_at desc)
  where archived_at is null;
create index if not exists training_sessions_owner_started_idx
  on public.training_sessions(owner_id, started_at desc)
  where archived_at is null;
create index if not exists training_sessions_animal_started_idx
  on public.training_sessions(animal_id, started_at desc)
  where archived_at is null;

alter table public.training_sessions enable row level security;

drop policy if exists "training_sessions_owner_select" on public.training_sessions;
create policy "training_sessions_owner_select" on public.training_sessions
  for select using (owner_id = auth.uid());

drop policy if exists "training_sessions_trainer_select" on public.training_sessions;
create policy "training_sessions_trainer_select" on public.training_sessions
  for select using (
    trainer_id = auth.uid() and public.do_i_have_access_to_animal(animal_id)
  );

drop policy if exists "training_sessions_trainer_insert" on public.training_sessions;
create policy "training_sessions_trainer_insert" on public.training_sessions
  for insert with check (
    trainer_id = auth.uid()
    and public.do_i_have_access_to_animal(animal_id)
    and status = 'logged'
    and archived_at is null
  );

drop policy if exists "training_sessions_trainer_update" on public.training_sessions;
create policy "training_sessions_trainer_update" on public.training_sessions
  for update
  using (
    trainer_id = auth.uid()
    and public.do_i_have_access_to_animal(animal_id)
    and status = 'logged'
    and archived_at is null
  )
  with check (
    trainer_id = auth.uid()
    and status = 'logged'
  );

revoke delete on public.training_sessions from anon, authenticated;


-- =============================================================
-- 2) session_payments
-- =============================================================
create table if not exists public.session_payments (
  id                         uuid primary key default gen_random_uuid(),
  session_id                 uuid not null unique references public.training_sessions(id) on delete cascade,
  payer_id                   uuid not null references auth.users(id),
  payee_id                   uuid not null references auth.users(id),
  stripe_payment_intent_id   text unique,
  stripe_charge_id           text,
  stripe_event_last_seen     text,
  amount_cents               int not null check (amount_cents > 0),
  platform_fee_cents         int not null check (platform_fee_cents >= 0),
  currency                   text not null default 'usd' check (currency = 'usd'),
  status                     text not null default 'pending' check (status in (
                               'pending','processing','succeeded','failed','refunded',
                               'awaiting_trainer_setup'
                             )),
  failure_code               text,
  failure_message            text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

create index if not exists session_payments_payer_idx
  on public.session_payments(payer_id, created_at desc);
create index if not exists session_payments_payee_idx
  on public.session_payments(payee_id, created_at desc);
create index if not exists session_payments_awaiting_idx
  on public.session_payments(payee_id)
  where status = 'awaiting_trainer_setup';

alter table public.session_payments enable row level security;

drop policy if exists "session_payments_owner_select" on public.session_payments;
create policy "session_payments_owner_select" on public.session_payments
  for select using (payer_id = auth.uid());

drop policy if exists "session_payments_trainer_select" on public.session_payments;
create policy "session_payments_trainer_select" on public.session_payments
  for select using (payee_id = auth.uid());

revoke insert, update, delete on public.session_payments from anon, authenticated;


-- =============================================================
-- 3) stripe_connect_accounts
--    fee_override_* columns are admin-only. Trainers see their
--    own row minus the override columns via column grants + view.
-- =============================================================
create table if not exists public.stripe_connect_accounts (
  id                               uuid primary key default gen_random_uuid(),
  trainer_id                       uuid not null unique references auth.users(id),
  stripe_account_id                text not null unique,
  charges_enabled                  boolean not null default false,
  payouts_enabled                  boolean not null default false,
  details_submitted                boolean not null default false,
  disabled_reason                  text,
  onboarding_link_last_issued_at   timestamptz,
  fee_override_bps                 int check (
                                     fee_override_bps is null
                                     or (fee_override_bps >= 0 and fee_override_bps <= 10000)
                                   ),
  fee_override_reason              text,
  fee_override_set_by              uuid references auth.users(id),
  fee_override_set_at              timestamptz,
  created_at                       timestamptz not null default now(),
  updated_at                       timestamptz not null default now(),
  deactivated_at                   timestamptz
);

create index if not exists stripe_connect_accounts_trainer_idx
  on public.stripe_connect_accounts(trainer_id)
  where deactivated_at is null;

alter table public.stripe_connect_accounts enable row level security;

drop policy if exists "stripe_connect_accounts_trainer_select" on public.stripe_connect_accounts;
create policy "stripe_connect_accounts_trainer_select" on public.stripe_connect_accounts
  for select using (trainer_id = auth.uid());

-- Remove broad SELECT, then grant only non-override columns.
-- Trainers cannot read fee_override_* directly. Admin/Worker uses
-- service_role which bypasses grants + RLS.
revoke select on public.stripe_connect_accounts from anon, authenticated;
grant select (
  id, trainer_id, stripe_account_id,
  charges_enabled, payouts_enabled, details_submitted,
  disabled_reason, onboarding_link_last_issued_at,
  created_at, updated_at, deactivated_at
) on public.stripe_connect_accounts to authenticated;

revoke insert, update, delete on public.stripe_connect_accounts from anon, authenticated;

-- Convenience view for trainer SPA: `select * from v_my_connect_account`
-- works without having to list columns manually.
drop view if exists public.v_my_connect_account;
create view public.v_my_connect_account
  with (security_invoker = true) as
  select id, trainer_id, stripe_account_id,
         charges_enabled, payouts_enabled, details_submitted,
         disabled_reason, onboarding_link_last_issued_at,
         created_at, updated_at, deactivated_at
  from public.stripe_connect_accounts;

grant select on public.v_my_connect_account to authenticated;


-- =============================================================
-- 4) platform_settings (singleton)
--    Exactly one row (id=1). Global default platform fee.
--    Admin edits via Worker service_role. No client access.
-- =============================================================
create table if not exists public.platform_settings (
  id               int primary key default 1 check (id = 1),
  default_fee_bps  int not null default 1000 check (
                     default_fee_bps >= 0 and default_fee_bps <= 10000
                   ),
  updated_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now()
);

-- Seed the singleton row. Safe on re-run.
insert into public.platform_settings (id) values (1)
  on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

drop policy if exists "platform_settings_no_client_access" on public.platform_settings;
create policy "platform_settings_no_client_access" on public.platform_settings
  for select using (false);

revoke all on public.platform_settings from anon, authenticated;


-- =============================================================
-- 5) stripe_webhook_events
--    Idempotency log + sweep state. Raw Stripe event body kept
--    for replay and audit. Service_role only.
-- =============================================================
create table if not exists public.stripe_webhook_events (
  id                    uuid primary key default gen_random_uuid(),
  event_id              text not null unique,
  event_type            text not null,
  payload               jsonb not null,
  received_at           timestamptz not null default now(),
  processed_at          timestamptz,
  processing_attempts   int not null default 0,
  last_error            text,
  source                text not null default 'webhook' check (source in ('webhook','sweep'))
);

create index if not exists stripe_webhook_events_unprocessed_idx
  on public.stripe_webhook_events(processed_at)
  where processed_at is null;
create index if not exists stripe_webhook_events_received_idx
  on public.stripe_webhook_events(received_at desc);

alter table public.stripe_webhook_events enable row level security;

drop policy if exists "stripe_webhook_events_no_client_access" on public.stripe_webhook_events;
create policy "stripe_webhook_events_no_client_access" on public.stripe_webhook_events
  for select using (false);

revoke all on public.stripe_webhook_events from anon, authenticated;


-- =============================================================
-- 6) session_archive_events
--    Append-only audit of soft-archive transitions on training_sessions.
--    Written by the Worker (service_role) after UPDATE succeeds.
-- =============================================================
create table if not exists public.session_archive_events (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references public.training_sessions(id) on delete cascade,
  actor_id    uuid not null references auth.users(id),
  action      text not null check (action in ('archive','unarchive')),
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists session_archive_events_session_idx
  on public.session_archive_events(session_id, created_at desc);

alter table public.session_archive_events enable row level security;

drop policy if exists "session_archive_events_owner_select" on public.session_archive_events;
create policy "session_archive_events_owner_select" on public.session_archive_events
  for select using (
    exists (
      select 1 from public.training_sessions s
      where s.id = session_archive_events.session_id
        and s.owner_id = auth.uid()
    )
  );

drop policy if exists "session_archive_events_trainer_select" on public.session_archive_events;
create policy "session_archive_events_trainer_select" on public.session_archive_events
  for select using (
    exists (
      select 1 from public.training_sessions s
      where s.id = session_archive_events.session_id
        and s.trainer_id = auth.uid()
    )
  );

revoke insert, update, delete on public.session_archive_events from anon, authenticated;


-- =============================================================
-- 7) updated_at triggers (reuse helper from migration 00002)
-- =============================================================
drop trigger if exists training_sessions_touch_updated_at on public.training_sessions;
create trigger training_sessions_touch_updated_at
  before update on public.training_sessions
  for each row execute function public.touch_updated_at();

drop trigger if exists session_payments_touch_updated_at on public.session_payments;
create trigger session_payments_touch_updated_at
  before update on public.session_payments
  for each row execute function public.touch_updated_at();

drop trigger if exists stripe_connect_accounts_touch_updated_at on public.stripe_connect_accounts;
create trigger stripe_connect_accounts_touch_updated_at
  before update on public.stripe_connect_accounts
  for each row execute function public.touch_updated_at();

drop trigger if exists platform_settings_touch_updated_at on public.platform_settings;
create trigger platform_settings_touch_updated_at
  before update on public.platform_settings
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 8) Helpers
-- =============================================================

-- effective_fee_bps — single source of truth for platform-fee math.
-- Used by the Worker when minting PaymentIntents and by the admin UI.
create or replace function public.effective_fee_bps(p_trainer_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_override int;
  v_default  int;
begin
  select fee_override_bps into v_override
  from public.stripe_connect_accounts
  where trainer_id = p_trainer_id
    and deactivated_at is null
  order by created_at desc
  limit 1;

  if v_override is not null then
    return v_override;
  end if;

  select default_fee_bps into v_default
  from public.platform_settings
  where id = 1;

  return coalesce(v_default, 1000);
end;
$$;

revoke execute on function public.effective_fee_bps(uuid) from anon, authenticated;
grant  execute on function public.effective_fee_bps(uuid) to service_role;

-- latest_connect_for — Worker helper. Returns null if no active acct.
create or replace function public.latest_connect_for(p_trainer_id uuid)
returns public.stripe_connect_accounts
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
  from public.stripe_connect_accounts
  where trainer_id = p_trainer_id
    and deactivated_at is null
  order by created_at desc
  limit 1;
$$;

revoke execute on function public.latest_connect_for(uuid) from anon, authenticated;
grant  execute on function public.latest_connect_for(uuid) to service_role;

-- session_is_payable — convenience for owner UI gating.
-- Returns true only when session is approved AND trainer has Connect ready.
create or replace function public.session_is_payable(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.training_sessions s
    join public.stripe_connect_accounts a on a.trainer_id = s.trainer_id
    where s.id = p_session_id
      and s.status = 'approved'
      and s.archived_at is null
      and a.charges_enabled = true
      and a.deactivated_at is null
  );
$$;

grant execute on function public.session_is_payable(uuid) to authenticated, service_role;


-- =============================================================
-- 9) Post-apply verification (run in SQL Editor):
--
--   -- a. Every Phase 2 table has RLS enabled:
--   select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on c.relnamespace = n.oid
--   where n.nspname = 'public'
--     and c.relname in (
--       'training_sessions','session_payments','stripe_connect_accounts',
--       'platform_settings','stripe_webhook_events','session_archive_events'
--     );
--   -- Expect: all 6 rows with relrowsecurity = true.
--
--   -- b. platform_settings has exactly one row, seeded at 1000 bps:
--   select id, default_fee_bps from public.platform_settings;
--   -- Expect: (1, 1000)
--
--   -- c. effective_fee_bps returns the seeded default when no override:
--   select public.effective_fee_bps('00000000-0000-0000-0000-000000000000');
--   -- Expect: 1000
--
--   -- d. Anon/authenticated cannot read platform_settings or webhook events:
--   set role anon;  select * from public.platform_settings;  -- Expect: 0 rows
--   set role anon;  select * from public.stripe_webhook_events;  -- Expect: 0 rows
--   reset role;
--
--   -- e. Policy count:
--   select tablename, count(*) as policy_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in (
--       'training_sessions','session_payments','stripe_connect_accounts',
--       'platform_settings','stripe_webhook_events','session_archive_events'
--     )
--   group by tablename order by tablename;
--   -- Expect: every table >= 1, total >= 8.
-- =============================================================
