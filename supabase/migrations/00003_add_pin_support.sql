-- 00003_add_pin_support.sql
-- Adds PIN login support via Supabase built-in password auth.
-- The actual PIN is stored as the user's password in auth.users.
-- We track has_pin on user_profiles so the login page knows which flow to show.

alter table public.user_profiles
  add column if not exists has_pin boolean not null default false;

-- Anon-callable: login page checks if email has PIN set
create or replace function public.check_has_pin(p_email text)
returns boolean language sql stable security definer
set search_path = public, pg_temp as $$
  select coalesce(
    (select has_pin from user_profiles where lower(email) = lower(p_email) limit 1),
    false);
$$;

-- Auth'd: flip flag after client calls updateUser({ password })
create or replace function public.set_pin()
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update user_profiles set has_pin = true where user_id = auth.uid();
end; $$;

-- Auth'd: mark PIN as removed
create or replace function public.clear_pin()
returns void language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  update user_profiles set has_pin = false where user_id = auth.uid();
end; $$;
