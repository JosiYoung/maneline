-- =============================================================
-- Mane Line — Phase 0 multi-role foundation
-- Migration: 00002_phase0_multirole_foundation.sql
-- Date:      2026-04-16
--
-- What this does (short version):
--   1. Introduces `user_profiles` (role: owner | trainer | silver_lining).
--   2. Introduces `animals` as the species-polymorphic successor to `horses`.
--      Backfills existing horses into animals with species='horse'.
--      `horses` stays in place (deprecated) for Phase 1 rollback safety.
--   3. Introduces `ranches`, `animal_access_grants`, `trainer_profiles`,
--      `trainer_applications` per MANELINE-PRODUCT-FEATURE-MAP §2.2 + §4.2.
--   4. Adds helper functions for RLS: get_my_role, am_i_owner_of,
--      do_i_have_access_to_animal, is_silver_lining_admin.
--   5. Enables RLS on every new table with explicit policies.
--   6. Replaces `handle_new_user()` with a role-aware version that
--      dual-writes the first horse to both `horses` (deprecated) and
--      `animals` (canonical), so Phase 0 §6.1 bullet 6 is satisfied.
--
-- Compliance:
--   - OAG_ARCHITECTURE_LAWS §7 — RLS enabled on every new table with a
--     policy defined day one.
--   - OAG_ARCHITECTURE_LAWS §8 — no hard deletes; soft-archive via
--     `revoked_at` (grants) and `status='archived'` (user_profiles,
--     trainer_applications).
--   - Safe to re-run: `if not exists`, `drop policy if exists`,
--     `create or replace function`, idempotent backfill.
--
-- REVISIT BEFORE PHASE 5:
--   The `silver_lining` admin SELECT/UPDATE policies below grant
--   read-all (and limited update) at the RLS layer. Per
--   MANELINE-PRODUCT-FEATURE-MAP §4.3 and OAG_ARCHITECTURE_LAWS Law 2,
--   admin access should be routed through service-role calls from a
--   Cloudflare Worker endpoint that logs every access to `audit_log`,
--   NOT granted via a blanket RLS policy. These policies are a
--   pragmatic Phase 0 shortcut so the admin portal has something to
--   render on day one. Before Phase 5 (Admin Portal ship), either
--   (a) replace them with a service-role Worker path + audit logging,
--   or (b) keep them and add a SECURITY DEFINER audit trigger that
--   logs every SELECT by a silver_lining user.
-- =============================================================


