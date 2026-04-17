-- =============================================================
-- Mane Line — Phase 2 Prompt 2.3 (Client Roster) RLS addendum
-- Migration: 00007_phase2_trainer_roster_policy.sql
-- Date:      2026-04-17
--
-- Why:
--   Phase 0 locked user_profiles SELECT to user_id = auth.uid(). That
--   blocked the trainer portal's client roster from resolving the
--   owner's display_name / email — both of which the trainer already
--   learned during the invite flow, so no new PII exposure.
--
-- Fix:
--   Add a scoped SELECT policy on user_profiles that lets a trainer
--   read a row when an active-or-grace grant connects them to that
--   owner. Matches the grace-window logic already in
--   ranches_trainer_select (migration 00002:358).
--
-- Compliance:
--   OAG §7 — RLS-enforced; no service_role read from the client. The
--   policy is additive (grants widen; they don't remove existing
--   restrictions). Revoked, past-grace grants still hide the row.
-- =============================================================

drop policy if exists "user_profiles_select_granted_owner" on public.user_profiles;

create policy "user_profiles_select_granted_owner" on public.user_profiles
  for select using (
    role = 'owner'
    and exists (
      select 1
      from public.animal_access_grants g
      where g.owner_id   = user_profiles.user_id
        and g.trainer_id = auth.uid()
        and (
             g.revoked_at is null
          or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now())
        )
    )
  );
