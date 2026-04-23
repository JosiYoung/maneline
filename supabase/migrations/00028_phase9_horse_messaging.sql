-- =============================================================
-- Phase 9 Module 02 — Horse-scoped messaging
-- Migration: 00028_phase9_horse_messaging.sql
--
-- Async text-only chat per horse. Anyone with active access to the
-- horse (owner or granted trainer) can read + post. Messages are
-- immutable once sent; per-user read state lives in a separate
-- `horse_message_reads` table.
--
-- Compliance:
--   OAG §2 — RLS enforced; no service_role writes needed for inserts.
--   OAG §7 — explicit RLS policies below.
--   OAG §8 — archive-never-delete; no DELETE policy, archived_at col.
-- =============================================================

begin;

-- 1) horse_messages
create table if not exists public.horse_messages (
  id uuid primary key default gen_random_uuid(),
  animal_id uuid not null references public.animals(id) on delete cascade,
  sender_id uuid not null references auth.users(id),
  body text not null,
  created_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint horse_messages_body_len_check
    check (length(trim(body)) between 1 and 4000)
);

create index if not exists horse_messages_animal_created_idx
  on public.horse_messages(animal_id, created_at desc)
  where archived_at is null;

create index if not exists horse_messages_sender_idx
  on public.horse_messages(sender_id)
  where archived_at is null;

alter table public.horse_messages enable row level security;

drop policy if exists "horse_messages_select" on public.horse_messages;
drop policy if exists "horse_messages_insert" on public.horse_messages;

create policy "horse_messages_select" on public.horse_messages
  for select
  using (public.do_i_have_access_to_animal(animal_id));

create policy "horse_messages_insert" on public.horse_messages
  for insert
  with check (
    sender_id = auth.uid()
    and public.do_i_have_access_to_animal(animal_id)
  );

-- Intentionally no UPDATE or DELETE policy:
--   - Messages are immutable once sent (phase 9 decision).
--   - Archival is service_role only, via worker, to keep §8 clean.

-- 2) horse_message_reads — per-user per-horse last-read timestamp.
create table if not exists public.horse_message_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  animal_id uuid not null references public.animals(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, animal_id)
);

create index if not exists horse_message_reads_user_idx
  on public.horse_message_reads(user_id);

alter table public.horse_message_reads enable row level security;

drop policy if exists "horse_message_reads_self_select" on public.horse_message_reads;
drop policy if exists "horse_message_reads_self_write"  on public.horse_message_reads;

create policy "horse_message_reads_self_select" on public.horse_message_reads
  for select
  using (user_id = auth.uid());

create policy "horse_message_reads_self_write" on public.horse_message_reads
  for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and public.do_i_have_access_to_animal(animal_id)
  );

-- touch trigger
create or replace function public.touch_horse_message_reads()
returns trigger
language plpgsql
as $$
begin
  NEW.updated_at := now();
  return NEW;
end;
$$;

drop trigger if exists trg_horse_message_reads_touch on public.horse_message_reads;
create trigger trg_horse_message_reads_touch
  before update on public.horse_message_reads
  for each row execute function public.touch_horse_message_reads();

-- 3) Helper fn: unread count for the authed user across all horses.
-- Relies on horse_messages SELECT RLS to scope rows automatically —
-- no need for SECURITY DEFINER + explicit access check.
create or replace function public.horse_messages_unread_total()
returns int
language sql
stable
as $$
  select count(*)::int
  from public.horse_messages m
  left join public.horse_message_reads r
    on r.user_id = auth.uid() and r.animal_id = m.animal_id
  where m.archived_at is null
    and m.sender_id <> auth.uid()
    and (r.last_read_at is null or m.created_at > r.last_read_at);
$$;

commit;
