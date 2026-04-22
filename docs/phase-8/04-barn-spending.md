# Phase 8 Module 04 — Barn Spending (Cash-Basis Expense Analytics + Per-Horse Cost Basis)

**Parent plan:** `docs/phase-8-plan.md`
**Migration file:** extends `supabase/migrations/00020_phase8_barn_mode_core.sql` (column adds on `animals` + `expenses`; rollup views)
**Law references:** OAG §2 (rollup aggregations run in the Worker against service_role; SPA never joins `expenses` directly for multi-horse totals), §3 (export requests write `audit_log`; cost-basis field edits audited), §7 (RLS day one — existing `expenses` RLS already owner/trainer-scoped; view-layer security checked), §8 (archive-never-delete — expense rows already have `archived_at`; the Phase 7 invoice-mirror insert writes a new expense row with `source_invoice_id`, never mutates the original).
**Feature-map reference:** §3.1 owner portal "Spending" surface; §3.2 trainer portal — trainer already sees their own expenses via Phase 3.
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 shadcn `Card` / `Table` / `Tabs` / `Select` / `Dialog`, §6 Recharts patterns (donut + bar + timeline), §10 error/empty/loading.

---

## §A. Scope + success criterion

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Spending overview** | `/app/barn/spending?year=2026` renders: category donut (Recharts), per-horse bar, monthly timeline, per-ranch breakdown. Year selector + grouping toggle (`category` / `animal` / `ranch`). All numbers are cash basis — expense `occurred_on` inside the selected year. |
| 2 | **Per-horse cost basis page** | `/app/barn/spending/animals/:id` shows: acquired date, acquired price, cumulative spend (all categories, all-time), annualized spend, disposition status (Sold / Deceased / Leased-out / Retired / Still owned), disposition date, disposition amount. Editable via a shadcn `Dialog`. |
| 3 | **CSV export** | `GET /api/barn/spending/export.csv?year=` streams CSV columns: `occurred_on, animal_name, category, amount, vendor, notes, source_invoice_id, billable_to_owner, trainer_name (if invoice-mirrored)`. FREE for all tiers. |
| 4 | **Categorized PDF export (Schedule-E-friendly)** | `GET /api/barn/spending/export.pdf?year=` — letter-size PDF with one section per category, per-horse subtotals, grand total. Footer disclaims "Not tax advice — consult your CPA." FREE for all tiers. |
| 5 | **Phase 7 invoice → owner expense mirror** | When a Phase 7 `invoices.status` transitions to `paid`, a Supabase trigger inserts a matching `expenses` row with: `animal_id` derived from the invoice's primary animal_access_grant, `category='board'` (or the line-item-derived category if the trainer tagged it; default `board`), `recorder_id` = trainer user, `recorder_role='trainer'`, `source_invoice_id` FK, `billable_to_owner=false` (the owner already paid via invoice — flagging it false prevents the "bill-back" workflow from re-charging). Closes the BIB loop — Phase 7 trainer invoices automatically show up in Phase 8 owner spending. |

**Non-goals (v1):** no income modeling (no lessons-taught, show-winnings, lease-in columns); no budget/variance (no "$X spent vs $Y budgeted"); no accrual accounting (no AP/AR aging on owner side); no multi-currency (`currency='usd'` check constraint stays); no forecasting; no per-category customization — `expense_categories` is a fixed enum (`feed`, `tack`, `vet`, `board`, `farrier`, `supplement`, `travel`, `show`, `other`) from Phase 3 migration 00009; no "other" subcategory taxonomy; no receipt OCR (already covered by Phase 3 `receipt_r2_object_id`).

---

## §B. Data model

### 1. `animals` column adds — cost basis + disposition
```sql
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
        or (disposition_at is not null and disposition is not null and disposition <> 'still_owned')
      );
  end if;
end $$;
```

### 2. `expenses` column add — invoice linkage
```sql
alter table public.expenses
  add column if not exists source_invoice_id uuid references public.invoices(id) on delete set null;

create index if not exists expenses_source_invoice_idx
  on public.expenses(source_invoice_id)
  where source_invoice_id is not null;
```

