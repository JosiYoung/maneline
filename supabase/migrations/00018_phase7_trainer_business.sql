-- =============================================================
-- Mane Line — Phase 7 (Trainer Business Dashboard + White-Label Invoices)
-- Migration: 00018_phase7_trainer_business.sql
-- Date:      2026-04-20
--
-- Creates the data model behind Phase 7:
--   • trainer_invoice_settings  — per-trainer defaults (net days, auto-finalize day, footer)
--   • trainer_customer_map      — (trainer, owner|adhoc email) -> Stripe Customer on Connect acct
--   • trainer_goals             — monthly revenue + hours targets
--   • recurring_line_items      — board/etc. templates auto-prefilled into monthly invoices
--   • invoices                  — trainer-issued invoices (Stripe Connect direct charges)
--   • invoice_line_items        — line items (session, expense, recurring, custom)
--
-- Column adds:
--   • training_sessions.billable              — default true; unbilled sessions excluded
--   • expenses.billable_to_owner              — trainer fronted cost; bill to owner
--   • expenses.markup_bps                     — optional markup when billing back
--   • expenses.tax_rate_bps                   — per-line tax rate (no Stripe Tax v1)
--   • animal_access_grants.billing_mode       — per_session (default) | monthly_invoice
--   • trainer_profiles.invoice_logo_r2_key    — R2 public-bucket key for branded invoice logo
--   • trainer_profiles.invoice_timezone       — IANA tz for monthly period calc (America/Chicago fallback)
--
-- Billing model (Phase 7 plan sign-off):
--   Trainers bill owners in one of two modes per animal_access_grant:
--     per_session    — current flow; Stripe PaymentIntent per approved session
--     monthly_invoice— sessions+expenses+recurring pile into a draft invoice; cron
--                      auto-finalizes on trainer_invoice_settings.auto_finalize_day
--   Direct charges on trainer's Connect account (white-label); platform fee via
--   application_fee_amount computed with effective_fee_bps().
--
-- Compliance:
--   OAG §2 — Stripe writes (invoice finalize/send, customer create, webhook
--            sync) are service_role only via Worker.
--   OAG §7 — RLS on every new table day one.
--   OAG §8 — invoices are voided, never deleted; expenses stay archive-only;
--            recurring_line_items flip active=false rather than delete.
--
-- Safe to re-run: idempotent creates + drop-if-exists on policies,
-- create-or-replace on functions, add-column-if-not-exists.
-- =============================================================


