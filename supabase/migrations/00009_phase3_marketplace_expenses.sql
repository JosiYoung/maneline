-- =============================================================
-- Mane Line — Phase 3 (Shopify Marketplace + Stripe Checkout + Expenses)
-- Migration: 00009_phase3_marketplace_expenses.sql
-- Date:      2026-04-17
--
-- Creates the data model behind Phase 3 Prompt 3.1:
--   • products                 — Silver Lining catalog cache (Shopify source of truth)
--   • shopify_sync_cursor      — singleton sync state for shopify-catalog-sync
--   • orders                   — owner purchases via Stripe Checkout (hosted)
--   • order_line_items         — immutable snapshot of SKUs at purchase time
--   • expenses                 — per-animal cost log (owner or trainer authored)
--   • expense_archive_events   — append-only audit of soft-archive transitions
--
-- Naming note (deviation from phase-3-plan.md):
--   The plan calls for 00007_phase3_marketplace_expenses.sql. Phase 2
--   hotfixes consumed 00007 (trainer roster policy) and 00008 (trainer
--   r2 select). This migration is numbered 00009 to preserve order.
--
-- Stripe Connect routing (see docs/phase-3-plan.md §6 decision #1):
--   SLH is onboarded as a Connect account. Worker mints Checkout
--   Sessions on the platform account with transfer_data.destination =
--   SLH_CONNECT_ACCOUNT_ID and application_fee_amount = 0. If SLH has
--   not yet onboarded, the orders row lands with
--   status='awaiting_merchant_setup' (same pattern as Phase 2's
--   awaiting_trainer_setup).
--
-- Compliance:
--   OAG §2 — admin writes (products sync, orders lifecycle, line
--            items, sync cursor) are service_role only.
--   OAG §7 — RLS on every table day one.
--   OAG §8 — archive-never-delete on products + expenses; status
--            lifecycles on orders; expense_archive_events audits
--            every archive/unarchive.
--
-- Safe to re-run: idempotent creates + drop-if-exists on policies,
-- create-or-replace on functions, revoke is no-op if grant absent.
-- =============================================================


-- =============================================================
-- 1) products
--    Silver Lining catalog cache. Shopify is the source of truth;
--    the shopify-catalog-sync Edge Function upserts by
--    shopify_product_id and soft-archives rows that disappear from
--    the Storefront feed (availability=false + archived_at=now()).
-- =============================================================
create table if not exists public.products (
  id                     uuid primary key default gen_random_uuid(),
  shopify_product_id     text not null unique,
  shopify_variant_id     text not null unique,
  handle                 text not null unique,
  sku                    text not null,
  title                  text not null check (char_length(title) between 1 and 300),
  description            text,
  image_url              text,
  price_cents            int not null check (price_cents >= 0),
  currency               text not null default 'usd' check (currency = 'usd'),
  category               text,
  inventory_qty          int,
  available              boolean not null default true,
  protocol_mapping       jsonb,
  last_synced_at         timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  archived_at            timestamptz
);

create index if not exists products_archived_category_idx
  on public.products(archived_at, category)
  where archived_at is null;
create index if not exists products_available_idx
  on public.products(available)
  where archived_at is null;

alter table public.products enable row level security;

-- Any signed-in user (owner or trainer) can read the live catalog.
drop policy if exists "products_authenticated_select" on public.products;
create policy "products_authenticated_select" on public.products
  for select
  to authenticated
  using (archived_at is null);

-- Unauthenticated visitors never read SLH inventory via Supabase.
revoke all on public.products from anon;
revoke insert, update, delete on public.products from authenticated;


-- =============================================================
-- 2) shopify_sync_cursor (singleton)
--    No client access. shopify-catalog-sync writes via service_role.
-- =============================================================
create table if not exists public.shopify_sync_cursor (
  id                  int primary key default 1 check (id = 1),
  last_run_at         timestamptz,
  last_ok_at          timestamptz,
  last_error          text,
  products_upserted   int not null default 0,
  products_archived   int not null default 0,
  updated_at          timestamptz not null default now()
);

