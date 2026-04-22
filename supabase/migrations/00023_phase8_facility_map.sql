-- =============================================================
-- Phase 8 Module 03 — Facility / Boarding Map
-- Migration: 00023_phase8_facility_map.sql
--
-- (Module 03 was originally slated to extend 00020, but 00020 is
-- already applied; we ship 00023 as a sibling migration instead.)
--
-- Lands 5 new tables:
--   stalls, stall_assignments, turnout_groups,
--   turnout_group_members, care_matrix_entries
-- All owner-scoped via ranches.owner_id join. RLS day one.
-- Writes go through the Worker (service_role) for atomicity.
-- Archive-never-delete: assignment/membership/entries carry their
-- own archive marker (unassigned_at / left_at / archived_at).
-- =============================================================

begin;

-- 1) stalls
create table if not exists public.stalls (
  id            uuid primary key default gen_random_uuid(),
  ranch_id      uuid not null references public.ranches(id) on delete cascade,
  label         text not null check (char_length(label) between 1 and 60),
  position_row  int,
  position_col  int,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create unique index if not exists stalls_ranch_label_uniq
  on public.stalls(ranch_id, lower(label))
  where archived_at is null;
create index if not exists stalls_ranch_idx
  on public.stalls(ranch_id)
  where archived_at is null;

alter table public.stalls enable row level security;
drop policy if exists "stalls_owner_select" on public.stalls;
create policy "stalls_owner_select" on public.stalls
  for select using (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "stalls_owner_insert" on public.stalls;
create policy "stalls_owner_insert" on public.stalls
  for insert with check (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "stalls_owner_update" on public.stalls;
create policy "stalls_owner_update" on public.stalls
  for update using (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  );
revoke delete on public.stalls from anon, authenticated;

drop trigger if exists stalls_touch_updated_at on public.stalls;
create trigger stalls_touch_updated_at
  before update on public.stalls
  for each row execute procedure public.touch_updated_at();

-- 2) stall_assignments
create table if not exists public.stall_assignments (
  id              uuid primary key default gen_random_uuid(),
  stall_id        uuid not null references public.stalls(id) on delete cascade,
  animal_id       uuid not null references public.animals(id) on delete cascade,
  assigned_at     timestamptz not null default now(),
  unassigned_at   timestamptz,
  assigned_by     uuid references auth.users(id),
  notes           text check (notes is null or char_length(notes) <= 500),
  created_at      timestamptz not null default now()
);
create unique index if not exists stall_assignments_stall_active_uniq
  on public.stall_assignments(stall_id)
  where unassigned_at is null;
create unique index if not exists stall_assignments_animal_active_uniq
  on public.stall_assignments(animal_id)
  where unassigned_at is null;
create index if not exists stall_assignments_stall_time_idx
  on public.stall_assignments(stall_id, assigned_at desc);
create index if not exists stall_assignments_animal_time_idx
  on public.stall_assignments(animal_id, assigned_at desc);

alter table public.stall_assignments enable row level security;
drop policy if exists "stall_assignments_owner_select" on public.stall_assignments;
create policy "stall_assignments_owner_select" on public.stall_assignments
  for select using (
    exists (
      select 1 from public.stalls s join public.ranches r on r.id = s.ranch_id
      where s.id = stall_assignments.stall_id and r.owner_id = auth.uid()
    )
  );
revoke insert, update, delete on public.stall_assignments from anon, authenticated;

-- 3) turnout_groups
create table if not exists public.turnout_groups (
  id            uuid primary key default gen_random_uuid(),
  ranch_id      uuid not null references public.ranches(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  color_hex     text check (color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$'),
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);
create unique index if not exists turnout_groups_ranch_name_uniq
  on public.turnout_groups(ranch_id, lower(name))
  where archived_at is null;
create index if not exists turnout_groups_ranch_idx
  on public.turnout_groups(ranch_id)
  where archived_at is null;

alter table public.turnout_groups enable row level security;
drop policy if exists "turnout_groups_owner_select" on public.turnout_groups;
create policy "turnout_groups_owner_select" on public.turnout_groups
  for select using (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "turnout_groups_owner_insert" on public.turnout_groups;
create policy "turnout_groups_owner_insert" on public.turnout_groups
  for insert with check (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "turnout_groups_owner_update" on public.turnout_groups;
create policy "turnout_groups_owner_update" on public.turnout_groups
  for update using (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  );
revoke delete on public.turnout_groups from anon, authenticated;

drop trigger if exists turnout_groups_touch_updated_at on public.turnout_groups;
create trigger turnout_groups_touch_updated_at
  before update on public.turnout_groups
  for each row execute procedure public.touch_updated_at();

-- 4) turnout_group_members
create table if not exists public.turnout_group_members (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.turnout_groups(id) on delete cascade,
  animal_id     uuid not null references public.animals(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  added_by      uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create unique index if not exists turnout_group_members_active_uniq
  on public.turnout_group_members(group_id, animal_id)
  where left_at is null;
create index if not exists turnout_group_members_group_idx
  on public.turnout_group_members(group_id)
  where left_at is null;
create index if not exists turnout_group_members_animal_idx
  on public.turnout_group_members(animal_id)
  where left_at is null;

alter table public.turnout_group_members enable row level security;
drop policy if exists "turnout_group_members_owner_select" on public.turnout_group_members;
create policy "turnout_group_members_owner_select" on public.turnout_group_members
  for select using (
    exists (
      select 1 from public.turnout_groups g join public.ranches r on r.id = g.ranch_id
      where g.id = turnout_group_members.group_id and r.owner_id = auth.uid()
    )
  );
revoke insert, update, delete on public.turnout_group_members from anon, authenticated;

-- 5) care_matrix_entries
create table if not exists public.care_matrix_entries (
  id                  uuid primary key default gen_random_uuid(),
  animal_id           uuid not null references public.animals(id) on delete cascade,
  entry_date          date not null,
  feed_am             boolean not null default false,
  feed_pm             boolean not null default false,
  hay                 boolean not null default false,
  turnout             boolean not null default false,
  blanket             boolean not null default false,
  supplements_given   boolean not null default false,
  meds_given          boolean not null default false,
  notes               text check (notes is null or char_length(notes) <= 1000),
  updated_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  constraint care_matrix_entries_animal_date_uniq unique (animal_id, entry_date)
);
create index if not exists care_matrix_entries_animal_date_idx
  on public.care_matrix_entries(animal_id, entry_date desc)
  where archived_at is null;
create index if not exists care_matrix_entries_date_idx
  on public.care_matrix_entries(entry_date desc)
  where archived_at is null;

alter table public.care_matrix_entries enable row level security;
drop policy if exists "care_matrix_entries_owner_select" on public.care_matrix_entries;
create policy "care_matrix_entries_owner_select" on public.care_matrix_entries
  for select using (
    exists (select 1 from public.animals a where a.id = care_matrix_entries.animal_id and a.owner_id = auth.uid())
  );
revoke insert, update, delete on public.care_matrix_entries from anon, authenticated;

drop trigger if exists care_matrix_entries_touch_updated_at on public.care_matrix_entries;
create trigger care_matrix_entries_touch_updated_at
  before update on public.care_matrix_entries
  for each row execute procedure public.touch_updated_at();

commit;