-- =============================================================
-- 1) trainer_invoice_settings
--    One row per trainer. Created lazily by the Worker on first
--    branding/goal write. Carries the defaults the auto-finalize
--    cron reads.
-- =============================================================
create table if not exists public.trainer_invoice_settings (
  trainer_id            uuid primary key references auth.users(id) on delete cascade,
  default_due_net_days  int not null default 15 check (default_due_net_days between 0 and 120),
  auto_finalize_day     int not null default 1  check (auto_finalize_day between 1 and 28),
  footer_memo           text check (footer_memo is null or char_length(footer_memo) <= 500),
  brand_hex             text check (brand_hex is null or brand_hex ~ '^#[0-9a-fA-F]{6}$'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.trainer_invoice_settings enable row level security;

drop policy if exists "trainer_invoice_settings_select_own" on public.trainer_invoice_settings;
create policy "trainer_invoice_settings_select_own" on public.trainer_invoice_settings
  for select using (trainer_id = auth.uid());

drop policy if exists "trainer_invoice_settings_insert_own" on public.trainer_invoice_settings;
create policy "trainer_invoice_settings_insert_own" on public.trainer_invoice_settings
  for insert with check (trainer_id = auth.uid());

drop policy if exists "trainer_invoice_settings_update_own" on public.trainer_invoice_settings;
create policy "trainer_invoice_settings_update_own" on public.trainer_invoice_settings
  for update using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

revoke delete on public.trainer_invoice_settings from anon, authenticated;


-- =============================================================
-- 2) trainer_customer_map
--    (trainer, owner|adhoc_email) -> Stripe Customer on Connect.
--    Populated lazily by Worker on first invoice.
--    Service_role writes; trainer reads own rows.
-- =============================================================
create table if not exists public.trainer_customer_map (
  id                  uuid primary key default gen_random_uuid(),
  trainer_id          uuid not null references auth.users(id) on delete cascade,
  owner_id            uuid references auth.users(id) on delete set null,
  adhoc_email         text,
  stripe_customer_id  text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint trainer_customer_map_subject_check check (
    (owner_id is not null and adhoc_email is null)
    or (owner_id is null and adhoc_email is not null)
  )
);

create unique index if not exists trainer_customer_map_owner_uniq
  on public.trainer_customer_map(trainer_id, owner_id)
  where owner_id is not null;
create unique index if not exists trainer_customer_map_adhoc_uniq
  on public.trainer_customer_map(trainer_id, lower(adhoc_email))
  where adhoc_email is not null;

alter table public.trainer_customer_map enable row level security;

drop policy if exists "trainer_customer_map_trainer_select" on public.trainer_customer_map;
create policy "trainer_customer_map_trainer_select" on public.trainer_customer_map
  for select using (trainer_id = auth.uid());

revoke insert, update, delete on public.trainer_customer_map from anon, authenticated;


-- =============================================================
-- 3) trainer_goals
--    One row per (trainer, month). Month stored as the first day
--    (date) of that calendar month in the trainer's timezone.
-- =============================================================
create table if not exists public.trainer_goals (
  id                    uuid primary key default gen_random_uuid(),
  trainer_id            uuid not null references auth.users(id) on delete cascade,
  month                 date not null,
  revenue_target_cents  int check (revenue_target_cents is null or revenue_target_cents >= 0),
  hours_target          numeric(6,2) check (hours_target is null or hours_target >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint trainer_goals_month_is_first check (extract(day from month) = 1),
  constraint trainer_goals_unique_month unique (trainer_id, month)
);

create index if not exists trainer_goals_trainer_month_idx
  on public.trainer_goals(trainer_id, month desc);

alter table public.trainer_goals enable row level security;

drop policy if exists "trainer_goals_select_own" on public.trainer_goals;
create policy "trainer_goals_select_own" on public.trainer_goals
  for select using (trainer_id = auth.uid());

drop policy if exists "trainer_goals_insert_own" on public.trainer_goals;
create policy "trainer_goals_insert_own" on public.trainer_goals
  for insert with check (trainer_id = auth.uid());

drop policy if exists "trainer_goals_update_own" on public.trainer_goals;
create policy "trainer_goals_update_own" on public.trainer_goals
  for update using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

revoke delete on public.trainer_goals from anon, authenticated;


-- =============================================================
-- 4) recurring_line_items
--    Board / standing-charge templates. Auto-prefill into each
--    monthly draft invoice for the matching trainer+client.
--    active=false to retire; no hard delete.
-- =============================================================
create table if not exists public.recurring_line_items (
  id              uuid primary key default gen_random_uuid(),
  trainer_id      uuid not null references auth.users(id) on delete cascade,
  owner_id        uuid references auth.users(id) on delete set null,
  adhoc_email     text,
  description     text not null check (char_length(description) between 1 and 200),
  amount_cents    int not null check (amount_cents > 0),
  animal_id       uuid references public.animals(id) on delete set null,
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint recurring_line_items_subject_check check (
    (owner_id is not null and adhoc_email is null)
    or (owner_id is null and adhoc_email is not null)
  )
);

create index if not exists recurring_line_items_trainer_owner_idx
  on public.recurring_line_items(trainer_id, owner_id)
  where active = true;
create index if not exists recurring_line_items_trainer_adhoc_idx
  on public.recurring_line_items(trainer_id, lower(adhoc_email))
  where active = true and adhoc_email is not null;

alter table public.recurring_line_items enable row level security;

drop policy if exists "recurring_line_items_trainer_select" on public.recurring_line_items;
create policy "recurring_line_items_trainer_select" on public.recurring_line_items
  for select using (trainer_id = auth.uid());

