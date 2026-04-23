-- =============================================================
-- Phase 9 Module 03 — Session ratings (bidirectional, session-gated)
-- Migration: 00029_phase9_session_ratings.sql
--
-- Owner rates trainer and trainer rates owner, one rating per
-- direction per completed session. Prompt fires only when a session
-- reaches status in ('approved','paid') — no retro prompt from
-- profile. Uber-style: n≥3 threshold before the aggregate shows.
--
-- Compliance:
--   OAG §2 — RLS enforced; insert check validates session ownership.
--   OAG §7 — explicit RLS below.
--   OAG §8 — archive-never-delete via archived_at.
-- =============================================================

begin;

create table if not exists public.session_ratings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.training_sessions(id) on delete cascade,
  rater_id uuid not null references auth.users(id),
  ratee_id uuid not null references auth.users(id),
  stars smallint not null check (stars between 1 and 5),
  comment text null check (
    comment is null
    or length(trim(comment)) between 1 and 1000
  ),
  created_at timestamptz not null default now(),
  archived_at timestamptz null,
  constraint session_ratings_one_per_rater_per_session
    unique (session_id, rater_id)
);

create index if not exists session_ratings_ratee_idx
  on public.session_ratings(ratee_id)
  where archived_at is null;

create index if not exists session_ratings_session_idx
  on public.session_ratings(session_id);

alter table public.session_ratings enable row level security;

drop policy if exists "session_ratings_select" on public.session_ratings;
drop policy if exists "session_ratings_insert" on public.session_ratings;

-- Individual ratings are visible only to the rater and the ratee.
-- Aggregate stars go through user_rating_summary() (SECURITY DEFINER).
create policy "session_ratings_select" on public.session_ratings
  for select
  using (rater_id = auth.uid() or ratee_id = auth.uid());

-- Insert only allowed when:
--   - rater_id is the authed user
--   - the session is in an approved/paid state
--   - rater is owner (ratee must be trainer) OR rater is trainer (ratee must be owner)
create policy "session_ratings_insert" on public.session_ratings
  for insert
  with check (
    rater_id = auth.uid()
    and exists (
      select 1
      from public.training_sessions s
      where s.id = session_id
        and s.archived_at is null
        and s.status in ('approved','paid')
        and (
             (s.owner_id   = auth.uid() and ratee_id = s.trainer_id)
          or (s.trainer_id = auth.uid() and ratee_id = s.owner_id)
        )
    )
  );

-- No UPDATE / DELETE: ratings are immutable once written (OAG §8).

-- Helper: public aggregate. Uses SECURITY DEFINER so the "New" / star
-- badge can be rendered on profile pages without leaking individual
-- rating rows through RLS. n is returned so the SPA can decide whether
-- to show the star (≥3) or the "New" label.
create or replace function public.user_rating_summary(p_user_id uuid)
returns table (avg_stars numeric, rating_count int)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    round(avg(stars)::numeric, 2) as avg_stars,
    count(*)::int                  as rating_count
  from public.session_ratings
  where ratee_id = p_user_id
    and archived_at is null;
$$;

-- Helper: has the current user already rated this session?
create or replace function public.my_rating_for_session(p_session_id uuid)
returns table (id uuid, stars smallint, comment text, created_at timestamptz)
language sql
stable
as $$
  select id, stars, comment, created_at
  from public.session_ratings
  where session_id = p_session_id
    and rater_id   = auth.uid()
    and archived_at is null
  limit 1;
$$;

commit;
