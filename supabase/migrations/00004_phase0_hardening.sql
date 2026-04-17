-- =============================================================
-- Mane Line — Phase 0 hardening
-- Migration: 00004_phase0_hardening.sql
-- Date:      2026-04-16
--
-- Closes the findings from the Phase 0 security + quality audit.
--
-- Changes:
--   1. audit_log table (OAG_ARCHITECTURE_LAWS §8). Append-only; only
--      service_role writes; admins SELECT only through the Worker
--      /api/admin/audit endpoint.
--   2. handle_new_user() hardened:
--        - `silver_lining` role only granted when the email domain
--          matches @silverliningherbs.com. Any other metadata value
--          is demoted to 'owner'. (Fixes HIGH-sev privilege escalation.)
--        - Canonical metadata keys only: `first_horse` + `owner_discipline`.
--          The "spec alias" keys (`first_animal`, `discipline`) are
--          ignored going forward. SPA is updated to match.
--   3. Blanket `silver_lining` SELECT/UPDATE policies DROPPED from:
--        user_profiles, ranches, animal_access_grants,
--        trainer_profiles, trainer_applications.
--      Admin data access now routes exclusively through Worker
--      endpoints using service_role, which write an audit_log row
--      before returning.
--      `do_i_have_access_to_animal()` no longer short-circuits on
--      `is_silver_lining_admin()`.
--   4. `check_has_pin(text)` EXECUTE revoked from anon + authenticated.
--      Only service_role may call it. The Worker's /api/has-pin
--      endpoint rate-limits per-IP and proxies the call.
--      (Fixes HIGH-sev email enumeration oracle.)
--   5. `is_silver_lining_admin()` is retained (the Worker's service_role
--      callers don't use it, but helper functions inside the DB still
--      do — e.g. future audit triggers).
--
-- Compliance:
--   - OAG_ARCHITECTURE_LAWS §2 (admin reads via Worker, not blanket RLS)
--   - OAG_ARCHITECTURE_LAWS §7 (RLS on audit_log day-one, revoke-first
--     on sensitive RPCs)
--   - OAG_ARCHITECTURE_LAWS §8 (durable audit record)
--
-- Safe to re-run: idempotent drops, create-or-replace, revoke is no-op
-- if grant absent.
-- =============================================================


-- =============================================================
-- 1) audit_log
--    Every admin-surface read and every sensitive mutation writes
--    one row here. Written by the Worker via service_role. Never
--    written or read directly from the browser.
-- =============================================================
create table if not exists public.audit_log (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,                         -- auth.users(id); null if system
  actor_role   text,                         -- denormalized for query speed
  action       text not null,                -- e.g. 'admin.read.trainer_applications'
  target_table text,
  target_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  ip           text,
  user_agent   text
);

create index if not exists audit_log_occurred_idx on public.audit_log(occurred_at desc);
create index if not exists audit_log_actor_idx    on public.audit_log(actor_id);
create index if not exists audit_log_action_idx   on public.audit_log(action);
create index if not exists audit_log_target_idx   on public.audit_log(target_table, target_id);

alter table public.audit_log enable row level security;

-- No client-level policies. Service_role bypasses RLS; everyone
-- else sees nothing. Admin reads go through the Worker.
drop policy if exists "audit_log_no_client_access" on public.audit_log;
create policy "audit_log_no_client_access" on public.audit_log
  for select using (false);

-- Defense in depth: explicit revoke even though RLS already blocks.
revoke all on public.audit_log from anon, authenticated;


-- =============================================================
-- 2) Drop blanket silver_lining RLS policies.
--    Admin reads must go through the service_role Worker path so
--    every access is audited. Keeping the RLS escape hatch would
--    undermine that.
-- =============================================================
drop policy if exists "user_profiles_select_silver_lining"       on public.user_profiles;
drop policy if exists "ranches_silver_lining_select"             on public.ranches;
drop policy if exists "grants_silver_lining_select"              on public.animal_access_grants;
drop policy if exists "trainer_profiles_silver_lining_select"    on public.trainer_profiles;
drop policy if exists "trainer_profiles_silver_lining_update"    on public.trainer_profiles;
drop policy if exists "trainer_apps_silver_lining_select"        on public.trainer_applications;
drop policy if exists "trainer_apps_silver_lining_update"        on public.trainer_applications;


-- =============================================================
-- 3) Rebuild do_i_have_access_to_animal() without the
--    is_silver_lining_admin() short-circuit. Admins reading animal
--    data now do so through the service_role Worker path.
-- =============================================================
create or replace function public.do_i_have_access_to_animal(animal_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  if v_uid is null then return false; end if;

  select a.owner_id into v_owner
  from public.animals a
  where a.id = do_i_have_access_to_animal.animal_id;

  if v_owner is null then return false; end if;
  if v_owner = v_uid  then return true;  end if;

  -- Trainer with an active grant (or within the read-only grace period).
  -- scope='ranch' remains TECH_DEBT: animals.ranch_id ships in Phase 1.
  return exists (
    select 1
    from public.animal_access_grants g
    where g.trainer_id = v_uid
      and (
           (g.scope = 'animal'    and g.animal_id = do_i_have_access_to_animal.animal_id)
        or (g.scope = 'owner_all' and g.owner_id  = v_owner)
      )
      and (
           g.revoked_at is null
        or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now())
      )
  );