-- Seed the singleton. Safe on re-run.
insert into public.shopify_sync_cursor (id) values (1)
  on conflict (id) do nothing;

alter table public.shopify_sync_cursor enable row level security;

drop policy if exists "shopify_sync_cursor_no_client_access" on public.shopify_sync_cursor;
create policy "shopify_sync_cursor_no_client_access" on public.shopify_sync_cursor
  for select using (false);

revoke all on public.shopify_sync_cursor from anon, authenticated;


-- =============================================================
-- 3) orders
--    Owner purchases of SLH products via Stripe Checkout.
--    Status lifecycle:
--      pending_payment        — row created alongside Checkout Session
--      paid                   — checkout.session.completed webhook
--      failed                 — checkout.session.async_payment_failed
--      refunded               — Phase 5 admin refund flow
--      awaiting_merchant_setup — SLH Connect not yet onboarded
-- =============================================================
create table if not exists public.orders (
  id                            uuid primary key default gen_random_uuid(),
  owner_id                      uuid not null references auth.users(id),
  stripe_checkout_session_id    text unique,
  stripe_payment_intent_id      text unique,
  stripe_charge_id              text,
  shopify_order_id              text unique,
  subtotal_cents                int not null check (subtotal_cents > 0),
  tax_cents                     int not null default 0 check (tax_cents >= 0),
  shipping_cents                int not null default 0 check (shipping_cents >= 0),
  total_cents                   int not null check (total_cents > 0),
  currency                      text not null default 'usd' check (currency = 'usd'),
  status                        text not null default 'pending_payment' check (status in (
                                  'pending_payment','paid','failed','refunded','awaiting_merchant_setup'
                                )),
  failure_code                  text,
  failure_message               text,
  source                        text not null default 'shop' check (source in ('shop','in_expense')),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists orders_owner_created_idx
  on public.orders(owner_id, created_at desc);
create index if not exists orders_pending_idx
  on public.orders(status)
  where status in ('pending_payment','awaiting_merchant_setup');

alter table public.orders enable row level security;

drop policy if exists "orders_owner_select" on public.orders;
create policy "orders_owner_select" on public.orders
  for select using (owner_id = auth.uid());

revoke insert, update, delete on public.orders from anon, authenticated;


-- =============================================================
-- 4) order_line_items
--    Immutable snapshot of SKUs at purchase time. product_id is
--    nullable so order history keeps resolving even if the product
--    is later archived.
-- =============================================================
create table if not exists public.order_line_items (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete cascade,
  product_id           uuid references public.products(id),
  shopify_variant_id   text not null,
  sku_snapshot         text not null,
  title_snapshot       text not null,
  unit_price_cents     int not null check (unit_price_cents >= 0),
  quantity             int not null check (quantity > 0),
  line_total_cents     int not null check (line_total_cents >= 0),
  created_at           timestamptz not null default now()
);

create index if not exists order_line_items_order_idx
  on public.order_line_items(order_id);

alter table public.order_line_items enable row level security;

drop policy if exists "order_line_items_owner_select" on public.order_line_items;
create policy "order_line_items_owner_select" on public.order_line_items
  for select using (
    exists (
      select 1 from public.orders o
      where o.id = order_line_items.order_id
        and o.owner_id = auth.uid()
    )
  );

revoke insert, update, delete on public.order_line_items from anon, authenticated;


