-- =============================================================
-- Mane Line — Phase 5.6 (HubSpot sync queue: triggers + drain)
-- Migration: 00014_phase5_6_hubspot_triggers.sql
-- Date:      2026-04-19
--
-- Reference: docs/phase-5-plan.md §5.6.
--
-- What this migration does:
--   1) enqueue_hubspot_sync(event_name, payload) — SECURITY DEFINER
--      helper that appends to public.pending_hubspot_syncs. Called
--      from triggers (which run as the writing user, so they need
--      privilege escalation — the queue is service_role-only).
--   2) Five AFTER INSERT/UPDATE triggers that enqueue domain events:
--        user_profiles            → maneline_user_registered
--        trainer_applications     → maneline_trainer_applied
--        orders                   → maneline_order_placed
--        chatbot_runs (emergency) → maneline_emergency_triggered
--        trainer_profiles (app_status change)
--                                 → maneline_trainer_status_changed
--   3) drain_hubspot_syncs() — claims up to 50 eligible rows
--      (pending + next_run_at <= now), flips them to 'sending',
--      fires one net.http_post batch to the Worker. The Worker
--      updates each row's status + attempts + next_run_at via
--      service_role after processing. This function is
--      SECURITY DEFINER + owned by postgres so pg_cron can call it.
--   4) pg_cron schedule */5 * * * * runs the drain.
--
-- Configuration (operator runs ONCE per project):
--   insert into public.app_config (key, value) values
--     ('worker_base_url',        'https://mane-line.workers.dev'),
--     ('worker_internal_secret', '<same value as WORKER_INTERNAL_SECRET in wrangler secrets>')
--   on conflict (key) do update set value = excluded.value;
--
-- Hosted Supabase Postgres does NOT grant ALTER DATABASE on the
-- managed cluster (permission denied), so we store config in a
-- small service_role-only key/value table instead of GUCs.
--
-- If either key is unset, drain_hubspot_syncs() is a no-op and
-- returns 0 — queue accumulates until the operator configures both.
-- This matches the plan's graceful "waiting on keys" pattern (§5.6).
--
-- Compliance:
--   OAG §2 — pending_hubspot_syncs + hubspot_sync_log stay
--            service_role-write only (established in 00013).
--   OAG §7 — no new tables; every touched table already has RLS on.
--   OAG §8 — append-only; nothing deleted.
--
-- Safe to re-run: `create or replace function`, `drop trigger if
-- exists` + `create trigger`, `cron.unschedule` guarded by
-- existence check before `cron.schedule`.
-- =============================================================


create extension if not exists pg_net;
create extension if not exists pg_cron;


-- =============================================================
-- 0) app_config — service_role-only key/value table for the
--    drain function's worker URL + internal secret. GUCs via
--    `alter database` are blocked on hosted Supabase.
-- =============================================================
create table if not exists public.app_config (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

drop trigger if exists app_config_touch on public.app_config;
create trigger app_config_touch before update on public.app_config
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 1) enqueue_hubspot_sync(event_name, payload)
-- =============================================================
create or replace function public.enqueue_hubspot_sync(
  p_event_name text,
  p_payload    jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pending_hubspot_syncs (event_name, payload)
  values (p_event_name, coalesce(p_payload, '{}'::jsonb));
exception when others then
  -- Triggers MUST NOT fail the caller's write on a queue insert
  -- error; log and drop. The queue is best-effort marketing data,
  -- never blocks product writes.
  raise warning 'enqueue_hubspot_sync(%) failed: %', p_event_name, sqlerrm;
end
$$;

revoke all on function public.enqueue_hubspot_sync(text, jsonb) from public;


-- =============================================================
-- 2) Trigger functions + triggers
-- -------------------------------------------------------------
-- All trigger functions are plain (invoker) but call
-- enqueue_hubspot_sync() which IS security definer. Each payload
-- carries the minimum needed for HubSpot contact upsert +
-- behavioral events (email, user_id, etc). The Worker enriches
-- from Supabase as needed before sending.
-- =============================================================