end;
$$;


-- =============================================================
-- 4) Harden handle_new_user().
--    - silver_lining role requires @silverliningherbs.com email
--    - Only canonical metadata keys are read (first_horse,
--      owner_discipline). The SPA's spec-alias keys are dropped.
-- =============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_horse         jsonb;
  v_role          text;
  v_display_name  text;
  v_user_status   text;
  v_email_lower   text;
begin
  v_email_lower := lower(coalesce(new.email, ''));
  v_role        := coalesce(new.raw_user_meta_data->>'role', 'owner');

  -- Domain guard: silver_lining role is ONLY granted if the email
  -- ends in the Silver Lining Herbs domain. Any mismatch (or a bogus
  -- enum value) falls back to 'owner'. This is the single choke point
  -- against client-side privilege escalation via raw_user_meta_data.
  if v_role = 'silver_lining' and v_email_lower not like '%@silverliningherbs.com' then
    v_role := 'owner';
  end if;

  if v_role not in ('owner','trainer','silver_lining') then
    v_role := 'owner';
  end if;

  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'),    ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'rider'
  );

  v_user_status := case when v_role = 'trainer' then 'pending_review' else 'active' end;

  -- Legacy profiles row (kept through Phase 1 day 1 per decommission plan).
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

  insert into public.user_profiles (user_id, role, display_name, email, status)
  values (new.id, v_role, v_display_name, new.email, v_user_status)
  on conflict (user_id) do nothing;

  -- First-animal payload — canonical key only. (Previously we accepted
  -- both first_horse and first_animal; SPA now sends only first_horse.)
  v_horse := new.raw_user_meta_data->'first_horse';
  if v_horse is not null and coalesce(v_horse->>'barn_name','') <> '' then
    insert into public.horses (owner_id, barn_name, breed, sex, year_born, discipline)
    values (
      new.id,
      v_horse->>'barn_name',
      v_horse->>'breed',
      v_horse->>'sex',
      nullif(v_horse->>'year_born','')::integer,
      v_horse->>'discipline'
    );

    insert into public.animals (owner_id, species, barn_name, breed, sex, year_born, discipline)
    values (
      new.id,
      'horse',
      v_horse->>'barn_name',
      v_horse->>'breed',
      v_horse->>'sex',
      nullif(v_horse->>'year_born','')::integer,
      v_horse->>'discipline'
    );
  end if;

  if v_role = 'trainer' then
    insert into public.trainer_profiles (user_id, bio, application_status)
    values (
      new.id,
      new.raw_user_meta_data->>'bio',
      'submitted'
    )
    on conflict (user_id) do nothing;

    insert into public.trainer_applications (user_id, submitted_at, application, status)
    values (
      new.id,
      now(),
      coalesce(new.raw_user_meta_data->'trainer_application', '{}'::jsonb),
      'submitted'
    );
  end if;

  return new;
end;
$$;


-- =============================================================
-- 5) Revoke check_has_pin() from anon + authenticated.
--    The Login page no longer calls this RPC directly; the Worker's
--    /api/has-pin endpoint calls it via service_role, rate-limited
--    per-IP. Keeps the enumeration oracle off the public internet.
-- =============================================================
revoke execute on function public.check_has_pin(text) from anon;
revoke execute on function public.check_has_pin(text) from authenticated;
grant  execute on function public.check_has_pin(text) to   service_role;


-- =============================================================
-- 6) Post-apply verification (run in SQL Editor):
--
--   -- a. audit_log exists, RLS on, zero public policies:
--   select c.relname, c.relrowsecurity,
--          (select count(*) from pg_policies p
--           where p.tablename = c.relname and p.roles != '{service_role}') as client_policies
--   from pg_class c join pg_namespace n on c.relnamespace = n.oid
--   where n.nspname = 'public' and c.relname = 'audit_log';
--
--   -- b. No silver_lining RLS policies remain:
--   select schemaname, tablename, policyname
--   from pg_policies
--   where policyname ilike '%silver_lining%';
--   -- Expect: zero rows.
--
--   -- c. check_has_pin is service-role-only:
--   select pg_catalog.has_function_privilege('anon',          'public.check_has_pin(text)','execute'),
--          pg_catalog.has_function_privilege('authenticated', 'public.check_has_pin(text)','execute'),
--          pg_catalog.has_function_privilege('service_role',  'public.check_has_pin(text)','execute');
--   -- Expect: false, false, true.
--
--   -- d. Privilege-escalation guard: simulate an attacker signup with
--   --    role='silver_lining' but a non-SLH email. Should demote.
--   --    (Run via supabase.auth.signInWithOtp, then:)
--   --    select role from public.user_profiles where email = '<test>';
--   --    Expect: 'owner', NOT 'silver_lining'.
-- =============================================================
