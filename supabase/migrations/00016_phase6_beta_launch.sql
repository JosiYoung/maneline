-- =============================================================
-- Mane Line — Phase 6 (Closed Beta Launch Hardening)
-- Migration: 00016_phase6_beta_launch.sql
-- Date:      2026-04-20
--
-- Reference: docs/phase-6-plan.md §2 sub-prompt 6.1.
--
-- What this migration does (in order):
--   1) invitations          — magic-link + PIN onboarding queue (#3)
--   2) on_call_schedule     — admin SMS roster (#4/#5)
--   3) sms_dispatches       — append-only Twilio send ledger (#5)
--   4) stripe_subscriptions — Stripe subs read-through cache (#9)
--
-- Compliance:
--   OAG §2 — service_role-write on every table; admin reads through
--            the Worker, owner reads limited to their own invites.
--   OAG §3 — audit_log rows are written by Worker handlers; no
--            schema changes to audit_log here.
--   OAG §7 — RLS enabled day one with policies defined up front.
--   OAG §8 — archive-never-delete: every table carries archived_at
--            (sms_dispatches is append-only + never archived — it is
--            a permanent send ledger); DELETE revoked on all.
--
-- Safe to re-run: every statement is `if not exists` / `if exists`.
-- =============================================================


-- Required for EXCLUDE constraint on on_call_schedule (range && range).
-- tstzrange has native gist support; no btree_gist needed.
create extension if not exists btree_gist;


-- =============================================================
-- 1) invitations
--    Closed-beta + open-beta onboarding queue. One row per
--    email+open-invite; accepting flips accepted_at + links to
--    accepted_user_id. Worker is the only writer.
-- =============================================================
create table if not exists public.invitations (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null check (char_length(email) between 3 and 320),
  role                text not null check (role in ('owner','trainer')),
  barn_name           text,
  token               text not null,
  invited_by          uuid references auth.users(id) on delete set null,
  invited_at          timestamptz not null default now(),
  accepted_at         timestamptz,
  accepted_user_id    uuid references auth.users(id) on delete set null,
  expires_at          timestamptz not null default (now() + interval '14 days'),
  archived_at         timestamptz,
  batch               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists invitations_token_unique
  on public.invitations(token);
-- Only one open invite per email at a time (allows re-invites after accept).
create unique index if not exists invitations_email_open_unique
  on public.invitations(lower(email))
  where accepted_at is null and archived_at is null;
create index if not exists invitations_accepted_idx
  on public.invitations(accepted_at desc)
  where accepted_at is not null;
create index if not exists invitations_expires_idx
  on public.invitations(expires_at)
  where accepted_at is null and archived_at is null;
create index if not exists invitations_batch_idx
  on public.invitations(batch, created_at desc)
  where batch is not null;

alter table public.invitations enable row level security;

-- Owners can see their own accepted invite row (post-login).
drop policy if exists "invitations_self_select" on public.invitations;
create policy "invitations_self_select" on public.invitations
  for select using (
    accepted_user_id is not null and accepted_user_id = auth.uid()
  );

revoke insert, update, delete on public.invitations from anon, authenticated;

drop trigger if exists invitations_touch on public.invitations;
create trigger invitations_touch before update on public.invitations
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 2) on_call_schedule
--    Admin-only SMS roster. Exclusion constraint prevents two
--    active (non-archived) rows from overlapping — so the Worker
--    `select ... where now() between starts_at and ends_at`
--    always returns at most one row.
-- =============================================================
create table if not exists public.on_call_schedule (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  phone_e164    text not null check (phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  notes         text,
  archived_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at),
  constraint on_call_schedule_no_overlap
    exclude using gist (
      tstzrange(starts_at, ends_at, '[)') with &&
    ) where (archived_at is null)
);

create index if not exists on_call_schedule_active_idx
  on public.on_call_schedule(starts_at, ends_at)
  where archived_at is null;
create index if not exists on_call_schedule_user_idx
  on public.on_call_schedule(user_id, starts_at desc)
  where archived_at is null;

alter table public.on_call_schedule enable row level security;
revoke all on public.on_call_schedule from anon, authenticated;