-- =============================================================
-- 5) expenses
--    Per-animal expense log. Owner OR granted-trainer can insert.
--    RLS splits access by recorder_role; no DELETE from any role.
-- =============================================================
create table if not exists public.expenses (
  id                      uuid primary key default gen_random_uuid(),
  animal_id               uuid not null references public.animals(id) on delete cascade,
  recorder_id             uuid not null references auth.users(id),
  recorder_role           text not null check (recorder_role in ('owner','trainer')),
  category                text not null check (category in (
                            'feed','tack','vet','board','farrier','supplement','travel','show','other'
                          )),
  occurred_on             date not null,
  amount_cents            int not null check (amount_cents > 0),
  currency                text not null default 'usd' check (currency = 'usd'),
  vendor                  text,
  notes                   text,
  order_id                uuid references public.orders(id),
  product_id              uuid references public.products(id),
  receipt_r2_object_id    uuid references public.r2_objects(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  archived_at             timestamptz
);

create index if not exists expenses_animal_occurred_idx
  on public.expenses(animal_id, occurred_on desc)
  where archived_at is null;
create index if not exists expenses_recorder_occurred_idx
  on public.expenses(recorder_id, occurred_on desc)
  where archived_at is null;
create index if not exists expenses_category_occurred_idx
  on public.expenses(category, occurred_on desc)
  where archived_at is null;

alter table public.expenses enable row level security;

-- Owner SELECT: they own the animal.
drop policy if exists "expenses_owner_select" on public.expenses;
create policy "expenses_owner_select" on public.expenses
  for select using (
    exists (
      select 1 from public.animals a
      where a.id = expenses.animal_id
        and a.owner_id = auth.uid()
    )
  );

-- Trainer SELECT: active grant on the animal.
drop policy if exists "expenses_trainer_select" on public.expenses;
create policy "expenses_trainer_select" on public.expenses
  for select using (
    public.do_i_have_access_to_animal(animal_id)
  );

-- Owner INSERT: must own animal, must stamp own uid as owner recorder.
drop policy if exists "expenses_owner_insert" on public.expenses;
create policy "expenses_owner_insert" on public.expenses
  for insert with check (
    recorder_role = 'owner'
    and recorder_id = auth.uid()
    and exists (
      select 1 from public.animals a
      where a.id = expenses.animal_id
        and a.owner_id = auth.uid()
    )
  );

-- Owner UPDATE: may edit their own rows on animals they still own.
drop policy if exists "expenses_owner_update" on public.expenses;
create policy "expenses_owner_update" on public.expenses
  for update
  using (
    recorder_role = 'owner'
    and recorder_id = auth.uid()
    and exists (
      select 1 from public.animals a
      where a.id = expenses.animal_id
        and a.owner_id = auth.uid()
    )
  )
  with check (
    recorder_role = 'owner'
    and recorder_id = auth.uid()
  );

-- Trainer INSERT: grant active, row stamped as trainer recorder.
drop policy if exists "expenses_trainer_insert" on public.expenses;
create policy "expenses_trainer_insert" on public.expenses
  for insert with check (
    recorder_role = 'trainer'
    and recorder_id = auth.uid()
    and public.do_i_have_access_to_animal(animal_id)
  );

-- Trainer UPDATE: may edit rows they authored on animals they still access.
drop policy if exists "expenses_trainer_update" on public.expenses;
create policy "expenses_trainer_update" on public.expenses
  for update
  using (
    recorder_role = 'trainer'
    and recorder_id = auth.uid()
    and public.do_i_have_access_to_animal(animal_id)
  )
  with check (
    recorder_role = 'trainer'
    and recorder_id = auth.uid()
  );

revoke delete on public.expenses from anon, authenticated;


-- =============================================================
-- 6) expense_archive_events
--    Append-only audit of soft-archive transitions on expenses.
--    Written by the Worker (service_role) after UPDATE succeeds.
-- =============================================================
create table if not exists public.expense_archive_events (
  id           uuid primary key default gen_random_uuid(),
  expense_id   uuid not null references public.expenses(id) on delete cascade,
  actor_id     uuid not null references auth.users(id),
  action       text not null check (action in ('archive','unarchive')),
  reason       text,
  created_at   timestamptz not null default now()
);

create index if not exists expense_archive_events_expense_idx
  on public.expense_archive_events(expense_id, created_at desc);

alter table public.expense_archive_events enable row level security;

-- Owner SELECT: the expense is on one of their animals.
drop policy if exists "expense_archive_events_owner_select" on public.expense_archive_events;
create policy "expense_archive_events_owner_select" on public.expense_archive_events
  for select using (
    exists (
      select 1
      from public.expenses e
      join public.animals a on a.id = e.animal_id
      where e.id = expense_archive_events.expense_id
        and a.owner_id = auth.uid()
    )
  );