-- =============================================================
-- 1) user_profiles
--    One row per authenticated human, carrying role + display_name
--    + moderation status. `profiles` stays untouched for backward
--    compat with the existing waitlist form.
-- =============================================================
create table if not exists public.user_profiles (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null unique references auth.users(id) on delete cascade,
  role          text not null check (role in ('owner','trainer','silver_lining')),
  display_name  text not null,
  email         text not null,
  status        text not null default 'active'
                check (status in ('active','pending_review','suspended','archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists user_profiles_user_id_idx on public.user_profiles(user_id);
create index if not exists user_profiles_role_idx    on public.user_profiles(role);
create index if not exists user_profiles_status_idx  on public.user_profiles(status);


-- =============================================================
-- 2) animals — species-polymorphic successor to `horses`.
--    `horses` is NOT dropped here. It remains in place, still
--    written to by the updated handle_new_user() trigger for
--    Phase 1 rollback safety, and tagged as deprecated below.
-- =============================================================
create table if not exists public.animals (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  species     text not null default 'horse' check (species in ('horse','dog')),
  barn_name   text not null,
  breed       text,
  -- Broadened from the horses-only check so dog rows remain insertable
  -- in Phase 1 without another constraint migration. NULL still allowed.
  sex         text check (sex is null or sex in ('mare','gelding','stallion','male','female')),
  year_born   integer,
  discipline  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists animals_owner_idx   on public.animals(owner_id);
create index if not exists animals_species_idx on public.animals(species);

-- Idempotent backfill — preserves original horses.id so any later
-- reference migration is a no-op.
insert into public.animals (id, owner_id, species, barn_name, breed, sex, year_born, discipline, created_at, updated_at)
select h.id, h.owner_id, 'horse', h.barn_name, h.breed, h.sex, h.year_born, h.discipline, h.created_at, h.updated_at
from public.horses h
where not exists (select 1 from public.animals a where a.id = h.id);

-- deprecated, will be dropped in Phase 1 after verification
comment on table public.horses is
  'DEPRECATED (Phase 0): superseded by public.animals. Kept for rollback safety; handle_new_user() still dual-writes here. Will be dropped in Phase 1 after verification.';


-- =============================================================
-- 3) ranches — physical location, multi-animal grouping.
-- =============================================================
create table if not exists public.ranches (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  name        text not null,
  address     text,
  city        text,
  state       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ranches_owner_idx on public.ranches(owner_id);


-- =============================================================
-- 4) animal_access_grants — the consent model (§2.2).
--    Owner grants a trainer access to a single animal, a whole
--    ranch, or every animal the owner has (owner_all).
--    Revocation sets revoked_at + grace_period_ends_at so the
--    trainer retains read-only access until the grace expires.
-- =============================================================
create table if not exists public.animal_access_grants (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references public.profiles(id) on delete cascade,
  trainer_id            uuid not null references public.profiles(id) on delete cascade,
  scope                 text not null check (scope in ('animal','ranch','owner_all')),
  animal_id             uuid references public.animals(id) on delete cascade,
  ranch_id              uuid references public.ranches(id) on delete cascade,
  granted_at            timestamptz not null default now(),
  revoked_at            timestamptz,
  grace_period_ends_at  timestamptz,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint grants_scope_target_check check (
    (scope = 'animal'    and animal_id is not null)
    or (scope = 'ranch'     and ranch_id  is not null)
    or (scope = 'owner_all' and animal_id is null and ranch_id is null)
  )
);

create index if not exists grants_owner_idx        on public.animal_access_grants(owner_id);
create index if not exists grants_trainer_idx      on public.animal_access_grants(trainer_id);
create index if not exists grants_animal_idx       on public.animal_access_grants(animal_id)
  where animal_id is not null;
create index if not exists grants_ranch_idx        on public.animal_access_grants(ranch_id)
  where ranch_id is not null;
create index if not exists grants_active_idx       on public.animal_access_grants(trainer_id)
  where revoked_at is null;


-- =============================================================
-- 5) trainer_profiles — white-label + Stripe Connect identity.
-- =============================================================
create table if not exists public.trainer_profiles (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users(id) on delete cascade,
  logo_url           text,
  brand_hex          text,
  bio                text,
  certifications     jsonb not null default '[]'::jsonb,
  stripe_connect_id  text,
  application_status text not null default 'submitted'
                     check (application_status in ('submitted','approved','rejected','suspended')),
  reviewed_by        uuid references auth.users(id),
  reviewed_at        timestamptz,
  review_notes       text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists trainer_profiles_user_idx   on public.trainer_profiles(user_id);
create index if not exists trainer_profiles_status_idx on public.trainer_profiles(application_status);


-- =============================================================
-- 6) trainer_applications — application payload + audit trail.
--    We keep trainer_profiles.application_status as the live
--    state; trainer_applications is the immutable submission
--    record that can have multiple rows over time (re-apply).
-- =============================================================
create table if not exists public.trainer_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  submitted_at  timestamptz not null default now(),
  application   jsonb not null default '{}'::jsonb,
  status        text not null default 'submitted'
                check (status in ('submitted','approved','rejected','withdrawn','archived')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists trainer_applications_user_idx   on public.trainer_applications(user_id);
create index if not exists trainer_applications_status_idx on public.trainer_applications(status);


-- =============================================================
-- 7) Helper functions (STABLE, SECURITY DEFINER).
--    SECURITY DEFINER lets these bypass RLS on the tables they
--    read, which is required so they can be safely called from
--    RLS policies without causing recursion.
-- =============================================================

create or replace function public.get_my_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role
  from public.user_profiles
  where user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_silver_lining_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.user_profiles
    where user_id = auth.uid()
      and role = 'silver_lining'
      and status = 'active'
  );
