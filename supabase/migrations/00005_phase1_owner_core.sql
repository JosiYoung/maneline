-- =============================================================
-- Mane Line — Phase 1 (Owner Portal Core)
-- Migration: 00005_phase1_owner_core.sql
-- Date:      2026-04-17
--
-- Delivers the data model behind the five P0 Owner Portal features
-- (see docs/phase-1-plan.md §0 and MANELINE-PRODUCT-FEATURE-MAP.md §3.1):
--
--   • r2_objects             — ledger of every R2 upload; keeps metadata
--                              separate from the blob so nightly GitHub
--                              backup stays honest (OAG Law 4).
--   • vet_records            — typed documents (coggins, vaccine, …)
--                              pointing at r2_objects rows.
--   • animal_media           — photos / videos per animal, same pattern.
--   • animal_archive_events  — audit of archive / un-archive transitions
--                              on the animals table (OAG Law 8).
--   • animals.archived_at    — soft-archive column (never hard delete).
--
-- Compliance:
--   - OAG_ARCHITECTURE_LAWS §7 (RLS on every table day one).
--   - OAG_ARCHITECTURE_LAWS §8 (no hard deletes — archive timestamps
--     everywhere; events captured as rows, not DELETEs).
--   - Admin access follows the Phase 0 hardening pattern from 00004:
--     no blanket silver_lining SELECT policies; admin reads route
--     through service_role Worker paths that write audit_log rows.
--
-- Safe to re-run: `if not exists`, `drop policy if exists`,
-- `create or replace function`. Idempotent.
-- =============================================================


-- =============================================================
-- 1) animals.archived_at + index
--    Soft-archive column. NULL = active, non-null = archived at
--    that moment. Every SPA query filters `archived_at is null`
--    unless the caller explicitly opts in.
-- =============================================================
alter table public.animals
  add column if not exists archived_at timestamptz;

create index if not exists animals_active_idx
  on public.animals(owner_id)
  where archived_at is null;


-- =============================================================
-- 2) animal_archive_events
--    Append-only audit of every archive / un-archive. Written by
--    the Worker (service_role) after the animals.archived_at UPDATE
--    succeeds. Owners can see their own history; no client writes.
-- =============================================================
create table if not exists public.animal_archive_events (
  id          uuid primary key default gen_random_uuid(),
  animal_id   uuid not null references public.animals(id) on delete cascade,
  actor_id    uuid not null references auth.users(id),
  action      text not null check (action in ('archive','unarchive')),
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists animal_archive_events_animal_idx
  on public.animal_archive_events(animal_id, created_at desc);

alter table public.animal_archive_events enable row level security;

drop policy if exists "archive_events_owner_select" on public.animal_archive_events;
create policy "archive_events_owner_select" on public.animal_archive_events
  for select
  using (
    exists (
      select 1 from public.animals a
      where a.id = animal_archive_events.animal_id
        and a.owner_id = auth.uid()
    )
  );

-- Service-role-only writes. No client INSERT / UPDATE / DELETE.
revoke insert, update, delete on public.animal_archive_events from anon, authenticated;


-- =============================================================
-- 3) r2_objects
--    One row per object ever stored in R2. Written by the Worker
--    AFTER the browser-side PUT to the presigned URL succeeds
--    (see /api/uploads/commit). Clients never write directly.
--
--    object_key convention:  <owner_id>/<kind>/<uuid>.<ext>
-- =============================================================
create table if not exists public.r2_objects (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  bucket        text not null default 'maneline-records',
  object_key    text not null unique,
  kind          text not null check (kind in (
                  'vet_record',
                  'animal_photo',
                  'animal_video',
                  'records_export'
                )),
  content_type  text not null,
  byte_size     bigint not null check (byte_size > 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create index if not exists r2_objects_owner_idx
  on public.r2_objects(owner_id);
create index if not exists r2_objects_owner_kind_idx
  on public.r2_objects(owner_id, kind)
  where deleted_at is null;

alter table public.r2_objects enable row level security;

-- Owners can SELECT and UPDATE (rename caption, soft-delete) their own
-- objects. INSERT is service_role only. Trainers DO NOT read r2_objects
-- directly — they go through the typed vet_records / animal_media tables
-- and the Worker's /api/uploads/read-url endpoint, which re-checks
-- do_i_have_access_to_animal() before issuing a signed GET.
drop policy if exists "r2_objects_owner_select" on public.r2_objects;
create policy "r2_objects_owner_select" on public.r2_objects
  for select using (owner_id = auth.uid());

drop policy if exists "r2_objects_owner_update" on public.r2_objects;
create policy "r2_objects_owner_update" on public.r2_objects
  for update using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

revoke insert, delete on public.r2_objects from anon, authenticated;


-- =============================================================
-- 4) vet_records
--    Typed metadata wrapper over r2_objects. The PDF / image blob
--    lives in R2; this row is what the SPA renders in the Records
--    table and what the 12-month export pulls from.
-- =============================================================
create table if not exists public.vet_records (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null references auth.users(id) on delete cascade,
  animal_id         uuid not null references public.animals(id) on delete cascade,
  r2_object_id      uuid not null references public.r2_objects(id) on delete restrict,
  record_type       text not null check (record_type in (
                      'coggins',
                      'vaccine',
                      'dental',
                      'farrier',
                      'other'
                    )),
  issued_on         date,
  expires_on        date,
  issuing_provider  text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz
);

create index if not exists vet_records_animal_idx
  on public.vet_records(animal_id)
  where archived_at is null;
create index if not exists vet_records_owner_idx
  on public.vet_records(owner_id, created_at desc);
create index if not exists vet_records_expires_idx
  on public.vet_records(expires_on)
  where expires_on is not null and archived_at is null;

alter table public.vet_records enable row level security;

-- Owners CRUD their own vet_records. Trainers SELECT where they have
-- an active grant on the animal (or are inside the grace window).
-- Phase 2 gives trainers a controlled write path via sessions — until
-- then they cannot INSERT / UPDATE vet records.
drop policy if exists "vet_records_owner_all" on public.vet_records;
create policy "vet_records_owner_all" on public.vet_records
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "vet_records_trainer_select" on public.vet_records;
create policy "vet_records_trainer_select" on public.vet_records
  for select using (public.do_i_have_access_to_animal(animal_id));


-- =============================================================
-- 5) animal_media
--    Photos / videos per animal. Same structural pattern as
--    vet_records: one row per object, pointer into r2_objects.
-- =============================================================
create table if not exists public.animal_media (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references auth.users(id) on delete cascade,
  animal_id     uuid not null references public.animals(id) on delete cascade,
  r2_object_id  uuid not null references public.r2_objects(id) on delete restrict,
  kind          text not null check (kind in ('photo','video')),
  caption       text,
  taken_on      date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create index if not exists animal_media_animal_idx
  on public.animal_media(animal_id, created_at desc)
  where archived_at is null;
create index if not exists animal_media_owner_idx
  on public.animal_media(owner_id, created_at desc);

alter table public.animal_media enable row level security;

drop policy if exists "animal_media_owner_all" on public.animal_media;
create policy "animal_media_owner_all" on public.animal_media
  for all using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "animal_media_trainer_select" on public.animal_media;
create policy "animal_media_trainer_select" on public.animal_media
  for select using (public.do_i_have_access_to_animal(animal_id));


-- =============================================================
-- 6) touch_updated_at triggers
--    Reuse the helper established in 00002. Every Phase 1 table
--    that exposes an `updated_at` column gets wired up.
-- =============================================================
drop trigger if exists r2_objects_touch_updated_at       on public.r2_objects;
create trigger        r2_objects_touch_updated_at
  before update on public.r2_objects
  for each row execute function public.touch_updated_at();