-- Trainer SELECT: grant active on the animal behind the expense.
drop policy if exists "expense_archive_events_trainer_select" on public.expense_archive_events;
create policy "expense_archive_events_trainer_select" on public.expense_archive_events
  for select using (
    exists (
      select 1
      from public.expenses e
      where e.id = expense_archive_events.expense_id
        and public.do_i_have_access_to_animal(e.animal_id)
    )
  );

revoke insert, update, delete on public.expense_archive_events from anon, authenticated;


-- =============================================================
-- 7) updated_at triggers (reuses public.touch_updated_at from baseline)
-- =============================================================
drop trigger if exists products_touch_updated_at on public.products;
create trigger products_touch_updated_at
  before update on public.products
  for each row execute function public.touch_updated_at();

drop trigger if exists shopify_sync_cursor_touch_updated_at on public.shopify_sync_cursor;
create trigger shopify_sync_cursor_touch_updated_at
  before update on public.shopify_sync_cursor
  for each row execute function public.touch_updated_at();

drop trigger if exists orders_touch_updated_at on public.orders;
create trigger orders_touch_updated_at
  before update on public.orders
  for each row execute function public.touch_updated_at();

drop trigger if exists expenses_touch_updated_at on public.expenses;
create trigger expenses_touch_updated_at
  before update on public.expenses
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 8) Helpers
-- =============================================================

-- is_expense_owner_or_granted_trainer — shared check used by the
-- archive endpoint (Prompt 3.7). True when the caller is either the
-- expense's animal owner OR a trainer with an active grant.
create or replace function public.is_expense_owner_or_granted_trainer(p_expense_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.expenses e
    join public.animals a on a.id = e.animal_id
    where e.id = p_expense_id
      and (
        a.owner_id = auth.uid()
        or public.do_i_have_access_to_animal(e.animal_id)
      )
  );
$$;

grant execute on function public.is_expense_owner_or_granted_trainer(uuid)
  to authenticated, service_role;

-- products_public_count — live catalog size. Used by
-- /api/_integrations-health to flip shopify to "live" when > 0.
create or replace function public.products_public_count()
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::int
  from public.products
  where archived_at is null
    and available = true;
$$;

grant execute on function public.products_public_count()
  to authenticated, service_role;


-- =============================================================
-- 9) Post-apply verification (run in SQL Editor):
--
--   -- a. Every Phase 3 table has RLS enabled:
--   select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on c.relnamespace = n.oid
--   where n.nspname = 'public'
--     and c.relname in (
--       'products','shopify_sync_cursor','orders','order_line_items',
--       'expenses','expense_archive_events'
--     );
--   -- Expect: all 6 rows with relrowsecurity = true.
--
--   -- b. shopify_sync_cursor has exactly one row:
--   select count(*) from public.shopify_sync_cursor;
--   -- Expect: 1
--
--   -- c. Anon cannot read products; authenticated can:
--   set role anon;          select count(*) from public.products;  -- Expect: 0
--   set role authenticated; select count(*) from public.products;  -- Expect: live rows
--   reset role;
--
--   -- d. Anon/authenticated cannot read shopify_sync_cursor or
--   --    modify products/orders/order_line_items:
--   set role authenticated;
--   select * from public.shopify_sync_cursor;  -- Expect: 0 rows
--   insert into public.products (shopify_product_id, shopify_variant_id,
--     handle, sku, title, price_cents) values ('x','y','z','w','t',1);
--   -- Expect: permission denied for table products
--   reset role;
--
--   -- e. Policy count (>= 8 across the 6 tables):
--   select tablename, count(*) as policy_count
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in (
--       'products','shopify_sync_cursor','orders','order_line_items',
--       'expenses','expense_archive_events'
--     )
--   group by tablename order by tablename;
--   -- Expect: products 1, shopify_sync_cursor 1, orders 1,
--   --         order_line_items 1, expenses 5, expense_archive_events 2.
--   --         Total = 11.
--
--   -- f. Helpers return sane defaults on empty DB:
--   select public.products_public_count();  -- Expect: 0 pre-sync
-- =============================================================