drop policy if exists "recurring_line_items_trainer_insert" on public.recurring_line_items;
create policy "recurring_line_items_trainer_insert" on public.recurring_line_items
  for insert with check (trainer_id = auth.uid());

drop policy if exists "recurring_line_items_trainer_update" on public.recurring_line_items;
create policy "recurring_line_items_trainer_update" on public.recurring_line_items
  for update using (trainer_id = auth.uid()) with check (trainer_id = auth.uid());

revoke delete on public.recurring_line_items from anon, authenticated;


-- =============================================================
-- 5) invoices
--    Trainer-issued invoices. Lifecycle:
--      draft -> open (finalized, sent) -> paid | void | uncollectible
--      overdue derived from due_date + status='open' (view/logic, not a terminal status)
--    Stripe fields populated by the Worker after finalize; our row
--    is the audit trail + app-side search surface.
-- =============================================================
create table if not exists public.invoices (
  id                          uuid primary key default gen_random_uuid(),
  trainer_id                  uuid not null references auth.users(id) on delete cascade,
  owner_id                    uuid references auth.users(id) on delete set null,
  adhoc_name                  text,
  adhoc_email                 text,
  stripe_invoice_id           text unique,
  stripe_customer_id          text,
  stripe_hosted_invoice_url   text,
  stripe_invoice_pdf_url      text,
  invoice_number              text,
  status                      text not null default 'draft' check (status in (
                                'draft','open','paid','void','uncollectible'
                              )),
  period_start                date,
  period_end                  date,
  due_date                    date not null,
  subtotal_cents              int not null default 0 check (subtotal_cents >= 0),
  tax_cents                   int not null default 0 check (tax_cents >= 0),
  total_cents                 int not null default 0 check (total_cents >= 0),
  amount_paid_cents           int not null default 0 check (amount_paid_cents >= 0),
  platform_fee_cents          int not null default 0 check (platform_fee_cents >= 0),
  currency                    text not null default 'usd' check (currency = 'usd'),
  notes                       text check (notes is null or char_length(notes) <= 2000),
  sent_at                     timestamptz,
  paid_at                     timestamptz,
  voided_at                   timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint invoices_subject_check check (
    (owner_id is not null and adhoc_email is null and adhoc_name is null)
    or (owner_id is null and adhoc_email is not null and adhoc_name is not null)
  ),
  constraint invoices_period_check check (
    (period_start is null and period_end is null)
    or (period_start is not null and period_end is not null and period_end >= period_start)
  )
);

create index if not exists invoices_trainer_status_idx
  on public.invoices(trainer_id, status, created_at desc);
create index if not exists invoices_trainer_period_idx
  on public.invoices(trainer_id, period_start)
  where period_start is not null;
create index if not exists invoices_owner_idx
  on public.invoices(owner_id, created_at desc)
  where owner_id is not null;
create index if not exists invoices_draft_monthly_idx
  on public.invoices(trainer_id, owner_id, period_start)
  where status = 'draft' and period_start is not null;

alter table public.invoices enable row level security;

drop policy if exists "invoices_trainer_select" on public.invoices;
create policy "invoices_trainer_select" on public.invoices
  for select using (trainer_id = auth.uid());

drop policy if exists "invoices_owner_select" on public.invoices;
create policy "invoices_owner_select" on public.invoices
  for select using (owner_id is not null and owner_id = auth.uid());

drop policy if exists "invoices_trainer_insert" on public.invoices;
create policy "invoices_trainer_insert" on public.invoices
  for insert with check (
    trainer_id = auth.uid()
    and status = 'draft'
    and stripe_invoice_id is null
    and sent_at is null
    and paid_at is null
    and voided_at is null
  );

-- Trainer may only edit drafts. Finalize/send/void transitions go
-- through the Worker (service_role) so Stripe + our row stay in sync.
drop policy if exists "invoices_trainer_update_draft" on public.invoices;
create policy "invoices_trainer_update_draft" on public.invoices
  for update
  using (trainer_id = auth.uid() and status = 'draft')
  with check (trainer_id = auth.uid() and status = 'draft');

revoke delete on public.invoices from anon, authenticated;