-- 2a) user_profiles INSERT → maneline_user_registered
create or replace function public.trg_hubspot_user_registered()
returns trigger
language plpgsql
as $$
begin
  perform public.enqueue_hubspot_sync(
    'maneline_user_registered',
    jsonb_build_object(
      'user_id',      new.user_id,
      'email',        new.email,
      'role',         new.role,
      'display_name', new.display_name,
      'created_at',   new.created_at
    )
  );
  return new;
end
$$;

drop trigger if exists hubspot_user_registered on public.user_profiles;
create trigger hubspot_user_registered
  after insert on public.user_profiles
  for each row execute function public.trg_hubspot_user_registered();


-- 2b) trainer_applications INSERT → maneline_trainer_applied
create or replace function public.trg_hubspot_trainer_applied()
returns trigger
language plpgsql
as $$
declare
  v_email text;
begin
  select email into v_email
  from public.user_profiles where user_id = new.user_id;

  perform public.enqueue_hubspot_sync(
    'maneline_trainer_applied',
    jsonb_build_object(
      'user_id',      new.user_id,
      'email',        v_email,
      'application_id', new.id,
      'submitted_at', new.submitted_at,
      'application',  new.application
    )
  );
  return new;
end
$$;

drop trigger if exists hubspot_trainer_applied on public.trainer_applications;
create trigger hubspot_trainer_applied
  after insert on public.trainer_applications
  for each row execute function public.trg_hubspot_trainer_applied();


-- 2c) orders INSERT → maneline_order_placed
create or replace function public.trg_hubspot_order_placed()
returns trigger
language plpgsql
as $$
declare
  v_email text;
begin
  select email into v_email
  from public.user_profiles where user_id = new.owner_id;

  perform public.enqueue_hubspot_sync(
    'maneline_order_placed',
    jsonb_build_object(
      'order_id',     new.id,
      'owner_id',     new.owner_id,
      'email',        v_email,
      'total_cents',  new.total_cents,
      'currency',     new.currency,
      'source',       new.source,
      'status',       new.status,
      'created_at',   new.created_at
    )
  );
  return new;
end
$$;

drop trigger if exists hubspot_order_placed on public.orders;
create trigger hubspot_order_placed
  after insert on public.orders
  for each row execute function public.trg_hubspot_order_placed();


-- 2d) chatbot_runs INSERT (emergency_triggered=true) → maneline_emergency_triggered
create or replace function public.trg_hubspot_emergency_triggered()
returns trigger
language plpgsql
as $$
declare
  v_owner_id uuid;
  v_email    text;
begin
  select c.owner_id into v_owner_id
  from public.conversations c where c.id = new.conversation_id;

  if v_owner_id is not null then
    select email into v_email
    from public.user_profiles where user_id = v_owner_id;
  end if;

  perform public.enqueue_hubspot_sync(
    'maneline_emergency_triggered',
    jsonb_build_object(
      'run_id',          new.id,
      'conversation_id', new.conversation_id,
      'owner_id',        v_owner_id,
      'email',           v_email,
      'created_at',      new.created_at
    )
  );
  return new;
end
$$;

drop trigger if exists hubspot_emergency_triggered on public.chatbot_runs;
create trigger hubspot_emergency_triggered
  after insert on public.chatbot_runs
  for each row
  when (new.emergency_triggered = true)
  execute function public.trg_hubspot_emergency_triggered();


-- 2e) trainer_profiles UPDATE (application_status change)
--     → maneline_trainer_status_changed
create or replace function public.trg_hubspot_trainer_status_changed()
returns trigger
language plpgsql
as $$
declare
  v_email text;
begin
  select email into v_email
  from public.user_profiles where user_id = new.user_id;

  perform public.enqueue_hubspot_sync(
    'maneline_trainer_status_changed',
    jsonb_build_object(
      'user_id',        new.user_id,
      'email',          v_email,
      'old_status',     old.application_status,
      'new_status',     new.application_status,
      'reviewed_by',    new.reviewed_by,
      'reviewed_at',    new.reviewed_at
    )
  );
  return new;
