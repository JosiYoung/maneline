-- =============================================================
-- Phase 8 Module 04 — Barn Spending
-- Migration: 00024_phase8_barn_spending.sql
--
-- Column adds (animals + expenses) + rollup views + Phase 7
-- invoices -> expenses mirror trigger.
--
-- Sibling to 00020 (which is already applied); ships as 00024 so
-- migration history stays linear.
--
-- Scope-add per Phase 8 kickoff decision #4:
--   expenses.source_product_id (Silver Lining product linkage) —
--   optional FK for product-sourced expenses. Shopify catalog is
--   Silver Lining's backend, so we key by Shopify product id string
--   rather than a local products FK.
--
-- Compliance:
--   OAG §2 — rollup views are `security_invoker = true` so callers
--            hit row-level policies on the underlying tables. The
--            Worker queries through service_role and still filters
--            `owner_id = auth.uid()` explicitly before returning.
--   OAG §7 — no new RLS surface; views inherit the invoker's policy.
--   OAG §8 — archive-never-delete: trigger inserts a new expense row
--            per paid invoice, never mutates the existing one.
-- =============================================================

begin;

-- 1) animals — cost basis + disposition
alter table public.animals
  add column if not exists acquired_at date;
alter table public.animals
  add column if not exists acquired_price_cents int;
alter table public.animals
  add column if not exists disposition text;
alter table public.animals
  add column if not exists disposition_at date;
alter table public.animals
  add column if not exists disposition_amount_cents int;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'animals_acquired_price_nonneg') then
    alter table public.animals
      add constraint animals_acquired_price_nonneg
      check (acquired_price_cents is null or acquired_price_cents >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'animals_disposition_check') then
    alter table public.animals
      add constraint animals_disposition_check
      check (
        disposition is null
        or disposition in ('sold','deceased','leased_out','retired','still_owned')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'animals_disposition_amount_nonneg') then
    alter table public.animals
      add constraint animals_disposition_amount_nonneg
      check (disposition_amount_cents is null or disposition_amount_cents >= 0);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'animals_disposition_at_implies_status') then
    alter table public.animals
      add constraint animals_disposition_at_implies_status
      check (
        (disposition_at is null)
        or (disposition is not null and disposition <> 'still_owned')
      );
  end if;
end $$;

-- 2) expenses — Phase 7 invoice linkage + Silver Lining product linkage
alter table public.expenses
  add column if not exists source_invoice_id uuid references public.invoices(id) on delete set null;
alter table public.expenses
  add column if not exists source_product_id text;

create index if not exists expenses_source_invoice_idx
  on public.expenses(source_invoice_id)
  where source_invoice_id is not null;
create index if not exists expenses_source_product_idx
  on public.expenses(source_product_id)
  where source_product_id is not null;

-- 3) Rollup views — security_invoker so the caller's RLS applies.
--
-- Ranch dimension derives from the animal's currently-active stall
-- assignment (Module 03). animals has no ranch_id column, and an
-- animal can have at most one active stall (partial unique index
-- on stall_assignments where unassigned_at is null), so the left
-- join is well-defined.
drop view if exists public.expense_year_rollup;
create view public.expense_year_rollup
  with (security_invoker = true) as
  select
    a.owner_id,
    date_trunc('year', e.occurred_on)::date as year_start,
    e.category,
    e.animal_id,
    s.ranch_id,
    sum(e.amount_cents) as total_cents,
    count(*) as entry_count
  from public.expenses e
  join public.animals a on a.id = e.animal_id
  left join public.stall_assignments sa
    on sa.animal_id = a.id and sa.unassigned_at is null
  left join public.stalls s on s.id = sa.stall_id
  where e.archived_at is null
    and a.archived_at is null
  group by a.owner_id, year_start, e.category, e.animal_id, s.ranch_id;

drop view if exists public.animal_cost_basis;
create view public.animal_cost_basis
  with (security_invoker = true) as
  select
    a.id as animal_id,
    a.owner_id,
    a.acquired_at,
    a.acquired_price_cents,
    a.disposition,
    a.disposition_at,
    a.disposition_amount_cents,
    coalesce(sum(e.amount_cents), 0) as cumulative_spend_cents,
    min(e.occurred_on) as first_expense_on,
    max(e.occurred_on) as last_expense_on
  from public.animals a
  left join public.expenses e
    on e.animal_id = a.id and e.archived_at is null
  where a.archived_at is null
  group by
    a.id, a.owner_id, a.acquired_at, a.acquired_price_cents,
    a.disposition, a.disposition_at, a.disposition_amount_cents;

grant select on public.expense_year_rollup to authenticated;
grant select on public.animal_cost_basis   to authenticated;

-- 4) Phase 7 invoice -> expense mirror.
-- Closes the BIB loop: when a trainer's Phase 7 invoice is paid,
-- a matching expenses row lands in the owner's Barn Spending view.
-- Idempotency: the OLD.status <> 'paid' guard means repeated UPDATE
-- with status='paid' never re-fires the INSERT branch.
create or replace function public.mirror_invoice_to_expense()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_animal_id uuid;
begin
  if (TG_OP = 'UPDATE'
      and NEW.status = 'paid' and OLD.status <> 'paid'
      and NEW.owner_id is not null) then

    -- Representative animal: first active grant between this trainer
    -- and this owner. v1 default; per-line-item mapping is TECH_DEBT.
    select g.animal_id
      into v_animal_id
      from public.animal_access_grants g
      where g.trainer_id = NEW.trainer_id
        and g.owner_id   = NEW.owner_id
        and g.revoked_at is null
      order by g.granted_at asc
      limit 1;

    if v_animal_id is null then
      -- No active grant at payment time — log via audit_log.
      insert into public.audit_log(
        actor_id, actor_role, action, target_table, target_id, metadata
      ) values (
        NEW.trainer_id, 'trainer',
        'barn.spending.invoice_mirror_skipped',
        'invoices', NEW.id,
        jsonb_build_object(
          'reason', 'no_active_grant',
          'owner_id', NEW.owner_id,
          'invoice_id', NEW.id
        )
      );
      return NEW;
    end if;

    insert into public.expenses(
      animal_id, recorder_id, recorder_role, category, occurred_on,
      amount_cents, currency, vendor, notes,
      source_invoice_id, billable_to_owner
    )
    values (
      v_animal_id,
      NEW.trainer_id,
      'trainer',
      'board',
      coalesce(NEW.paid_at, now())::date,
      NEW.total_cents,
      NEW.currency,
      NULL,
      'Mirrored from invoice ' || coalesce(NEW.invoice_number, NEW.id::text),
      NEW.id,
      false
    )
    on conflict do nothing;

    insert into public.audit_log(
      actor_id, actor_role, action, target_table, target_id, metadata
    ) values (
      NEW.trainer_id, 'trainer',
      'barn.spending.invoice_mirrored',
      'invoices', NEW.id,
      jsonb_build_object(
        'owner_id', NEW.owner_id,
        'animal_id', v_animal_id,
        'amount_cents', NEW.total_cents,
        'invoice_id', NEW.id
      )
    );
  end if;

  return NEW;
end;
$$;

drop trigger if exists invoices_mirror_to_expense on public.invoices;
create trigger invoices_mirror_to_expense
  after update on public.invoices
  for each row execute function public.mirror_invoice_to_expense();

commit;