### 3. Rollup views
Two views owned by service_role, used by the Worker for the dashboard and exports. `security definer` functions wrap them so RLS is enforced by the wrapping function checking `owner_id = auth.uid()`.

```sql
create or replace view public.expense_year_rollup as
  select
    a.owner_id,
    date_trunc('year', e.occurred_on)::date as year_start,
    e.category,
    e.animal_id,
    a.ranch_id,
    sum(e.amount_cents) as total_cents,
    count(*) as entry_count
  from public.expenses e
  join public.animals a on a.id = e.animal_id
  where e.archived_at is null
    and a.archived_at is null
  group by a.owner_id, year_start, e.category, e.animal_id, a.ranch_id;

create or replace view public.animal_cost_basis as
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
  group by a.id;
```

Worker wraps these views in Hono handlers with explicit `owner_id = auth.uid()` filters before returning to the SPA.

### 4. Invoice → expense mirror trigger
```sql
create or replace function public.mirror_invoice_to_expense()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_animal_id uuid;
  v_owner_id  uuid;
begin
  -- Only act on transitions into 'paid' with owner_id set (skip ad-hoc invoices with adhoc_email)
  if (TG_OP = 'UPDATE'
      and NEW.status = 'paid' and OLD.status <> 'paid'
      and NEW.owner_id is not null) then

    -- Resolve a representative animal from this trainer/owner pair.
    -- v1 picks the first active granted animal; v1.1 could use line-item-tagged animals.
    select g.animal_id
      into v_animal_id
      from public.animal_access_grants g
      where g.trainer_id = NEW.trainer_id
        and g.owner_id = NEW.owner_id
        and g.revoked_at is null
      order by g.granted_at asc
      limit 1;

    if v_animal_id is null then
      -- Nothing to mirror — owner has no granted animals with this trainer any more.
      return NEW;
    end if;

    insert into public.expenses(
      animal_id, recorder_id, recorder_role, category, occurred_on,
      amount_cents, currency, vendor, notes, source_invoice_id
    )
    values (
      v_animal_id,
      NEW.trainer_id,
      'trainer',
      'board',                         -- v1 default; see TECH_DEBT(phase-8) line-item tagging
      coalesce(NEW.paid_at, now())::date,
      NEW.total_cents,
      NEW.currency,
      NULL,                            -- vendor derived from trainer display name at render time
      'Mirrored from invoice ' || coalesce(NEW.invoice_number, NEW.id::text),
      NEW.id
    )
    on conflict do nothing;  -- idempotent if the webhook re-fires
  end if;

  return NEW;
end;
$$;

drop trigger if exists invoices_mirror_to_expense on public.invoices;
create trigger invoices_mirror_to_expense
  after update on public.invoices
  for each row execute function public.mirror_invoice_to_expense();
```

**Idempotency.** A partial unique index on `expenses(source_invoice_id)` would be ideal but would conflict with archived rows; we rely on `on conflict do nothing` behavior combined with a Worker-level check before re-insert. Re-firing the trigger on a subsequent `status='paid'` UPDATE won't duplicate because the trigger condition `OLD.status <> 'paid'` already guards transition-only fire.

**`billable_to_owner=false` default** comes from the column default (Phase 7 migration 00018). The mirrored expense is NOT billed back — the trainer already billed the owner via the invoice, and marking `billable_to_owner=true` would let the trainer re-bill via the Phase 7 per-session billing flow. Explicit false is belt-and-suspenders.

**Line-item tagging (TECH_DEBT(phase-8)).** V1 mirrors every paid invoice as a single `category='board'` row. V1.1 will iterate `invoice_line_items` and insert one expense row per line item with `kind`-derived category (`session → 'vet' is wrong — need a new mapping`; TODO: work out the line-item → expense-category mapping with SLH in Phase 8 kickoff).

---

## §C. Worker endpoints