end
$$;

drop trigger if exists hubspot_trainer_status_changed on public.trainer_profiles;
create trigger hubspot_trainer_status_changed
  after update on public.trainer_profiles
  for each row
  when (old.application_status is distinct from new.application_status)
  execute function public.trg_hubspot_trainer_status_changed();


-- =============================================================
-- 3) drain_hubspot_syncs()
-- -------------------------------------------------------------
-- Picks up to 50 eligible rows (pending + next_run_at <= now),
-- flips them to 'sending', fires ONE net.http_post batch to the
-- Worker. The Worker processes each row and writes status back
-- via service_role. Fire-and-forget from postgres.
--
-- Returns the number of rows dispatched (0 if nothing claimed or
-- configuration missing).
-- =============================================================
create or replace function public.drain_hubspot_syncs()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base_url       text;
  v_secret         text;
  v_batch          jsonb;
  v_count          int;
begin
  select value into v_base_url from public.app_config where key = 'worker_base_url';
  select value into v_secret   from public.app_config where key = 'worker_internal_secret';

  if v_base_url is null or v_base_url = ''
     or v_secret is null or v_secret = '' then
    raise notice 'drain_hubspot_syncs: worker_base_url or worker_internal_secret unset — skipping';
    return 0;
  end if;

  -- Claim up to 50 rows atomically. SKIP LOCKED makes concurrent
  -- drains a no-op instead of an error (defense-in-depth; pg_cron
  -- shouldn't overlap given */5 cadence).
  with claimed as (
    select id
    from public.pending_hubspot_syncs
    where status = 'pending'
      and next_run_at <= now()
    order by next_run_at asc
    limit 50
    for update skip locked
  ),
  flipped as (
    update public.pending_hubspot_syncs q
    set status = 'sending',
        updated_at = now()
    where q.id in (select id from claimed)
    returning q.id, q.event_name, q.payload, q.attempts
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',         id,
      'event_name', event_name,
      'payload',    payload,
      'attempts',   attempts
    )
  ), '[]'::jsonb), count(*)::int
  into v_batch, v_count
  from flipped;

  if v_count = 0 then
    return 0;
  end if;

  -- Fire the batch. Response lands in net._http_response; the Worker
  -- is what actually updates the queue rows on success/failure, so
  -- we don't need to await the response here.
  perform net.http_post(
    url := rtrim(v_base_url, '/') || '/api/_internal/hubspot-drain',
    headers := jsonb_build_object(
      'content-type',      'application/json',
      'x-internal-secret', v_secret
    ),
    body := jsonb_build_object('rows', v_batch),
    timeout_milliseconds := 30000
  );

  return v_count;
end
$$;

revoke all on function public.drain_hubspot_syncs() from public;


-- =============================================================
-- 4) pg_cron schedule — every 5 minutes
-- =============================================================
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid
  from cron.job where jobname = 'drain-hubspot-syncs';

  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;

  perform cron.schedule(
    'drain-hubspot-syncs',
    '*/5 * * * *',
    $cron$select public.drain_hubspot_syncs()$cron$
  );
end
$$;


-- =============================================================
-- 5) Post-migration verification (comments only)
-- =============================================================
--   -- triggers present
--   select event_object_table, trigger_name
--   from information_schema.triggers
--   where trigger_name like 'hubspot_%' order by 1, 2;
--
--   -- drain function is callable; returns 0 when unconfigured
--   select public.drain_hubspot_syncs();
--
--   -- cron job scheduled
--   select jobname, schedule, active from cron.job
--   where jobname = 'drain-hubspot-syncs';
--
--   -- synthetic end-to-end enqueue check (fires trg_hubspot_user_registered)
--   insert into public.user_profiles (user_id, role, display_name, email)
--   values (gen_random_uuid(), 'owner', 'HubSpot probe', 'probe@maneline.dev');
--
--   select id, event_name, status, created_at
--   from public.pending_hubspot_syncs
--   where event_name = 'maneline_user_registered'
--   order by created_at desc limit 1;