-- =============================================================
-- 6) invoice_line_items
--    Snapshot of what was billed. source_id references the
--    originating row (session/expense/recurring) for audit, but
--    description + amount are stored denormalized so historical
--    invoices don't mutate when source rows change.
-- =============================================================
create table if not exists public.invoice_line_items (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id) on delete cascade,
  kind              text not null check (kind in ('session','expense','recurring','custom')),
  source_id         uuid,
  description       text not null check (char_length(description) between 1 and 300),
  quantity          numeric(10,2) not null default 1 check (quantity > 0),
  unit_amount_cents int not null check (unit_amount_cents >= 0),
  tax_rate_bps      int not null default 0 check (tax_rate_bps between 0 and 10000),
  amount_cents      int not null check (amount_cents >= 0),
  sort_order        int not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists invoice_line_items_invoice_idx
  on public.invoice_line_items(invoice_id, sort_order);
create index if not exists invoice_line_items_source_idx
  on public.invoice_line_items(kind, source_id)
  where source_id is not null;

alter table public.invoice_line_items enable row level security;

drop policy if exists "invoice_line_items_trainer_select" on public.invoice_line_items;
create policy "invoice_line_items_trainer_select" on public.invoice_line_items
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.trainer_id = auth.uid()
    )
  );

drop policy if exists "invoice_line_items_owner_select" on public.invoice_line_items;
create policy "invoice_line_items_owner_select" on public.invoice_line_items
  for select using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.owner_id is not null
        and i.owner_id = auth.uid()
    )
  );

drop policy if exists "invoice_line_items_trainer_insert_draft" on public.invoice_line_items;
create policy "invoice_line_items_trainer_insert_draft" on public.invoice_line_items
  for insert with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.trainer_id = auth.uid()
        and i.status = 'draft'
    )
  );

drop policy if exists "invoice_line_items_trainer_update_draft" on public.invoice_line_items;
create policy "invoice_line_items_trainer_update_draft" on public.invoice_line_items
  for update
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.trainer_id = auth.uid()
        and i.status = 'draft'
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.trainer_id = auth.uid()
        and i.status = 'draft'
    )
  );

drop policy if exists "invoice_line_items_trainer_delete_draft" on public.invoice_line_items;
create policy "invoice_line_items_trainer_delete_draft" on public.invoice_line_items
  for delete using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_line_items.invoice_id
        and i.trainer_id = auth.uid()
        and i.status = 'draft'
    )
  );


-- =============================================================
-- 7) Column adds — training_sessions, expenses, animal_access_grants, trainer_profiles
-- =============================================================
alter table public.training_sessions
  add column if not exists billable boolean not null default true;

alter table public.expenses
  add column if not exists billable_to_owner boolean not null default false;
alter table public.expenses
  add column if not exists markup_bps int not null default 0;
alter table public.expenses
  add column if not exists tax_rate_bps int not null default 0;

do $$
begin
  -- Guard check constraints (add-if-missing)
  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_markup_bps_range'
  ) then
    alter table public.expenses
      add constraint expenses_markup_bps_range
      check (markup_bps >= 0 and markup_bps <= 10000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'expenses_tax_rate_bps_range'
  ) then
    alter table public.expenses
      add constraint expenses_tax_rate_bps_range
      check (tax_rate_bps >= 0 and tax_rate_bps <= 10000);
  end if;
end $$;

alter table public.animal_access_grants
  add column if not exists billing_mode text not null default 'per_session';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'animal_access_grants_billing_mode_check'
  ) then
    alter table public.animal_access_grants
      add constraint animal_access_grants_billing_mode_check
      check (billing_mode in ('per_session','monthly_invoice'));
  end if;
end $$;

alter table public.trainer_profiles
  add column if not exists invoice_logo_r2_key text;
alter table public.trainer_profiles
  add column if not exists invoice_timezone text not null default 'America/Chicago';


-- =============================================================
-- 8) updated_at triggers
-- =============================================================
drop trigger if exists trainer_invoice_settings_touch_updated_at on public.trainer_invoice_settings;
create trigger trainer_invoice_settings_touch_updated_at
  before update on public.trainer_invoice_settings
  for each row execute function public.touch_updated_at();