drop trigger if exists on_call_schedule_touch on public.on_call_schedule;
create trigger on_call_schedule_touch before update on public.on_call_schedule
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 3) sms_dispatches
--    Append-only send ledger. Every Twilio messages.create call
--    writes one row; the /webhooks/twilio-status handler updates
--    status + delivered_at + error_code. No archived_at — this is
--    a permanent billing/compliance record.
-- =============================================================
create table if not exists public.sms_dispatches (
  id                    uuid primary key default gen_random_uuid(),
  ticket_id             uuid references public.support_tickets(id) on delete set null,
  to_phone              text not null check (to_phone ~ '^\+[1-9][0-9]{6,14}$'),
  on_call_user_id       uuid references auth.users(id) on delete set null,
  twilio_message_sid    text,
  body                  text not null check (char_length(body) between 1 and 1600),
  status                text not null default 'queued'
                          check (status in (
                            'queued','sent','delivered','failed','undelivered'
                          )),
  error_code            int,
  cost_cents            int check (cost_cents is null or cost_cents >= 0),
  sent_at               timestamptz,
  delivered_at          timestamptz,
  created_at            timestamptz not null default now()
);

create unique index if not exists sms_dispatches_sid_unique
  on public.sms_dispatches(twilio_message_sid)
  where twilio_message_sid is not null;
create index if not exists sms_dispatches_ticket_idx
  on public.sms_dispatches(ticket_id, created_at desc)
  where ticket_id is not null;
create index if not exists sms_dispatches_status_idx
  on public.sms_dispatches(status, created_at desc);
create index if not exists sms_dispatches_recent_idx
  on public.sms_dispatches(created_at desc);

alter table public.sms_dispatches enable row level security;
revoke all on public.sms_dispatches from anon, authenticated;


-- =============================================================
-- 4) stripe_subscriptions
--    Read-through cache of Stripe subscriptions for the 20 beta
--    owners. Source of truth = Stripe; rows here are refreshed
--    by customer.subscription.* webhooks. items jsonb preserves
--    the Stripe item list (price_id + qty) for admin display.
-- =============================================================
create table if not exists public.stripe_subscriptions (
  id                     text primary key,
  owner_id               uuid references auth.users(id) on delete set null,
  customer_id            text not null,
  status                 text not null check (status in (
                           'incomplete','incomplete_expired','trialing',
                           'active','past_due','canceled','unpaid','paused'
                         )),
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  items                  jsonb not null default '[]'::jsonb,
  last_synced_at         timestamptz not null default now(),
  archived_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists stripe_subscriptions_owner_idx
  on public.stripe_subscriptions(owner_id, created_at desc)
  where owner_id is not null;
create index if not exists stripe_subscriptions_active_idx
  on public.stripe_subscriptions(status, current_period_end)
  where archived_at is null;
create index if not exists stripe_subscriptions_customer_idx
  on public.stripe_subscriptions(customer_id, created_at desc);

alter table public.stripe_subscriptions enable row level security;

-- Owners can read their own subscription rows.
drop policy if exists "stripe_subscriptions_owner_select" on public.stripe_subscriptions;
create policy "stripe_subscriptions_owner_select" on public.stripe_subscriptions
  for select using (
    owner_id is not null and owner_id = auth.uid()
  );

revoke insert, update, delete on public.stripe_subscriptions from anon, authenticated;

drop trigger if exists stripe_subscriptions_touch on public.stripe_subscriptions;
create trigger stripe_subscriptions_touch before update on public.stripe_subscriptions
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 5) user_profiles.welcome_tour_seen_at
--    One-shot dismissible welcome tour on first /app or /trainer
--    load (feature #2). NULL = never dismissed; timestamp = seen.
-- =============================================================
alter table public.user_profiles
  add column if not exists welcome_tour_seen_at timestamptz;


-- =============================================================
-- 6) Post-migration verification (comments only)
-- =============================================================
--   -- RLS on every new table
--   select tablename, rowsecurity from pg_tables
--   where schemaname='public'
--     and tablename in ('invitations','on_call_schedule',
--                       'sms_dispatches','stripe_subscriptions');
--
--   -- Zero rows to start
--   select (select count(*) from public.invitations)          as invites,
--          (select count(*) from public.on_call_schedule)     as on_call,
--          (select count(*) from public.sms_dispatches)       as dispatches,
--          (select count(*) from public.stripe_subscriptions) as subs;
--
--   -- Exclusion constraint rejects overlap:
--   --   insert into on_call_schedule (user_id, phone_e164, starts_at, ends_at)
--   --   values (<u>, '+15555550100', now(), now() + interval '7 days');
--   --   insert into on_call_schedule (user_id, phone_e164, starts_at, ends_at)
--   --   values (<u2>, '+15555550101', now() + interval '1 day', now() + interval '2 days');
--   --   -- ^ must raise "conflicting key value violates exclusion constraint"
