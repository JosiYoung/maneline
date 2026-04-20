-- =============================================================
-- Mane Line — Phase 5 (Admin Portal + Vet View + HubSpot sync)
-- Migration: 00013_phase5_admin_vet_hubspot.sql
-- Date:      2026-04-19
--
-- Reference: docs/phase-5-plan.md §2 sub-prompt 5.1.
--
-- What this migration does (in order):
--   1) vet_share_tokens            — scoped magic link per feature #5
--   2) pending_hubspot_syncs       — queue draining into Worker (#7)
--   3) hubspot_sync_log            — append-only success log (#7)
--   4) support_tickets             — inbox for all portals (#9)
--   5) order_refunds               — admin refund ledger (#11)
--   6) audit_log composite indexes — (actor_id, occurred_at DESC)
--                                    + (action, occurred_at DESC) so
--                                    the `/admin/audit` read path per
--                                    feature #12 stays <5ms p99.
--
-- Compliance:
--   OAG §2 — every new table is service_role-write only. Owners
--            read their own `vet_share_tokens`, `support_tickets`,
--            and refunds (via the `orders` join); admins read
--            through the Worker, not RLS.
--   OAG §3 — audit_log already exists from 00004_phase0_hardening.
--            This migration ONLY adds composite indexes; it does
--            NOT re-CREATE the table or change column names.
--   OAG §7 — RLS enabled on every new table from the first CREATE
--            with policies defined day one.
--   OAG §8 — archive-never-delete: every new table carries an
--            `archived_at` or `revoked_at` column, and DELETE is
--            revoked from anon + authenticated on every one.
--
-- Feature #13 (admin RLS reconciliation) is a documentation-only
-- close-out: the REVISIT block in 00002 and the dropped policies in
-- 00004 are intentionally NOT reintroduced. Admin reads route
-- through the Worker's service_role path (see worker.js
-- handleAdmin()) and each read writes an audit_log row. No new
-- silver_lining RLS policies are added here.
--
-- Safe to re-run: every statement is `if not exists` /
-- `if exists` / `on conflict do nothing`. A second run after the
-- first succeeds is a no-op.
-- =============================================================


-- =============================================================
-- 1) vet_share_tokens
--    Owner-generated scoped read link. Worker's /vet/:token
--    handler is the ONLY anon read path. Each view appends to
--    audit_log and bumps view_count/viewed_at.
-- =============================================================
create table if not exists public.vet_share_tokens (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  animal_id       uuid not null references public.animals(id) on delete cascade,
  token           text not null,
  scope           jsonb not null default jsonb_build_object(
                    'records', true,
                    'media',   true,
                    'sessions', false
                  ),
  expires_at      timestamptz not null,
  viewed_at       timestamptz,
  view_count      int not null default 0 check (view_count >= 0),
  revoked_at      timestamptz,
  revoked_reason  text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists vet_share_tokens_token_unique
  on public.vet_share_tokens(token);
create index if not exists vet_share_tokens_owner_idx
  on public.vet_share_tokens(owner_id, created_at desc)
  where archived_at is null;
create index if not exists vet_share_tokens_animal_idx
  on public.vet_share_tokens(animal_id, created_at desc)
  where archived_at is null;
create index if not exists vet_share_tokens_active_idx
  on public.vet_share_tokens(expires_at)
  where revoked_at is null and archived_at is null;

alter table public.vet_share_tokens enable row level security;

drop policy if exists "vet_share_tokens_owner_select" on public.vet_share_tokens;
create policy "vet_share_tokens_owner_select" on public.vet_share_tokens
  for select using (owner_id = auth.uid());

revoke insert, update, delete on public.vet_share_tokens from anon, authenticated;

drop trigger if exists vet_share_tokens_touch on public.vet_share_tokens;
create trigger vet_share_tokens_touch before update on public.vet_share_tokens
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 2) pending_hubspot_syncs
--    Queue drained by pg_cron every 5m. Attempts/backoff per
--    feature #7 (15m × 2^attempts, max 5, then dead_letter).
-- =============================================================
create table if not exists public.pending_hubspot_syncs (
  id            uuid primary key default gen_random_uuid(),
  event_name    text not null,
  payload       jsonb not null default '{}'::jsonb,
  attempts      int  not null default 0 check (attempts >= 0),
  next_run_at   timestamptz not null default now(),
  status        text not null default 'pending'
                  check (status in ('pending','sending','sent','dead_letter')),
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists pending_hubspot_syncs_drain_idx
  on public.pending_hubspot_syncs(next_run_at)
  where status = 'pending';
create index if not exists pending_hubspot_syncs_deadletter_idx
  on public.pending_hubspot_syncs(updated_at desc)
  where status = 'dead_letter';
create index if not exists pending_hubspot_syncs_event_idx
  on public.pending_hubspot_syncs(event_name, created_at desc);

alter table public.pending_hubspot_syncs enable row level security;
revoke all on public.pending_hubspot_syncs from anon, authenticated;

drop trigger if exists pending_hubspot_syncs_touch on public.pending_hubspot_syncs;
create trigger pending_hubspot_syncs_touch before update on public.pending_hubspot_syncs
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 3) hubspot_sync_log
--    Append-only. One row per successful send.
-- =============================================================
create table if not exists public.hubspot_sync_log (
  id                   uuid primary key default gen_random_uuid(),
  event_name           text not null,
  hubspot_contact_id   text,
  hubspot_deal_id      text,
  payload              jsonb not null default '{}'::jsonb,
  response             jsonb not null default '{}'::jsonb,
  latency_ms           int check (latency_ms is null or latency_ms >= 0),
  created_at           timestamptz not null default now()
);