drop trigger if exists trainer_customer_map_touch_updated_at on public.trainer_customer_map;
create trigger trainer_customer_map_touch_updated_at
  before update on public.trainer_customer_map
  for each row execute function public.touch_updated_at();

drop trigger if exists trainer_goals_touch_updated_at on public.trainer_goals;
create trigger trainer_goals_touch_updated_at
  before update on public.trainer_goals
  for each row execute function public.touch_updated_at();

drop trigger if exists recurring_line_items_touch_updated_at on public.recurring_line_items;
create trigger recurring_line_items_touch_updated_at
  before update on public.recurring_line_items
  for each row execute function public.touch_updated_at();

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at
  before update on public.invoices
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 9) Helpers
-- =============================================================

-- trainer_month_start — first day of the trainer's current calendar
-- month in their configured timezone. Used by the Business Dashboard
-- MTD rollups and by the auto-finalize cron for period_start math.
create or replace function public.trainer_month_start(p_trainer_id uuid, p_at timestamptz default now())
returns date
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tz   text;
  v_date date;
begin
  select coalesce(invoice_timezone, 'America/Chicago') into v_tz
  from public.trainer_profiles
  where user_id = p_trainer_id;

  v_tz := coalesce(v_tz, 'America/Chicago');

  v_date := date_trunc('month', (p_at at time zone v_tz))::date;
  return v_date;
end;
$$;

grant execute on function public.trainer_month_start(uuid, timestamptz) to authenticated, service_role;

-- invoice_is_overdue — derived status helper for dashboards.
-- Overdue = status='open' AND due_date < today (trainer tz)
create or replace function public.invoice_is_overdue(p_invoice_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.invoices i
    join public.trainer_profiles tp on tp.user_id = i.trainer_id
    where i.id = p_invoice_id
      and i.status = 'open'
      and i.due_date < (now() at time zone coalesce(tp.invoice_timezone, 'America/Chicago'))::date
  );
$$;

grant execute on function public.invoice_is_overdue(uuid) to authenticated, service_role;


-- =============================================================
-- 10) Post-apply verification
--
--   -- a. All new tables have RLS enabled:
--   select c.relname, c.relrowsecurity
--   from pg_class c join pg_namespace n on c.relnamespace = n.oid
--   where n.nspname = 'public'
--     and c.relname in (
--       'trainer_invoice_settings','trainer_customer_map','trainer_goals',
--       'recurring_line_items','invoices','invoice_line_items'
--     );
--   -- Expect: all 6 rows with relrowsecurity = true.
--
--   -- b. Column adds present with correct defaults:
--   select column_name, column_default, is_nullable
--   from information_schema.columns
--   where table_schema='public' and table_name='training_sessions'
--     and column_name='billable';
--   -- Expect: (billable, true, NO)
--
--   select column_name, column_default, is_nullable
--   from information_schema.columns
--   where table_schema='public' and table_name='expenses'
--     and column_name in ('billable_to_owner','markup_bps','tax_rate_bps')
--   order by column_name;
--   -- Expect: 3 rows, defaults false/0/0, all NOT NULL.
--
--   select column_name, column_default
--   from information_schema.columns
--   where table_schema='public' and table_name='animal_access_grants'
--     and column_name='billing_mode';
--   -- Expect: ('per_session'::text)
--
--   -- c. trainer_month_start returns Apr 2026 for a trainer in America/Chicago:
--   select public.trainer_month_start('00000000-0000-0000-0000-000000000000'::uuid, '2026-04-20'::timestamptz);
--   -- Expect: 2026-04-01
--
--   -- d. Policy counts on new tables:
--   select tablename, count(*) as policy_count
--   from pg_policies
--   where schemaname='public'
--     and tablename in (
--       'trainer_invoice_settings','trainer_customer_map','trainer_goals',
--       'recurring_line_items','invoices','invoice_line_items'
--     )
--   group by tablename order by tablename;
--   -- Expect: every table >= 1; invoices >= 4; invoice_line_items >= 5.
-- =============================================================
