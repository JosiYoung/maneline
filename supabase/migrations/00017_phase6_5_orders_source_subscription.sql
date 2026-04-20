-- =============================================================
-- Mane Line — Phase 6.5 (admin subscriptions panel)
-- Migration: 00017_phase6_5_orders_source_subscription.sql
-- Date:      2026-04-20
--
-- Reference: docs/phase-6-plan.md §2 sub-prompt 6.5 — when a
-- Stripe subscription invoice.payment_succeeded webhook fires we
-- insert an `orders` row with `source='subscription'` so the
-- GMV/attach-rate math from Phase 5.2 stays correct. Previously
-- `orders.source` only accepted ('shop','in_expense','chat')
-- (see 00012_phase4_protocol_brain.sql §9).
--
-- Extends the CHECK to allow 'subscription'. Idempotent.
-- =============================================================

alter table public.orders
  drop constraint if exists orders_source_check;

alter table public.orders
  add constraint orders_source_check
  check (source in ('shop','in_expense','chat','subscription'));


-- =============================================================
-- 2) orders.stripe_invoice_id + orders.stripe_subscription_id
--    The invoice.payment_succeeded webhook inserts one orders row
--    per Stripe Invoice. We stamp both the invoice id (for
--    idempotency — unique constraint) and the parent subscription id
--    (for the /admin/subscriptions/:id drill-in to list the
--    subscription's invoices from the cached orders table as a
--    side channel to Stripe's own invoices.list).
-- =============================================================
alter table public.orders
  add column if not exists stripe_invoice_id      text,
  add column if not exists stripe_subscription_id text;

create unique index if not exists orders_stripe_invoice_id_key
  on public.orders(stripe_invoice_id)
  where stripe_invoice_id is not null;

create index if not exists orders_stripe_subscription_id_idx
  on public.orders(stripe_subscription_id, created_at desc)
  where stripe_subscription_id is not null;


-- Verification (comment only):
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.orders'::regclass
--     and conname  = 'orders_source_check';
--
--   select column_name, data_type
--   from information_schema.columns
--   where table_name='orders'
--     and column_name in ('stripe_invoice_id','stripe_subscription_id');