$$;

create or replace function public.am_i_owner_of(animal_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then return false; end if;
  return exists (
    select 1
    from public.animals a
    where a.id = am_i_owner_of.animal_id
      and a.owner_id = auth.uid()
  );
end;
$$;

create or replace function public.do_i_have_access_to_animal(animal_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then return false; end if;

  -- Owner always has access
  select a.owner_id into v_owner
  from public.animals a
  where a.id = do_i_have_access_to_animal.animal_id;

  if v_owner is null then return false; end if;
  if v_owner = v_uid  then return true;  end if;

  -- Silver Lining admins always have access (see REVISIT note at top)
  if public.is_silver_lining_admin() then return true; end if;

  -- Trainer with an active grant (or within the read-only grace period)
  --   NOTE: scope='ranch' is not checkable here until animals.ranch_id
  --   exists. Phase 1 adds that column and extends this clause.
  return exists (
    select 1
    from public.animal_access_grants g
    where g.trainer_id = v_uid
      and (
           (g.scope = 'animal'    and g.animal_id = do_i_have_access_to_animal.animal_id)
        or (g.scope = 'owner_all' and g.owner_id  = v_owner)
      )
      and (
           g.revoked_at is null
        or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now())
      )
  );
end;
$$;


-- =============================================================
-- 8) Enable RLS + policies.
-- =============================================================
alter table public.user_profiles         enable row level security;
alter table public.animals               enable row level security;
alter table public.ranches               enable row level security;
alter table public.animal_access_grants  enable row level security;
alter table public.trainer_profiles      enable row level security;
alter table public.trainer_applications  enable row level security;

-- -------------------------------------------------------------
-- user_profiles
-- -------------------------------------------------------------
drop policy if exists "user_profiles_select_own"           on public.user_profiles;
drop policy if exists "user_profiles_update_own"           on public.user_profiles;
drop policy if exists "user_profiles_select_silver_lining" on public.user_profiles;

create policy "user_profiles_select_own" on public.user_profiles
  for select using (user_id = auth.uid());

create policy "user_profiles_update_own" on public.user_profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- REVISIT before Phase 5 — see header note.
create policy "user_profiles_select_silver_lining" on public.user_profiles
  for select using (public.is_silver_lining_admin());

-- INSERT is handled by the handle_new_user() trigger (SECURITY DEFINER).

-- -------------------------------------------------------------
-- animals
-- -------------------------------------------------------------
drop policy if exists "animals_owner_all"                on public.animals;
drop policy if exists "animals_access_select"            on public.animals;
drop policy if exists "animals_silver_lining_select"     on public.animals;

-- Owners: full CRUD on their own rows.
create policy "animals_owner_all" on public.animals
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Anyone with access (owner, granted trainer, or admin) can SELECT.
-- The helper function already encodes owner + admin + grant logic.
create policy "animals_access_select" on public.animals
  for select using (public.do_i_have_access_to_animal(id));

-- -------------------------------------------------------------
-- ranches
-- -------------------------------------------------------------
drop policy if exists "ranches_owner_all"             on public.ranches;
drop policy if exists "ranches_trainer_select"        on public.ranches;
drop policy if exists "ranches_silver_lining_select"  on public.ranches;

create policy "ranches_owner_all" on public.ranches
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "ranches_trainer_select" on public.ranches
  for select using (
    exists (
      select 1
      from public.animal_access_grants g
      where g.trainer_id = auth.uid()
        and (
             g.revoked_at is null
          or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now())
        )
        and (
             (g.scope = 'ranch'     and g.ranch_id = ranches.id)
          or (g.scope = 'owner_all' and g.owner_id = ranches.owner_id)
        )
    )
  );

-- REVISIT before Phase 5 — see header note.
create policy "ranches_silver_lining_select" on public.ranches
  for select using (public.is_silver_lining_admin());