All under `worker/routes/barn/spending.ts`. Every export writes `audit_log`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/barn/spending?year=YYYY&group_by=category\|animal\|ranch` | owner | Returns `{year, group_by, totals: [{key, label, total_cents, entry_count}], monthly_timeline: [{month, total_cents}]}`. |
| `GET` | `/api/barn/spending/animals/:id/cost-basis` | owner | Returns `{animal, acquired_at, acquired_price_cents, cumulative_spend_cents, annualized_spend_cents, disposition, disposition_at, disposition_amount_cents, first_expense_on, last_expense_on}`. |
| `PATCH` | `/api/barn/spending/animals/:id/cost-basis` | owner | Body: `{acquired_at?, acquired_price_cents?, disposition?, disposition_at?, disposition_amount_cents?}`. Zod-validates the enum + the "disposition_at implies non-still-owned" rule before the DB constraint fires. |
| `GET` | `/api/barn/spending/export.csv?year=YYYY` | owner | Streams CSV. No Barn Mode gate. |
| `GET` | `/api/barn/spending/export.pdf?year=YYYY` | owner | Returns `{r2_url, expires_at}`. No Barn Mode gate. |

**Export columns (CSV).**
`occurred_on, animal_id, animal_name, category, amount_cents, amount_usd, currency, vendor, notes, source_invoice_id, billable_to_owner, recorder_role, recorder_email`

**PDF sections.**
1. Cover: "Barn Spending — {year} — {barn_name}", generated timestamp.
2. Summary table: one row per category with total + entry count.
3. Per-horse table: one row per horse with cost basis + year total.
4. Category detail: one section per category with rows (chronological).
5. Footer: disclaimer ("Not tax advice. Consult your CPA.").

---

## §D. UI

### `/app/barn/spending`
- Header: year picker (shadcn `Select` — last 5 years + current year), grouping toggle (`category / animal / ranch`), export buttons (CSV + PDF).
- Donut chart (Recharts `PieChart`): category shares for the selected year.
- Bar chart (Recharts `BarChart`): per-horse totals.
- Timeline (Recharts `LineChart`): monthly total across the year.
- Under the charts: shadcn `Table` drilling into the selected grouping key. Invoice-mirrored rows show a small "via Invoice #INV-042" badge.

### `/app/barn/spending/animals/:id`
- Header card: horse name + color + disposition status pill.
- Cost-basis block: acquired date / acquired price / cumulative spend / annualized / disposition details.
- "Edit cost basis" shadcn `Dialog`: all fields editable; disposition `Select` with the five statuses; disposition_at + disposition_amount_cents reveal conditionally when disposition ≠ `still_owned`.
- Expense history table: chronological, paginated.

### Empty / loading / error
- Loading: shadcn `Skeleton` for charts (gray blocks).
- Empty (no expenses for year): "No expenses logged for {year} yet" card with button → log expense.
- Errors: Sonner toast with retry.

---

## §E. Phase 7 invoice mirror — detailed flow

1. Phase 7 Worker processes Stripe `invoice.paid` webhook → updates `invoices.status='paid'` + `paid_at=now()`.
2. Postgres trigger `invoices_mirror_to_expense` fires AFTER UPDATE.
3. Trigger function resolves representative `animal_id` via `animal_access_grants`.
4. Inserts into `expenses` with `source_invoice_id=NEW.id`, `billable_to_owner=false`, `category='board'`, `amount_cents=NEW.total_cents`, `recorder_role='trainer'`.
5. Worker-level check: if the Phase 7 invoice webhook itself re-fires (duplicate `stripe_invoice_id` webhook delivery), the `OLD.status <> 'paid'` guard prevents double-insert.
6. Audit log: `action='barn.spending.invoice_mirrored'`, target_id=invoice.id, context={owner_id, animal_id, amount_cents}.

**Failure mode: no granted animal.** If an invoice is paid but the trainer no longer has an active `animal_access_grant` with the owner (grant was revoked between invoice send and payment), the trigger returns without inserting and emits a warning through the audit log (`action='barn.spending.invoice_mirror_skipped'`, reason `no_active_grant`). Owner's Barn Spending will not show that payment — documented caveat in TECH_DEBT(phase-8) until grant history is stored separately.

---

## §F. Verify block

### 1. Migration integrity
```bash
psql $DATABASE_URL -c "
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_name='animals'
    and column_name in ('acquired_at','acquired_price_cents','disposition','disposition_at','disposition_amount_cents')
  order by column_name;
"
# Expect: 5 rows

