-- Applied remotely as 20260420003533_phase5_6_hubspot_app_config.
-- Backfilled into the local tree 2026-04-20.
--
-- Supabase hosted Postgres does not grant ALTER DATABASE on the
-- managed cluster. Fall back to a small service_role-only key/value
-- table for worker_base_url + worker_internal_secret. Same contract
-- as the GUC approach — drain_hubspot_syncs() reads both, no-ops if
-- either is missing.

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


create or replace function public.drain_hubspot_syncs()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_base_url text;
  v_secret   text;
  v_batch    jsonb;
  v_count    int;
begin
  select value into v_base_url from public.app_config where key = 'worker_base_url';
  select value into v_secret   from public.app_config where key = 'worker_internal_secret';

  if v_base_url is null or v_base_url = ''
     or v_secret is null or v_secret = '' then
    raise notice 'drain_hubspot_syncs: worker_base_url or worker_internal_secret unset - skipping';
    return 0;
  end if;

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
$fn$;

revoke all on function public.drain_hubspot_syncs() from public;
