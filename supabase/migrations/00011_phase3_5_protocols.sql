-- =============================================================
-- Mane Line — Phase 3.5 (P0 catch-up): Supplement Protocol Tracker
-- Migration: 00011_phase3_5_protocols.sql
-- Date:      2026-04-17
--
-- Closes the P0 "Supplement protocol tracker (daily log, dose
-- confirm)" gap from MANELINE-PRODUCT-FEATURE-MAP.md §3.1 that
-- Phases 1–3 skipped. Lands BEFORE Phase 4 so the Protocol Brain
-- chatbot has real rows to RAG against via Vectorize.
--
-- Tables created:
--   • protocols              — SLH's numbered SKU playbooks. Service
--                              role writes; authenticated reads.
--   • animal_protocols       — owner assigns a protocol to an animal
--                              with start/end + per-animal dosing.
--   • supplement_doses       — one row per confirmed dose, by owner
--                              or granted trainer.
--
-- Compliance:
--   OAG §2 — `protocols` admin writes are service_role only.
--   OAG §7 — RLS on every table from day one.
--   OAG §8 — soft-archive on protocols + animal_protocols; doses
--            are append-only (no UPDATE / no DELETE).
--
-- Safe to re-run: idempotent creates, drop-if-exists on policies,
-- on-conflict-do-nothing on the seed insert.
-- =============================================================


-- =============================================================
-- 1) protocols
--    Silver Lining's numbered-SKU playbook catalog. The seed set
--    (5 rows) lands at the bottom of this migration. Real content
--    lands before Phase 4 public launch; `associated_sku_placeholder`
--    is swapped for a real `product_id` FK at that point.
-- =============================================================
create table if not exists public.protocols (
  id                            uuid primary key default gen_random_uuid(),
  number                        text,
  name                          text not null check (char_length(name) between 1 and 200),
  description                   text,
  use_case                      text,
  body_md                       text,
  associated_sku_placeholder    text,
  product_id                    uuid references public.products(id),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  archived_at                   timestamptz
);

create unique index if not exists protocols_number_unique
  on public.protocols(number)
  where number is not null and archived_at is null;
create index if not exists protocols_archived_name_idx
  on public.protocols(archived_at, name);

alter table public.protocols enable row level security;

drop policy if exists "protocols_authenticated_select" on public.protocols;
create policy "protocols_authenticated_select" on public.protocols
  for select
  to authenticated
  using (archived_at is null);

revoke all on public.protocols from anon;
revoke insert, update, delete on public.protocols from authenticated;


-- =============================================================
-- 2) animal_protocols
--    Owner-only write surface. Start date is required; end date
--    is nullable while active. Archive-never-delete via
--    archived_at. A single animal can carry multiple concurrent
--    active protocols (e.g., joint + calming).
-- =============================================================
create table if not exists public.animal_protocols (
  id                   uuid primary key default gen_random_uuid(),
  animal_id            uuid not null references public.animals(id) on delete cascade,
  protocol_id          uuid not null references public.protocols(id),
  started_on           date not null,
  ended_on             date,
  dose_instructions    text,
  notes                text,
  created_by           uuid not null references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  archived_at          timestamptz,
  check (ended_on is null or ended_on >= started_on)
);

create index if not exists animal_protocols_animal_active_idx
  on public.animal_protocols(animal_id, started_on desc)
  where archived_at is null;
create index if not exists animal_protocols_animal_open_idx
  on public.animal_protocols(animal_id)
  where archived_at is null and ended_on is null;

alter table public.animal_protocols enable row level security;

-- Owner SELECT: they own the animal.
drop policy if exists "animal_protocols_owner_select" on public.animal_protocols;
create policy "animal_protocols_owner_select" on public.animal_protocols
  for select using (
    exists (
      select 1 from public.animals a
      where a.id = animal_protocols.animal_id
        and a.owner_id = auth.uid()
    )
  );

-- Trainer SELECT: active grant on the animal.
drop policy if exists "animal_protocols_trainer_select" on public.animal_protocols;
create policy "animal_protocols_trainer_select" on public.animal_protocols
  for select using (
    public.do_i_have_access_to_animal(animal_id)
  );

-- Owner INSERT/UPDATE: must own the animal; stamps auth.uid() as creator.
drop policy if exists "animal_protocols_owner_insert" on public.animal_protocols;
create policy "animal_protocols_owner_insert" on public.animal_protocols
  for insert with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.animals a
      where a.id = animal_protocols.animal_id
        and a.owner_id = auth.uid()
    )
  );

drop policy if exists "animal_protocols_owner_update" on public.animal_protocols;
create policy "animal_protocols_owner_update" on public.animal_protocols
  for update
  using (
    exists (
      select 1 from public.animals a
      where a.id = animal_protocols.animal_id
        and a.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.animals a
      where a.id = animal_protocols.animal_id
        and a.owner_id = auth.uid()
    )
  );

