-- =============================================================
-- Mane Line — Phase 4 (Protocol Brain — Workers AI + Vectorize)
-- Migration: 00012_phase4_protocol_brain.sql
-- Date:      2026-04-19
--
-- Reference: docs/phase-4-plan.md §4.1.
--
-- NOTE (drift reconciliation). When this migration was authored
-- the deployed DB had an ad-hoc `protocols` table (bigint id, no
-- archived_at, no body_md, no product_id) from an earlier
-- 20260417004128_create_protocols_table migration that was never
-- represented in the repo. Migration 00011_phase3_5_protocols.sql
-- in the repo was written on top of that drift but never applied
-- — so `animal_protocols` and `supplement_doses` don't exist in
-- the live DB either. This migration brings the deployed DB back
-- in sync with the repo and layers Phase 4 on top: it drops the
-- ad-hoc `protocols` table (5 demo rows lost — easily re-seeded
-- below), recreates it in the 00011 shape, creates the two Phase
-- 3.5 tables that never shipped, then extends protocols + adds
-- the Phase 4 tables.
--
-- What this migration does (in order):
--   1) Drop the ad-hoc public.protocols (cascade).
--   2) Recreate protocols in 00011 shape + Phase 4 columns in a
--      single CREATE — category, keywords, linked_sku_codes,
--      published, embed_status, embed_synced_at.
--   3) Recreate animal_protocols + supplement_doses from 00011.
--   4) Add animals.vet_phone.
--   5) Create conversations + chatbot_runs (Phase 4 audit).
--   6) Create seed_run_log (Phase 4 seed pipeline forensics).
--   7) ALTER orders.source CHECK to allow 'chat'.
--   8) Re-seed the 5 placeholder protocols rows so dev demos
--      continue to work.
--
-- Compliance:
--   OAG §2 — service_role-only writes on protocols, conversations,
--            chatbot_runs, seed_run_log.
--   OAG §7 — RLS on every table from the first CREATE.
--   OAG §8 — chatbot_runs + supplement_doses + seed_run_log are
--            INSERT-only; protocols + animal_protocols + conversations
--            soft-archive via archived_at.
--
-- Safe to re-run: `drop table if exists`, `create table if not
-- exists`, `drop policy if exists`, `on conflict do nothing`. A
-- second run after the first succeeds is a no-op.
-- =============================================================


-- =============================================================
-- 1) Drop the ad-hoc pre-3.5 protocols table
--    Nothing else FKs to it in the live DB (verified via
--    information_schema during the drift audit).
-- =============================================================
drop table if exists public.protocols cascade;


-- =============================================================
-- 2) protocols
--    Base shape inherited from 00011 phase 3.5 + Phase 4 columns
--    folded in directly (category, keywords, linked_sku_codes,
--    published, embed_status, embed_synced_at). One CREATE keeps
--    the deployed DB honest about the current schema.
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
  category                      text,
  keywords                      text[] not null default '{}',
  linked_sku_codes              text[] not null default '{}',
  published                     boolean not null default true,
  embed_status                  text not null default 'pending'
                                  check (embed_status in ('pending','synced','failed')),
  embed_synced_at               timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  archived_at                   timestamptz
);

create unique index if not exists protocols_number_unique
  on public.protocols(number)
  where number is not null and archived_at is null;
create index if not exists protocols_archived_name_idx
  on public.protocols(archived_at, name);
create index if not exists protocols_embed_pending_idx
  on public.protocols(updated_at)
  where embed_status = 'pending' and archived_at is null;
create index if not exists protocols_published_idx
  on public.protocols(number)
  where published = true and archived_at is null;

alter table public.protocols enable row level security;

drop policy if exists "protocols_authenticated_select" on public.protocols;
create policy "protocols_authenticated_select" on public.protocols
  for select
  to authenticated
  using (archived_at is null);

revoke all on public.protocols from anon;
revoke insert, update, delete on public.protocols from authenticated;

drop trigger if exists protocols_touch on public.protocols;
create trigger protocols_touch before update on public.protocols
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 3) animal_protocols (Phase 3.5 catch-up)
--    Owner-only write surface. Start required, end nullable.
--    Archive-never-delete via archived_at.
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

drop policy if exists "animal_protocols_owner_select" on public.animal_protocols;
create policy "animal_protocols_owner_select" on public.animal_protocols
  for select using (
    exists (
      select 1 from public.animals a
      where a.id = animal_protocols.animal_id
        and a.owner_id = auth.uid()
    )
  );

drop policy if exists "animal_protocols_trainer_select" on public.animal_protocols;
create policy "animal_protocols_trainer_select" on public.animal_protocols
  for select using (
    public.do_i_have_access_to_animal(animal_id)
  );

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

drop trigger if exists animal_protocols_touch on public.animal_protocols;
create trigger animal_protocols_touch before update on public.animal_protocols
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 4) supplement_doses (Phase 3.5 catch-up)
--    Append-only dose confirmation log.
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

drop policy if exists "supplement_doses_owner_select" on public.supplement_doses;
create policy "supplement_doses_owner_select" on public.supplement_doses
  for select using (
    exists (
      select 1 from public.animals a
      where a.id = supplement_doses.animal_id
        and a.owner_id = auth.uid()
    )
  );

