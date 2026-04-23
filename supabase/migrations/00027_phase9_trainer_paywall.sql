-- =============================================================
-- Phase 9 Module 01 — Trainer paywall + 5-horse cap bump
-- Migration: 00027_phase9_trainer_paywall.sql
--
-- Changes:
--   1) Bump free-tier horse cap on owners from 3 → 5.
--   2) Add `role_scope` to subscriptions so a dual-role user can
--      hold one owner sub + one trainer sub concurrently. Existing
--      rows default to 'owner' — zero backfill needed (no users in
--      prod per Phase 9 decisions).
--   3) Expand tier check to include 'trainer_pro'. Part-time trainers
--      are tracked by the ABSENCE of a trainer_pro row (≤5 distinct
--      client horses → free). No explicit part-time row.
--   4) Add helper fns: trainer_distinct_horse_count + trainer_has_pro.
--   5) Add BEFORE INSERT trigger on animal_access_grants that blocks
--      when the target trainer would cross 5 distinct horses and
--      has no active trainer_pro sub. Raises `trainer_pro_required`
--      (matches the Worker 402 error code + SPA error parser).
--
-- Compliance:
--   OAG §2 — service-role writes only; triggers are SECURITY DEFINER.
--   OAG §7 — RLS unchanged (no new tables).
--   OAG §8 — archive-never-delete preserved.
-- =============================================================

begin;

-- 1) Bump owner horse cap 3 → 5 by recreating the trigger fn.
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
  where owner_id = NEW.owner_id
    and archived_at is null;

  select exists (
    select 1
    from public.subscriptions s
    where s.owner_id = NEW.owner_id
      and coalesce(s.role_scope, 'owner') = 'owner'
      and s.archived_at is null
      and s.status in ('active','trialing')
      and (
        s.tier = 'barn_mode'
        or (s.comp_source is not null
            and (s.comp_expires_at is null or s.comp_expires_at > now()))
      )
  ) into v_on_barn_mode;

  if v_count >= 5 and not v_on_barn_mode then
    raise exception 'barn_mode_required: owner % has % horses and no Barn Mode subscription',
      NEW.owner_id, v_count
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

-- 2) subscriptions.role_scope + new unique index.
alter table public.subscriptions
  add column if not exists role_scope text not null default 'owner'
    check (role_scope in ('owner','trainer'));

drop index if exists subscriptions_owner_active_uniq;
create unique index if not exists subscriptions_owner_role_active_uniq
  on public.subscriptions(owner_id, role_scope)
  where archived_at is null;

-- 3) Expand tier check.
alter table public.subscriptions
  drop constraint if exists subscriptions_tier_check;
alter table public.subscriptions
  add constraint subscriptions_tier_check
  check (tier in ('free','barn_mode','trainer_pro'));

-- Cross-field sanity: trainer_pro rows must be role_scope='trainer';
-- barn_mode rows must be role_scope='owner'. 'free' is role-agnostic.
alter table public.subscriptions
  drop constraint if exists subscriptions_tier_scope_check;
alter table public.subscriptions
  add constraint subscriptions_tier_scope_check
  check (
    (tier = 'barn_mode'   and role_scope = 'owner')   or
    (tier = 'trainer_pro' and role_scope = 'trainer') or
    (tier = 'free')
  );


-- 4) Helper: count DISTINCT horses a trainer has access to across all
-- active (non-revoked-or-in-grace) grants. Covers scope=animal and
-- scope=owner_all (every non-archived animal the owner has).
-- NB: scope='ranch' is not included — animals.ranch_id does not yet
-- exist (see migration 00002 comment), and the UI doesn't expose
-- ranch-scope grants. Add a branch here when that column lands.
create or replace function public.trainer_distinct_horse_count(p_trainer_id uuid)
returns int
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select count(distinct a.id)::int
  from public.animals a
  where a.archived_at is null
    and exists (
      select 1
      from public.animal_access_grants g
      where g.trainer_id = p_trainer_id
        and (
              g.revoked_at is null
              or (g.grace_period_ends_at is not null
                  and g.grace_period_ends_at > now())
            )
        and (
              (g.scope = 'animal'    and g.animal_id = a.id)
           or (g.scope = 'owner_all' and g.owner_id  = a.owner_id)
        )
    );
$$;

-- Helper: does this trainer hold an active Trainer Pro sub?
create or replace function public.trainer_has_pro(p_trainer_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1
    from public.subscriptions s
    where s.owner_id    = p_trainer_id
      and s.role_scope  = 'trainer'
      and s.tier        = 'trainer_pro'
      and s.archived_at is null
      and s.status in ('active','trialing')
  );
$$;


-- 5) Trainer horse-cap trigger on animal_access_grants INSERT.
create or replace function public.enforce_trainer_grant_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  if TG_OP <> 'INSERT' then
    return NEW;
  end if;

  -- Pro trainers bypass the cap.
  if public.trainer_has_pro(NEW.trainer_id) then
    return NEW;
  end if;

  -- Counting BEFORE the insert — the new grant hasn't landed yet.
  v_count := public.trainer_distinct_horse_count(NEW.trainer_id);

  -- If the new grant is scope='animal' and that specific animal is
  -- already covered (e.g. via an existing owner_all grant from the
  -- same owner), the distinct count won't change — let it through.
  if NEW.scope = 'animal' and NEW.animal_id is not null then
    if exists (
      select 1
      from public.animal_access_grants g
      where g.trainer_id = NEW.trainer_id
        and (
              g.revoked_at is null
              or (g.grace_period_ends_at is not null
                  and g.grace_period_ends_at > now())
            )
        and (
              (g.scope = 'animal'    and g.animal_id = NEW.animal_id)
           or (g.scope = 'owner_all' and g.owner_id  = NEW.owner_id)
        )
    ) then
      return NEW;
    end if;
  end if;

  if v_count >= 5 then
    raise exception 'trainer_pro_required: trainer % has % horses and no Trainer Pro subscription',
      NEW.trainer_id, v_count
      using errcode = 'P0001';
  end if;

  return NEW;
end;
$$;

drop trigger if exists grants_enforce_trainer_limit on public.animal_access_grants;
create trigger grants_enforce_trainer_limit
  before insert on public.animal_access_grants
  for each row execute function public.enforce_trainer_grant_limit();

commit;