revoke delete on public.animal_protocols from anon, authenticated;


-- =============================================================
-- 3) supplement_doses
--    Append-only dose confirmation log. Owner OR granted trainer
--    can INSERT. No UPDATE, no DELETE (corrections via a new row
--    with notes='correction for <id>'). `dosed_on` defaults to
--    today so the Today-view tap is a one-shot insert.
-- =============================================================
create table if not exists public.supplement_doses (
  id                    uuid primary key default gen_random_uuid(),
  animal_protocol_id    uuid not null references public.animal_protocols(id) on delete cascade,
  animal_id             uuid not null references public.animals(id) on delete cascade,
  dosed_on              date not null default current_date,
  dosed_at_time         time,
  confirmed_by          uuid not null references auth.users(id),
  confirmed_role        text not null check (confirmed_role in ('owner','trainer')),
  notes                 text,
  created_at            timestamptz not null default now()
);

create index if not exists supplement_doses_protocol_date_idx
  on public.supplement_doses(animal_protocol_id, dosed_on desc);
create index if not exists supplement_doses_animal_date_idx
  on public.supplement_doses(animal_id, dosed_on desc);

alter table public.supplement_doses enable row level security;

-- Owner SELECT: they own the animal.
drop policy if exists "supplement_doses_owner_select" on public.supplement_doses;
create policy "supplement_doses_owner_select" on public.supplement_doses
  for select using (
    exists (
      select 1 from public.animals a
      where a.id = supplement_doses.animal_id
        and a.owner_id = auth.uid()
    )
  );

-- Trainer SELECT: active grant on the animal.
drop policy if exists "supplement_doses_trainer_select" on public.supplement_doses;
create policy "supplement_doses_trainer_select" on public.supplement_doses
  for select using (
    public.do_i_have_access_to_animal(animal_id)
  );

-- Owner INSERT: owns animal, stamps own uid + role.
drop policy if exists "supplement_doses_owner_insert" on public.supplement_doses;
create policy "supplement_doses_owner_insert" on public.supplement_doses
  for insert with check (
    confirmed_role = 'owner'
    and confirmed_by = auth.uid()
    and exists (
      select 1 from public.animals a
      where a.id = supplement_doses.animal_id
        and a.owner_id = auth.uid()
    )
    and exists (
      select 1 from public.animal_protocols ap
      where ap.id = supplement_doses.animal_protocol_id
        and ap.animal_id = supplement_doses.animal_id
        and ap.archived_at is null
    )
  );

-- Trainer INSERT: has active grant on the animal; stamps role + uid.
drop policy if exists "supplement_doses_trainer_insert" on public.supplement_doses;
create policy "supplement_doses_trainer_insert" on public.supplement_doses
  for insert with check (
    confirmed_role = 'trainer'
    and confirmed_by = auth.uid()
    and public.do_i_have_access_to_animal(animal_id)
    and exists (
      select 1 from public.animal_protocols ap
      where ap.id = supplement_doses.animal_protocol_id
        and ap.animal_id = supplement_doses.animal_id
        and ap.archived_at is null
    )
  );

revoke update, delete on public.supplement_doses from anon, authenticated;


-- =============================================================
-- 4) updated_at triggers (reuse the Phase-0 touch helper)
-- =============================================================
drop trigger if exists protocols_touch on public.protocols;
create trigger protocols_touch before update on public.protocols
  for each row execute function public.touch_updated_at();

drop trigger if exists animal_protocols_touch on public.animal_protocols;
create trigger animal_protocols_touch before update on public.animal_protocols
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 5) Seed placeholder catalog
--    Matches supabase/seeds/protocols.sql so a fresh reset and a
--    migration apply produce the same 5 rows. Real SLH content
--    replaces these before Phase 4 public launch — the
--    `associated_sku_placeholder` column is the flag for "not yet
--    tied to a live product_id".
-- =============================================================
insert into public.protocols (number, name, description, use_case, associated_sku_placeholder)
values
  ('#10', 'Joint Support',       'Joint health for performance horses',  'Supports mobility and joint integrity in active performance horses',    'placeholder'),
  ('#17', 'Colic Eaz',           'Digestive emergency support',          'Immediate digestive comfort during colic episodes',                     'placeholder'),
  ('#33', 'Calming Care',        'Behavior / calm for show nerves',      'Reduces anxiety and promotes focus for show and transport',              'placeholder'),
  (null,  'Mare Moods',          'Hormone support for mares',            'Balances hormonal cycles to improve temperament and comfort',            'placeholder'),
  (null,  'Bug Control Bundle',  'Seasonal fly + pest defense',          'Seasonal protection against flies, ticks, and common pests',             'placeholder')
on conflict do nothing;
