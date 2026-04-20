-- =============================================================
-- Mane Line — Phase 5 (Admin KPI RPC)
-- Migration: 00014_phase5_admin_kpi_snapshot.sql
-- Date:      2026-04-19
--
-- Reference: docs/phase-5-plan.md §2 sub-prompt 5.2.
--
-- Worker GET /api/admin/kpis calls this RPC with service_role to
-- build the four tiles on /admin. One JSON row:
--   { wau, mau, gmv_30d_cents, attach_rate_30d, as_of }
--
-- WAU/MAU = distinct user ids with a write to any owner/trainer
-- surface (animals, orders, training_sessions, expenses,
-- conversations, vet_records) in the trailing window.
--
-- GMV    = sum(orders.total_cents) where status='paid' and
--          created_at > now() - 30d.
-- Attach = distinct owner_ids paying in the last 30d ÷ total
--          active owners (user_profiles.role='owner' + status='active').
--
-- OAG §2: execute privilege is revoked from anon + authenticated.
-- Only service_role (worker) can call the RPC.
-- =============================================================

create or replace function public.admin_kpi_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with
  active_7d as (
    select owner_id as user_id from public.animals          where updated_at > now() - interval '7 days'
    union
    select owner_id                from public.orders           where created_at > now() - interval '7 days'
    union
    select owner_id                from public.training_sessions where updated_at > now() - interval '7 days'
    union
    select trainer_id              from public.training_sessions where updated_at > now() - interval '7 days'
    union
    select recorder_id             from public.expenses         where created_at > now() - interval '7 days'
    union
    select owner_id                from public.conversations    where updated_at > now() - interval '7 days'
    union
    select owner_id                from public.vet_records      where created_at > now() - interval '7 days'
  ),
  active_30d as (
    select owner_id as user_id from public.animals          where updated_at > now() - interval '30 days'
    union
    select owner_id                from public.orders           where created_at > now() - interval '30 days'
    union
    select owner_id                from public.training_sessions where updated_at > now() - interval '30 days'
    union
    select trainer_id              from public.training_sessions where updated_at > now() - interval '30 days'
    union
    select recorder_id             from public.expenses         where created_at > now() - interval '30 days'
    union
    select owner_id                from public.conversations    where updated_at > now() - interval '30 days'
    union
    select owner_id                from public.vet_records      where created_at > now() - interval '30 days'
  ),
  gmv as (
    select coalesce(sum(total_cents), 0)::bigint as cents
    from public.orders
    where status = 'paid' and created_at > now() - interval '30 days'
  ),
  owners_total as (
    select count(distinct user_id)::bigint as n
    from public.user_profiles
    where role = 'owner' and status = 'active'
  ),
  owners_with_orders_30d as (
    select count(distinct owner_id)::bigint as n
    from public.orders
    where status = 'paid' and created_at > now() - interval '30 days'
  )
  select jsonb_build_object(
    'wau',            (select count(distinct user_id) from active_7d  where user_id is not null),
    'mau',            (select count(distinct user_id) from active_30d where user_id is not null),
    'gmv_30d_cents',  (select cents from gmv),
    'attach_rate_30d',
      case
        when (select n from owners_total) = 0 then 0
        else round((select n from owners_with_orders_30d)::numeric
                 / (select n from owners_total)::numeric, 4)
      end,
    'as_of',          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
$$;

revoke execute on function public.admin_kpi_snapshot() from public, anon, authenticated;