-- -------------------------------------------------------------
-- animal_access_grants
-- -------------------------------------------------------------
drop policy if exists "grants_owner_all"             on public.animal_access_grants;
drop policy if exists "grants_trainer_select"        on public.animal_access_grants;
drop policy if exists "grants_silver_lining_select"  on public.animal_access_grants;

-- Owner fully manages grants they own.
-- (No hard deletes in the app layer — the app sets revoked_at +
-- grace_period_ends_at instead. DELETE is permitted at the DB
-- level for admin cleanup but should not be used from clients.)
create policy "grants_owner_all" on public.animal_access_grants
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "grants_trainer_select" on public.animal_access_grants
  for select using (trainer_id = auth.uid());

-- REVISIT before Phase 5 — see header note.
create policy "grants_silver_lining_select" on public.animal_access_grants
  for select using (public.is_silver_lining_admin());

-- -------------------------------------------------------------
-- trainer_profiles
-- -------------------------------------------------------------
drop policy if exists "trainer_profiles_select_own"            on public.trainer_profiles;
drop policy if exists "trainer_profiles_update_own"            on public.trainer_profiles;
drop policy if exists "trainer_profiles_silver_lining_select"  on public.trainer_profiles;
drop policy if exists "trainer_profiles_silver_lining_update"  on public.trainer_profiles;

create policy "trainer_profiles_select_own" on public.trainer_profiles
  for select using (user_id = auth.uid());

create policy "trainer_profiles_update_own" on public.trainer_profiles
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Vetting queue: admin reads and writes review fields.
-- REVISIT before Phase 5 — see header note.
create policy "trainer_profiles_silver_lining_select" on public.trainer_profiles
  for select using (public.is_silver_lining_admin());

create policy "trainer_profiles_silver_lining_update" on public.trainer_profiles
  for update using (public.is_silver_lining_admin())
  with check (public.is_silver_lining_admin());

-- INSERT is handled by the handle_new_user() trigger (SECURITY DEFINER).

-- -------------------------------------------------------------
-- trainer_applications
-- -------------------------------------------------------------
drop policy if exists "trainer_apps_insert_own"            on public.trainer_applications;
drop policy if exists "trainer_apps_select_own"            on public.trainer_applications;
drop policy if exists "trainer_apps_silver_lining_select"  on public.trainer_applications;
drop policy if exists "trainer_apps_silver_lining_update"  on public.trainer_applications;

create policy "trainer_apps_insert_own" on public.trainer_applications
  for insert with check (user_id = auth.uid());

create policy "trainer_apps_select_own" on public.trainer_applications
  for select using (user_id = auth.uid());

-- REVISIT before Phase 5 — see header note.
create policy "trainer_apps_silver_lining_select" on public.trainer_applications
  for select using (public.is_silver_lining_admin());

create policy "trainer_apps_silver_lining_update" on public.trainer_applications
  for update using (public.is_silver_lining_admin())
  with check (public.is_silver_lining_admin());


-- =============================================================
-- 9) updated_at triggers on every new table
--    (reuses the existing public.touch_updated_at() function).
-- =============================================================
drop trigger if exists trg_user_profiles_touch        on public.user_profiles;
create trigger trg_user_profiles_touch
  before update on public.user_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_animals_touch              on public.animals;
create trigger trg_animals_touch
  before update on public.animals
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_ranches_touch              on public.ranches;
create trigger trg_ranches_touch
  before update on public.ranches
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_grants_touch               on public.animal_access_grants;
create trigger trg_grants_touch
  before update on public.animal_access_grants
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_trainer_profiles_touch     on public.trainer_profiles;
create trigger trg_trainer_profiles_touch
  before update on public.trainer_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_trainer_applications_touch on public.trainer_applications;
