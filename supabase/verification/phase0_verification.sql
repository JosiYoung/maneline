-- =============================================================
-- Phase 0 verification harness
-- Run in the Supabase SQL Editor after applying migrations
-- 00002, 00003, 00004 (in order).
--
-- Each block is labelled with the expectation. If any row in a
-- block deviates from "expected", something is wrong — do NOT
-- advance to Phase 1 until every block is green.
-- =============================================================

-- -------------------------------------------------------------
-- Block 1 — every Phase 0 table has RLS on and >= 1 policy
-- Expected: relrowsecurity = true, policies >= 1 for every row.
-- -------------------------------------------------------------
select c.relname                                       as table_name,
       c.relrowsecurity                                as rls_enabled,
       (select count(*)
          from pg_policies p
         where p.tablename = c.relname)                as policy_count
from pg_class c
join pg_namespace n on c.relnamespace = n.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in (
    'profiles',
    'horses',
    'user_profiles',
    'animals',
    'ranches',
    'animal_access_grants',
    'trainer_profiles',
    'trainer_applications',
    'audit_log'
  )
order by c.relname;


-- -------------------------------------------------------------
-- Block 2 — NO silver_lining blanket policies remain after 00004
-- Expected: zero rows.
-- -------------------------------------------------------------
select schemaname, tablename, policyname
from pg_policies
where policyname ilike '%silver_lining%';


-- -------------------------------------------------------------
-- Block 3 — check_has_pin() is service-role-only
-- Expected: anon=false, authenticated=false, service_role=true.
-- -------------------------------------------------------------
select
  pg_catalog.has_function_privilege('anon',          'public.check_has_pin(text)','execute') as anon_has_access,
  pg_catalog.has_function_privilege('authenticated', 'public.check_has_pin(text)','execute') as auth_has_access,
  pg_catalog.has_function_privilege('service_role',  'public.check_has_pin(text)','execute') as svc_has_access;


-- -------------------------------------------------------------
-- Block 4 — horses ↔ animals backfill diff
-- Expected: zero rows. Any row here means a horse exists with
-- no matching animal (or vice versa). Dropping horses in Phase 1
-- is blocked until this is clean.
-- -------------------------------------------------------------
select 'horses_not_in_animals' as kind, h.id, h.owner_id, h.barn_name
from public.horses h
where not exists (
  select 1 from public.animals a
  where a.id = h.id
)
union all
select 'animals_horse_not_in_horses' as kind, a.id, a.owner_id, a.barn_name
from public.animals a
where a.species = 'horse'
  and not exists (
    select 1 from public.horses h
    where h.id = a.id
  );


-- -------------------------------------------------------------
-- Block 5 — Phase 0 helper functions exist
-- Expected: four rows (one per function name below).
-- -------------------------------------------------------------
select proname
from pg_proc
where proname in (
  'get_my_role',
  'am_i_owner_of',
  'do_i_have_access_to_animal',
  'is_silver_lining_admin'
)
order by proname;


-- -------------------------------------------------------------
-- Block 6 — signup trigger is live
-- Expected: one row.
-- -------------------------------------------------------------
select tgname, tgrelid::regclass as on_table
from pg_trigger
where tgname = 'on_auth_user_created';


-- -------------------------------------------------------------
-- Block 7 — handle_new_user domain guard is active
-- This is a manual check — no SQL can prove it without creating
-- a real auth user. Test from a browser:
--
--   1. Open SPA in incognito.
--   2. DevTools console, paste:
--        supabase.auth.signInWithOtp({
--          email: 'attacker@example.com',
--          options: { data: { role: 'silver_lining', full_name: 'Test' } }
--        })
--   3. Accept the magic link.
--   4. In SQL Editor:
--        select role from public.user_profiles
--          where email = 'attacker@example.com';
--   5. Expected: 'owner' (demoted). If 'silver_lining' appears,
--      the domain guard failed — roll back immediately.
--   6. Clean up:  delete from auth.users where email = 'attacker@example.com';
-- -------------------------------------------------------------


-- -------------------------------------------------------------
-- Block 8 — audit_log is read-locked to clients
-- Expected: both rows false. (Service role bypasses RLS and
-- returns true there, but we're asserting the browser can't see it.)
-- -------------------------------------------------------------
select
  pg_catalog.has_table_privilege('anon',          'public.audit_log','select') as anon_select,
  pg_catalog.has_table_privilege('authenticated', 'public.audit_log','select') as auth_select;