drop trigger if exists vet_records_touch_updated_at      on public.vet_records;
create trigger        vet_records_touch_updated_at
  before update on public.vet_records
  for each row execute function public.touch_updated_at();

drop trigger if exists animal_media_touch_updated_at     on public.animal_media;
create trigger        animal_media_touch_updated_at
  before update on public.animal_media
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 7) Helper functions
--    owner_record_count() — aggregate per-owner tally, used by
--    the Silver Lining admin dashboard (Phase 5) and by internal
--    monitors. STABLE + security definer so it can be called by
--    the service_role without RLS interference.
--
--    signed_url_ttl_seconds() — single source of truth for the
--    Worker's presigned URL lifetime. Change here if the TTL is
--    ever revisited; Worker reads it via service_role.
-- =============================================================
create or replace function public.owner_record_count(p_owner_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  select count(*)::int into v_count
  from public.vet_records v
  where v.owner_id = p_owner_id
    and v.archived_at is null;
  return coalesce(v_count, 0);
end;
$$;

revoke execute on function public.owner_record_count(uuid) from anon, authenticated;
grant  execute on function public.owner_record_count(uuid) to   service_role;

create or replace function public.signed_url_ttl_seconds()
returns integer
language sql
stable
as $$
  select 300;
$$;


-- =============================================================
-- 8) Post-apply verification (run in SQL Editor):
--
--   -- a. Every Phase 1 table has RLS enabled:
--   select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on c.relnamespace = n.oid
--   where n.nspname = 'public'
--     and c.relname in ('r2_objects','vet_records','animal_media','animal_archive_events');
--   -- Expect: all 4 rows with relrowsecurity = true.
--
--   -- b. Every Phase 1 table has at least one policy:
--   select tablename, count(*) as policy_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('r2_objects','vet_records','animal_media','animal_archive_events')
--   group by tablename;
--   -- Expect: all 4 present with count >= 1.
--
--   -- c. animals.archived_at exists and animals_active_idx exists:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'animals' and column_name = 'archived_at';
--   select indexname from pg_indexes
--   where schemaname = 'public' and indexname = 'animals_active_idx';
--
--   -- d. Defense in depth — anon/authenticated cannot INSERT r2_objects:
--   select pg_catalog.has_table_privilege('anon',          'public.r2_objects', 'INSERT'),
--          pg_catalog.has_table_privilege('authenticated', 'public.r2_objects', 'INSERT');
--   -- Expect: false, false.
-- =============================================================
