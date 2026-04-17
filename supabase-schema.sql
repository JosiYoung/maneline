-- =============================================================
-- ManeLine — Supabase schema
-- Run this in your Supabase project: Dashboard -> SQL Editor -> New query
-- Safe to re-run; uses IF NOT EXISTS where possible.
-- =============================================================

-- 1) PROFILES ---------------------------------------------------
-- One row per person. id is the same uuid as auth.users.id.
create table if not exists public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  email            text,
  full_name        text,
  phone            text,
  location         text,           -- state or region, free text for v1
  discipline       text,           -- what the OWNER does (barrel, rope, ranch, trail, etc.)
  marketing_opt_in boolean default true,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 2) HORSES -----------------------------------------------------
-- Every horse belongs to exactly one owner. No cross-owner visibility.
create table if not exists public.horses (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  barn_name  text not null,
  breed      text,
  sex        text check (sex in ('mare','gelding','stallion')),
  year_born  integer,               -- e.g., 2018; approximate is fine
  discipline text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists horses_owner_idx on public.horses(owner_id);

-- 3) UPDATED_AT HELPERS ----------------------------------------
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_horses_touch on public.horses;
create trigger trg_horses_touch
  before update on public.horses
  for each row execute function public.touch_updated_at();

-- 4) AUTO-CREATE PROFILE + OPTIONAL FIRST HORSE ON SIGNUP ------
-- When Supabase creates an auth.users row (via signInWithOtp), this
-- trigger reads the signup metadata and creates the matching profile
-- plus the horse they registered during signup.
create or replace function public.handle_new_user()
returns trigger as $$
declare
  horse jsonb;
begin
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

  horse := new.raw_user_meta_data->'first_horse';
  if horse is not null and horse->>'barn_name' is not null then
    insert into public.horses (owner_id, barn_name, breed, sex, year_born, discipline)
    values (
      new.id,
      horse->>'barn_name',
      horse->>'breed',
      horse->>'sex',
      nullif(horse->>'year_born','')::integer,
      horse->>'discipline'
    );
  end if;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5) ROW LEVEL SECURITY ----------------------------------------
-- Turn on RLS and write policies so users can ONLY touch their own data.
alter table public.profiles enable row level security;
alter table public.horses   enable row level security;

-- PROFILES: user can see and update only their own row.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using ( auth.uid() = id );

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using ( auth.uid() = id );

-- (Insert is handled by the handle_new_user trigger, not by clients.)

-- HORSES: user can full-CRUD only their own horses.
drop policy if exists "horses_select_own" on public.horses;
create policy "horses_select_own" on public.horses
  for select using ( auth.uid() = owner_id );

drop policy if exists "horses_insert_own" on public.horses;
create policy "horses_insert_own" on public.horses
  for insert with check ( auth.uid() = owner_id );

drop policy if exists "horses_update_own" on public.horses;
create policy "horses_update_own" on public.horses
  for update using ( auth.uid() = owner_id );

drop policy if exists "horses_delete_own" on public.horses;
create policy "horses_delete_own" on public.horses
  for delete using ( auth.uid() = owner_id );

-- =============================================================
-- DONE. After running this, set up the webhook in the dashboard:
--   Dashboard -> Database -> Webhooks -> Create a new hook
--   Table:   profiles
--   Events:  Insert (and optionally Update)
--   Type:    HTTP Request
--   URL:     https://<your-worker>.workers.dev/webhook/sheets
--   HTTP Headers:
--     x-webhook-secret: <paste the secret you set in wrangler>
-- =============================================================