drop policy if exists "supplement_doses_trainer_select" on public.supplement_doses;
create policy "supplement_doses_trainer_select" on public.supplement_doses
  for select using (
    public.do_i_have_access_to_animal(animal_id)
  );

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
-- 5) animals.vet_phone — emergency guardrail tap-to-copy source
-- =============================================================
alter table public.animals
  add column if not exists vet_phone text;


-- =============================================================
-- 6) conversations (Phase 4)
--    One row per owner chat thread.
-- =============================================================
create table if not exists public.conversations (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  title        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz
);

create index if not exists conversations_owner_updated_idx
  on public.conversations(owner_id, updated_at desc)
  where archived_at is null;

alter table public.conversations enable row level security;

drop policy if exists "conversations_owner_select" on public.conversations;
create policy "conversations_owner_select" on public.conversations
  for select using (owner_id = auth.uid());

revoke insert, update, delete on public.conversations from anon, authenticated;

drop trigger if exists conversations_touch on public.conversations;
create trigger conversations_touch before update on public.conversations
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 7) chatbot_runs (Phase 4)
--    Append-only audit of every turn.
-- =============================================================
create table if not exists public.chatbot_runs (
  id                     uuid primary key default gen_random_uuid(),
  conversation_id        uuid not null references public.conversations(id) on delete cascade,
  turn_index             int not null check (turn_index >= 0),
  role                   text not null check (role in ('user','assistant','system')),
  user_text              text,
  response_text          text,
  retrieved_protocol_ids uuid[] not null default '{}',
  model_id               text,
  latency_ms             int check (latency_ms is null or latency_ms >= 0),
  fallback               text not null default 'none'
                           check (fallback in ('none','kv_keyword','emergency')),
  emergency_triggered    boolean not null default false,
  rate_limit_remaining   int,
  created_at             timestamptz not null default now()
);

create unique index if not exists chatbot_runs_turn_unique
  on public.chatbot_runs(conversation_id, turn_index);
create index if not exists chatbot_runs_conversation_idx
  on public.chatbot_runs(conversation_id, created_at);
create index if not exists chatbot_runs_emergency_idx
  on public.chatbot_runs(created_at desc)
  where emergency_triggered = true;

alter table public.chatbot_runs enable row level security;

drop policy if exists "chatbot_runs_owner_select" on public.chatbot_runs;
create policy "chatbot_runs_owner_select" on public.chatbot_runs
  for select using (
    exists (
      select 1 from public.conversations c
      where c.id = chatbot_runs.conversation_id
        and c.owner_id = auth.uid()
    )
  );

revoke insert, update, delete on public.chatbot_runs from anon, authenticated;


-- =============================================================
-- 8) seed_run_log (Phase 4 seed pipeline forensics)
--    Service-role-only reads and writes.
-- =============================================================
create table if not exists public.seed_run_log (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null,
  protocol_id   uuid references public.protocols(id),
  status        text not null check (status in ('synced','failed','skipped')),
  error_message text,
  created_at    timestamptz not null default now()
);

create index if not exists seed_run_log_run_idx
  on public.seed_run_log(run_id, created_at);
create index if not exists seed_run_log_protocol_idx
  on public.seed_run_log(protocol_id, created_at desc);

alter table public.seed_run_log enable row level security;
revoke all on public.seed_run_log from anon, authenticated;


-- =============================================================
-- 9) orders.source — extend CHECK to allow 'chat'
-- =============================================================
alter table public.orders
  drop constraint if exists orders_source_check;

alter table public.orders
  add constraint orders_source_check
  check (source in ('shop','in_expense','chat'));


-- =============================================================
-- 10) Re-seed placeholder protocols
--     Matches 00011 phase 3.5 seed verbatim.
-- =============================================================
insert into public.protocols (number, name, description, use_case, associated_sku_placeholder)
values
  ('#10', 'Joint Support',       'Joint health for performance horses',  'Supports mobility and joint integrity in active performance horses',    'placeholder'),
  ('#17', 'Colic Eaz',           'Digestive emergency support',          'Immediate digestive comfort during colic episodes',                     'placeholder'),
  ('#33', 'Calming Care',        'Behavior / calm for show nerves',      'Reduces anxiety and promotes focus for show and transport',              'placeholder'),
  (null,  'Mare Moods',          'Hormone support for mares',            'Balances hormonal cycles to improve temperament and comfort',            'placeholder'),
  (null,  'Bug Control Bundle',  'Seasonal fly + pest defense',          'Seasonal protection against flies, ticks, and common pests',             'placeholder')
on conflict do nothing;


-- =============================================================
-- 11) Post-migration verification (comments only)
-- =============================================================
--   -- all new tables with RLS on
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public'
--     and tablename in ('protocols','animal_protocols','supplement_doses',
--                       'conversations','chatbot_runs','seed_run_log');
--
--   -- 5 demo protocols re-seeded + all pending embed
--   select count(*) as total,
--          count(*) filter (where embed_status='pending') as pending
--   from public.protocols;
--
--   -- orders.source now accepts 'chat'
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid='public.orders'::regclass and conname='orders_source_check';