create index if not exists hubspot_sync_log_created_idx
  on public.hubspot_sync_log(created_at desc);
create index if not exists hubspot_sync_log_event_idx
  on public.hubspot_sync_log(event_name, created_at desc);
create index if not exists hubspot_sync_log_contact_idx
  on public.hubspot_sync_log(hubspot_contact_id)
  where hubspot_contact_id is not null;

alter table public.hubspot_sync_log enable row level security;
revoke all on public.hubspot_sync_log from anon, authenticated;


-- =============================================================
-- 4) support_tickets
--    owner_id is nullable — anon landing-form tickets are allowed
--    (category restricted to 'bug' | 'feature_request' in the
--    Worker handler, see 5.4).
-- =============================================================
create table if not exists public.support_tickets (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid references auth.users(id) on delete set null,
  contact_email        text,
  category             text not null check (category in (
                         'account','billing','bug','feature_request','emergency_followup'
                       )),
  subject              text not null check (char_length(subject) between 1 and 200),
  body                 text not null check (char_length(body) between 1 and 10000),
  status               text not null default 'open'
                         check (status in ('open','claimed','resolved','archived')),
  assignee_id          uuid references auth.users(id) on delete set null,
  first_response_at    timestamptz,
  resolved_at          timestamptz,
  archived_at          timestamptz,
  source_ip            text,
  user_agent           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists support_tickets_status_idx
  on public.support_tickets(status, created_at desc)
  where archived_at is null;
create index if not exists support_tickets_owner_idx
  on public.support_tickets(owner_id, created_at desc)
  where owner_id is not null;
create index if not exists support_tickets_assignee_idx
  on public.support_tickets(assignee_id, status)
  where assignee_id is not null;

alter table public.support_tickets enable row level security;

drop policy if exists "support_tickets_owner_select" on public.support_tickets;
create policy "support_tickets_owner_select" on public.support_tickets
  for select using (
    owner_id is not null and owner_id = auth.uid()
  );

revoke insert, update, delete on public.support_tickets from anon, authenticated;

drop trigger if exists support_tickets_touch on public.support_tickets;
create trigger support_tickets_touch before update on public.support_tickets
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 5) order_refunds
--    Owner-readable via join on orders.owner_id. Admin writes
--    via service_role + Stripe idempotency key.
-- =============================================================
create table if not exists public.order_refunds (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null references public.orders(id) on delete cascade,
  stripe_refund_id    text,
  amount_cents        int not null check (amount_cents > 0),
  reason              text,
  refunded_by         uuid not null references auth.users(id),
  stripe_status       text not null default 'pending'
                        check (stripe_status in ('pending','succeeded','failed','canceled')),
  last_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists order_refunds_stripe_unique
  on public.order_refunds(stripe_refund_id)
  where stripe_refund_id is not null;
create index if not exists order_refunds_order_idx
  on public.order_refunds(order_id, created_at desc);
create index if not exists order_refunds_status_idx
  on public.order_refunds(stripe_status, created_at desc);

alter table public.order_refunds enable row level security;

drop policy if exists "order_refunds_owner_select" on public.order_refunds;
create policy "order_refunds_owner_select" on public.order_refunds
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_refunds.order_id
        and o.owner_id = auth.uid()
    )
  );

revoke insert, update, delete on public.order_refunds from anon, authenticated;

drop trigger if exists order_refunds_touch on public.order_refunds;
create trigger order_refunds_touch before update on public.order_refunds
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 6) audit_log composite indexes
--    Table + single-column indexes already exist (00004). Phase 5
--    admin reads (`/admin/audit?actor=`, `/admin/audit?action=`)
--    want covering sorts; add two partial composites.
-- =============================================================
create index if not exists audit_log_actor_time_idx
  on public.audit_log(actor_id, occurred_at desc)
  where actor_id is not null;
create index if not exists audit_log_action_time_idx
  on public.audit_log(action, occurred_at desc);


-- =============================================================
-- 7) Post-migration verification (comments only)
-- =============================================================
--   -- all six new/extended tables with RLS on
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public'
--     and tablename in ('vet_share_tokens','pending_hubspot_syncs',
--                       'hubspot_sync_log','support_tickets',
--                       'order_refunds','audit_log');
--
--   -- zero rows to start
--   select (select count(*) from public.vet_share_tokens)      as vet_tokens,
--          (select count(*) from public.pending_hubspot_syncs) as pending_hs,
--          (select count(*) from public.hubspot_sync_log)      as hs_log,
--          (select count(*) from public.support_tickets)       as tickets,
--          (select count(*) from public.order_refunds)         as refunds;
--
--   -- composite audit indexes exist
--   select indexname from pg_indexes
--   where schemaname='public' and tablename='audit_log'
--     and indexname in ('audit_log_actor_time_idx','audit_log_action_time_idx');