create trigger trg_trainer_applications_touch
  before update on public.trainer_applications
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 10) Replace handle_new_user() with the role-aware version.
--
--     Behaviour:
--       - Always upserts public.profiles  (legacy, backward compat)
--       - Always upserts public.user_profiles with role + status
--           role         := meta.role   (default 'owner')
--           display_name := meta.display_name || meta.full_name || email local-part
--           status       := 'pending_review' if role='trainer' else 'active'
--       - If meta.first_horse.barn_name present:
--           dual-writes to public.horses AND public.animals (species='horse')
--       - If role='trainer':
--           creates public.trainer_profiles (application_status='submitted')
--           creates public.trainer_applications row
--
--     Trigger registration (drop+recreate) happens after the function
--     body so the function redefinition cannot leave the DB in a
--     half-updated state.
-- =============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_horse         jsonb;
  v_role          text;
  v_display_name  text;
  v_user_status   text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'owner');

  -- Guard the CHECK constraint — if a bad metadata value slips through
  -- (e.g., a legacy signup), fall back to 'owner' rather than failing
  -- auth creation outright.
  if v_role not in ('owner','trainer','silver_lining') then
    v_role := 'owner';
  end if;

  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'),    ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'rider'
  );

  v_user_status := case when v_role = 'trainer' then 'pending_review' else 'active' end;

  -- Legacy profiles row (existing waitlist form still uses these fields).
  insert into public.profiles (id, email, full_name, phone, location, discipline)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'phone',
    new.raw_user_meta_data->>'location',
    new.raw_user_meta_data->>'owner_discipline'
  )
  on conflict (id) do nothing;

  -- Canonical role-bearing row.
  insert into public.user_profiles (user_id, role, display_name, email, status)
  values (new.id, v_role, v_display_name, new.email, v_user_status)
  on conflict (user_id) do nothing;

  -- First-horse payload — dual-write to horses (deprecated) + animals (canonical).
  v_horse := new.raw_user_meta_data->'first_horse';
  if v_horse is not null and coalesce(v_horse->>'barn_name','') <> '' then
    insert into public.horses (owner_id, barn_name, breed, sex, year_born, discipline)
    values (
      new.id,
      v_horse->>'barn_name',
      v_horse->>'breed',
      v_horse->>'sex',
      nullif(v_horse->>'year_born','')::integer,
      v_horse->>'discipline'
    );

    insert into public.animals (owner_id, species, barn_name, breed, sex, year_born, discipline)
    values (
      new.id,
      'horse',
      v_horse->>'barn_name',
      v_horse->>'breed',
      v_horse->>'sex',
      nullif(v_horse->>'year_born','')::integer,
      v_horse->>'discipline'
    );
  end if;

  -- Trainer seeding — profile stub + immutable application record.
  if v_role = 'trainer' then
    insert into public.trainer_profiles (user_id, bio, application_status)
    values (
      new.id,
      new.raw_user_meta_data->>'bio',
      'submitted'
    )
    on conflict (user_id) do nothing;

    insert into public.trainer_applications (user_id, submitted_at, application, status)
    values (
      new.id,
      now(),
      coalesce(new.raw_user_meta_data->'trainer_application', '{}'::jsonb),
      'submitted'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================
-- End of 00002_phase0_multirole_foundation.sql
--
-- Post-apply verification (run in SQL Editor):
--
--   -- 1. All six new tables exist with RLS on and >=1 policy:
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policies p where p.tablename = c.relname) as policies
--   from pg_class c join pg_namespace n on c.relnamespace = n.oid
--   where n.nspname = 'public'
--     and c.relkind = 'r'
--     and c.relname in ('user_profiles','animals','ranches',
--                       'animal_access_grants','trainer_profiles',
--                       'trainer_applications')
--   order by c.relname;
--
--   -- 2. Backfill verified:
--   select (select count(*) from public.horses) as horses,
--          (select count(*) from public.animals where species='horse') as animals_horse;
--   -- Expect: equal counts.
--
--   -- 3. Helper functions exist:
--   select proname from pg_proc where proname in
--     ('get_my_role','am_i_owner_of','do_i_have_access_to_animal','is_silver_lining_admin');
--
--   -- 4. Trigger live:
--   select tgname from pg_trigger where tgname = 'on_auth_user_created';
-- =============================================================
