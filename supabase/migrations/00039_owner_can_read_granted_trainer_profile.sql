-- =============================================================
-- 00039_owner_can_read_granted_trainer_profile.sql
--
-- Mirrors the existing user_profiles_select policy (00033) which
-- lets a trainer read profiles of owners who granted them access.
-- The reverse direction was missing: owners couldn't read the
-- profiles of trainers they granted access TO. Result: the
-- /app/trainers list rendered every grant as "Unknown trainer"
-- because the supabase-js join returned no rows.
--
-- Adds an OR-branch to the consolidated select policy so an owner
-- can read a trainer's profile while at least one of their grants
-- is active or in grace.
-- =============================================================

drop policy if exists user_profiles_select on public.user_profiles;

create policy user_profiles_select on public.user_profiles
  for select
  using (
    -- 1) Always: read your own profile.
    user_id = (select auth.uid())
    -- 2) Trainer reads owners who granted them access.
    or (
      role = 'owner'
      and exists (
        select 1 from public.animal_access_grants g
         where g.owner_id = user_profiles.user_id
           and g.trainer_id = (select auth.uid())
           and (
             g.revoked_at is null
             or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now())
           )
      )
    )
    -- 3) Owner reads trainers they granted access to.
    or (
      role = 'trainer'
      and exists (
        select 1 from public.animal_access_grants g
         where g.trainer_id = user_profiles.user_id
           and g.owner_id   = (select auth.uid())
           and (
             g.revoked_at is null
             or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now())
           )
      )
    )
  );
