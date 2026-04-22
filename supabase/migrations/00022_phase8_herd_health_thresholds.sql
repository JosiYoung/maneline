-- =============================================================
-- Phase 8 Module 02 — Herd Health Dashboard
-- Migration: 00022_phase8_herd_health_thresholds.sql
--
-- Lands:
--   1) Extend vet_records.record_type check constraint to include
--      the 7 Herd Health dashboard record types
--      (core_vaccines, risk_vaccines, fec, deworming) alongside the
--      existing (coggins, vaccine, dental, farrier, other).
--   2) Table: health_thresholds (one row per owner × record_type,
--      interval_days + enabled).
--   3) Table: health_dashboard_acknowledgements (append-only cell
--      dismissals with dismissed_until + archived_at).
--   4) Function: compute_herd_health(p_owner_id uuid) — server-side
--      dashboard aggregator. SECURITY DEFINER, service_role only.
--
-- Laws: OAG §2 (Worker + service_role reads aggregations — RPC
-- grant is service_role only), §3 (every Worker call writes
-- audit_log — enforced in Worker, not DB), §7 (RLS day one on
-- both new tables), §8 (archive-never-delete — revoke delete on
-- both tables; acknowledgements carry archived_at).
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1) Extend vet_records.record_type check constraint
-- -------------------------------------------------------------
alter table public.vet_records
  drop constraint if exists vet_records_record_type_check;

alter table public.vet_records
  add constraint vet_records_record_type_check
  check (record_type in (
    'coggins',
    'vaccine',           -- legacy generic vaccine type, retained
    'core_vaccines',     -- EEE / WEE / WNV / Tetanus (annual)
    'risk_vaccines',     -- Flu / Rhino (6-month)
    'dental',
    'farrier',
    'fec',               -- fecal egg count (quarterly)
    'deworming',         -- informational only — no calendar alarm by default
    'other'
  ));

-- -------------------------------------------------------------
-- 2) health_thresholds
-- -------------------------------------------------------------
create table if not exists public.health_thresholds (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  record_type     text not null check (record_type in (
                    'coggins','core_vaccines','risk_vaccines',
                    'dental','farrier','fec','deworming'
                  )),
  interval_days   int  not null check (interval_days between 1 and 3650),
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint health_thresholds_owner_type_uniq unique (owner_id, record_type)
);

create index if not exists health_thresholds_owner_idx
  on public.health_thresholds(owner_id);

alter table public.health_thresholds enable row level security;

drop policy if exists "health_thresholds_select_own" on public.health_thresholds;
create policy "health_thresholds_select_own" on public.health_thresholds
  for select using (owner_id = auth.uid());

drop policy if exists "health_thresholds_insert_own" on public.health_thresholds;
create policy "health_thresholds_insert_own" on public.health_thresholds
  for insert with check (owner_id = auth.uid());

drop policy if exists "health_thresholds_update_own" on public.health_thresholds;
create policy "health_thresholds_update_own" on public.health_thresholds
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

revoke delete on public.health_thresholds from anon, authenticated;

drop trigger if exists health_thresholds_touch_updated_at on public.health_thresholds;
create trigger health_thresholds_touch_updated_at
  before update on public.health_thresholds
  for each row execute procedure public.touch_updated_at();

-- -------------------------------------------------------------
-- 3) health_dashboard_acknowledgements
-- -------------------------------------------------------------
create table if not exists public.health_dashboard_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  animal_id       uuid not null references public.animals(id) on delete cascade,
  record_type     text not null check (record_type in (
                    'coggins','core_vaccines','risk_vaccines',
                    'dental','farrier','fec','deworming'
                  )),
  dismissed_until timestamptz not null,
  reason          text check (reason is null or char_length(reason) <= 500),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index if not exists health_dash_ack_owner_animal_idx
  on public.health_dashboard_acknowledgements(owner_id, animal_id, record_type)
  where archived_at is null;

alter table public.health_dashboard_acknowledgements enable row level security;

drop policy if exists "health_dash_ack_select_own" on public.health_dashboard_acknowledgements;
create policy "health_dash_ack_select_own" on public.health_dashboard_acknowledgements
  for select using (owner_id = auth.uid());

drop policy if exists "health_dash_ack_insert_own" on public.health_dashboard_acknowledgements;
create policy "health_dash_ack_insert_own" on public.health_dashboard_acknowledgements
  for insert with check (owner_id = auth.uid());

drop policy if exists "health_dash_ack_update_own" on public.health_dashboard_acknowledgements;
create policy "health_dash_ack_update_own" on public.health_dashboard_acknowledgements
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

revoke delete on public.health_dashboard_acknowledgements from anon, authenticated;

-- -------------------------------------------------------------
-- 4) compute_herd_health(p_owner_id uuid)
--    SECURITY DEFINER. Returns one row per animal × record_type.
--    Reads vet_records (record_type ∈ dashboard set; legacy
--    'vaccine' is surfaced only if caller queries it directly, NOT
--    remapped to core/risk — v1 keeps the typing explicit).
-- -------------------------------------------------------------
create or replace function public.compute_herd_health(p_owner_id uuid)
returns table (
  animal_id       uuid,
  record_type     text,
  last_record_at  timestamptz,
  next_due_at     timestamptz,
  interval_days   int,
  enabled         boolean,
  dismissed_until timestamptz,
  status          text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with thresholds as (
    select * from public.health_thresholds where owner_id = p_owner_id
  ),
  latest_rec as (
    select vr.animal_id,
           vr.record_type,
           max(coalesce(vr.issued_on::timestamptz, vr.created_at)) as last_record_at
    from public.vet_records vr
    join public.animals a on a.id = vr.animal_id
    where a.owner_id = p_owner_id
      and a.archived_at is null
      and vr.archived_at is null
    group by vr.animal_id, vr.record_type
  ),
  latest_ack as (
    select distinct on (animal_id, record_type)
      animal_id, record_type, dismissed_until
    from public.health_dashboard_acknowledgements
    where owner_id = p_owner_id
      and archived_at is null
      and dismissed_until > now()
    order by animal_id, record_type, created_at desc
  )
  select
    a.id as animal_id,
    t.record_type,
    lr.last_record_at,
    case when lr.last_record_at is not null and t.interval_days > 0
         then lr.last_record_at + (t.interval_days || ' days')::interval
         else null end as next_due_at,
    t.interval_days,
    t.enabled,
    la.dismissed_until,
    case
      when not t.enabled then 'disabled'
      when lr.last_record_at is null then 'no_record'
      when la.dismissed_until is not null then 'dismissed'
      when lr.last_record_at + (t.interval_days || ' days')::interval < now() then 'overdue'
      when lr.last_record_at + ((t.interval_days::numeric * 0.5) || ' days')::interval < now() then 'warn'
      else 'ok'
    end as status
  from public.animals a
  cross join thresholds t
  left join latest_rec lr on lr.animal_id = a.id and lr.record_type = t.record_type
  left join latest_ack la on la.animal_id = a.id and la.record_type = t.record_type
  where a.owner_id = p_owner_id
    and a.archived_at is null;
$$;

revoke all on function public.compute_herd_health(uuid) from public;
grant execute on function public.compute_herd_health(uuid) to service_role;

commit;