psql $DATABASE_URL -c "
  select conname from pg_constraint
  where conrelid = 'public.animals'::regclass
    and conname in ('animals_disposition_check','animals_disposition_amount_nonneg','animals_acquired_price_nonneg','animals_disposition_at_implies_status');
"
# Expect: 4 constraint names
```

### 2. Spending overview
Seed 10 expenses across 3 animals + 3 categories in year 2026. Then:
```bash
curl -sS "https://worker.maneline.co/api/barn/spending?year=2026&group_by=category" \
  -H "Authorization: Bearer $OWNER_JWT" | jq '.totals | length'
# Expect: 3 (one per non-empty category)

curl -sS "https://worker.maneline.co/api/barn/spending?year=2026&group_by=animal" \
  -H "Authorization: Bearer $OWNER_JWT" | jq '.totals | length'
# Expect: 3
```

### 3. Cost-basis edit
```bash
curl -sS -X PATCH https://worker.maneline.co/api/barn/spending/animals/$ANIMAL_A/cost-basis \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"acquired_at":"2024-04-10","acquired_price_cents":1500000,"disposition":"still_owned"}'
# Expect: 200

# Invalid: disposition_at on a still_owned horse
curl -sS -o /dev/null -w "%{http_code}\n" -X PATCH .../cost-basis \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"disposition":"still_owned","disposition_at":"2026-01-01"}'
# Expect: 400 (Zod or DB constraint rejects)
```

### 4. Invoice mirror — paid Phase 7 invoice
Seed: Phase 7 invoice for owner A / trainer T / `total_cents=30000`.
```bash
# Simulate the webhook flipping status to paid
psql $DATABASE_URL -c "
  update invoices set status='paid', paid_at=now()
  where id='$INVOICE_ID';
"

psql $DATABASE_URL -c "
  select source_invoice_id, amount_cents, billable_to_owner, category
  from expenses where source_invoice_id='$INVOICE_ID';
"
# Expect: 1 row, amount 30000, billable false, category 'board'
```

Re-fire the UPDATE — verify no duplicate:
```bash
psql $DATABASE_URL -c "update invoices set status='paid' where id='$INVOICE_ID';"
psql $DATABASE_URL -c "select count(*) from expenses where source_invoice_id='$INVOICE_ID';"
# Expect: 1 (not 2)
```

### 5. CSV export
```bash
curl -sS "https://worker.maneline.co/api/barn/spending/export.csv?year=2026" \
  -H "Authorization: Bearer $OWNER_JWT" | head -2
# Expect: header row + 1 data row. Header contains 'source_invoice_id'.
```

### 6. PDF export
```bash
curl -sS "https://worker.maneline.co/api/barn/spending/export.pdf?year=2026" \
  -H "Authorization: Bearer $OWNER_JWT" | jq '.r2_url'
# Expect: signed URL
curl -sS -o /tmp/spending.pdf "$R2_URL" && file /tmp/spending.pdf
# Expect: PDF document
```

### 7. Owner isolation
As owner B, attempt to read owner A's spending:
```bash
curl -sS "https://worker.maneline.co/api/barn/spending?year=2026" \
  -H "Authorization: Bearer $OWNER_B_JWT" | jq '.totals | length'
# Expect: 0 (their own scope — not owner A's totals)
```

### 8. Audit log coverage
```bash
psql $DATABASE_URL -c "
  select action, count(*) from audit_log
  where created_at > now() - interval '1 hour'
    and action like 'barn.spending.%'
  group by action;
"
# Expect: barn.spending.read, barn.spending.cost_basis_update,
# barn.spending.csv_export, barn.spending.pdf_export, barn.spending.invoice_mirrored
```

### 9. Static grep
```bash
! grep -R "@heroui/react" app/src/pages/barn/spending 2>/dev/null
! grep -R "delete from expenses" worker 2>/dev/null
```

---

**End of 04-barn-spending.md — ships with 5 column adds on `animals`, 1 column add on `expenses`, 2 views, 1 trigger function. Closes the Phase 7 BIB loop: trainer invoices paid in Phase 7 automatically show up in the owner's Phase 8 spending dashboard.**
