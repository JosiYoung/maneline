# Phase 8 Module 02 — Herd Health Dashboard

**Parent plan:** `docs/phase-8-plan.md`
**Migration file:** `supabase/migrations/00022_phase8_herd_health_thresholds.sql`
**Law references:** OAG §2 (dashboard aggregations run server-side in the Worker against service_role views — SPA never joins `vet_records` directly for the grid calc), §3 (every PDF export writes `audit_log`; threshold edits logged), §7 (RLS day one on `health_thresholds` + `health_dashboard_acknowledgements`), §8 (archive-never-delete on acknowledgements; threshold rows `update` in place — no history table in v1 but the column-level `updated_at` is present).
**Feature-map reference:** §3.1 owner portal, §3.3 Silver Lining admin (Herd Health rollup is exposed on `/admin` once a handful of owners have data — v1.1 polish, not Phase 8).
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 shadcn `Table` / `Card` / `Tooltip` / `Dialog` / `Badge`, §10 error/empty/loading.

---

## §A. Scope + success criterion

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Dashboard grid** | `/app/barn/health` renders a shadcn `Table`: rows = owner's non-archived `animals`, columns = record types (Coggins, Core vaccines, Risk vaccines, Dental, Farrier, FEC, Deworming). Each cell is color-coded: green (age < 50% of interval), yellow (50–100%), red (> 100% — overdue), gray (no record). Cell tooltip shows last record date + next-due date. |
| 2 | **Scheduler handoff** | Click an amber/red cell → opens Barn Calendar create-event dialog (from module 01) with `prefill_source='herd_health_dashboard'`, `title` pre-filled ("Coggins pull — Knight"), `animal_ids` pre-filled, and the pro-contact picker filtered to the matching role (vet for Coggins/vaccines/dental, farrier for farrier, vet for FEC). |
| 3 | **Owner-configurable thresholds** | `/app/barn/health/thresholds` — shadcn `Table` of 7 record types with `interval_days` input, `enabled` toggle, reset-to-default button per row. Defaults seeded on first load. |
| 4 | **Per-animal detail page** | `/app/barn/health/animals/:id` — chronological shadcn `Table` of that horse's `vet_records` with record type, date, notes, next-due derived. Same cell-color logic in a "status at a glance" card. |
| 5 | **Herd Health PDF export (Barn Mode-gated)** | `POST /api/barn/herd-health/report.pdf` generates a letter-size PDF (cover page + one row per horse + threshold legend). Reuses the Phase 7 R2 PDF pipeline. 402 `barn_mode_required` if caller is not on Barn Mode (paid or comp). |
| 6 | **Dismiss / acknowledge** | Owner can dismiss a specific overdue cell for N days (e.g., "vet said we can wait 2 weeks on the Coggins"). Stored in `health_dashboard_acknowledgements` with `dismissed_until` — cell shows gray-with-dot while dismissed; re-asserts red when `dismissed_until` passes. |

**Non-goals (v1):** no anomaly detection (weight trends, dose adherence) — calendar-based expirations only. No state-specific defaults (liability firewall). No deworming alarm (informational only — deworming cadence is FEC-driven, not calendar-driven). No automatic event creation on overdue — always a one-click user action. No sharing the dashboard outside the owner (vet can still view the last-12-months records via the Phase 5 vet-share-token flow).

---

## §B. Data model

### 1. `health_thresholds`
One row per (`owner_id`, `record_type`). Seeded on first dashboard load with the AAEP industry defaults below. Owner can change `interval_days` or flip `enabled`. If a row is missing for a record type, the Worker falls back to the seed defaults (kept in `worker/constants/health-defaults.ts`).

```sql
create table if not exists public.health_thresholds (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  record_type     text not null check (record_type in (
                    'coggins','core_vaccines','risk_vaccines',
                    'dental','farrier','fec','deworming'
                  )),
  interval_days   int not null check (interval_days between 1 and 3650),
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint health_thresholds_owner_type_uniq unique (owner_id, record_type)
);

create index if not exists health_thresholds_owner_idx
  on public.health_thresholds(owner_id);

alter table public.health_thresholds enable row level security;

drop policy if exists "health_thresholds_select_own" on public.health_thresholds;
create policy "health_thresholds_select_own" on public.health_thresholds
  for select using (owner_id = auth.uid());
drop policy if exists "health_thresholds_insert_own" on public.health_thresholds;
create policy "health_thresholds_insert_own" on public.health_thresholds
  for insert with check (owner_id = auth.uid());
drop policy if exists "health_thresholds_update_own" on public.health_thresholds;
create policy "health_thresholds_update_own" on public.health_thresholds
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke delete on public.health_thresholds from anon, authenticated;
```

### 2. Industry-default seed values (stored as code constant, written on first read)

| record_type | interval_days | notes |
|---|---|---|
| `coggins` | 365 | 12 months per AAEP / travel-paperwork norm |
| `core_vaccines` | 365 | EEE / WEE / WNV / Tetanus — annual |
| `risk_vaccines` | 180 | Flu / Rhino — 6 months |
| `dental` | 365 | Annual float |
| `farrier` | 49 | 7 weeks (default mid-point of 6–8 week band) |
| `fec` | 90 | Quarterly fecal egg count |
| `deworming` | 0 (enabled=false) | Informational only — no calendar alarm |

### 3. `health_dashboard_acknowledgements`
Per-cell dismissals. Append-only for audit; latest non-archived row per (`owner_id`, `animal_id`, `record_type`) determines current dismiss state.

```sql
create table if not exists public.health_dashboard_acknowledgements (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  animal_id       uuid not null references public.animals(id) on delete cascade,
  record_type     text not null check (record_type in (
                    'coggins','core_vaccines','risk_vaccines',
                    'dental','farrier','fec','deworming'
                  )),
  dismissed_until timestamptz not null,
  reason          text check (reason is null or char_length(reason) <= 500),
  created_at      timestamptz not null default now(),
  archived_at     timestamptz
);

create index if not exists health_dash_ack_owner_animal_idx
  on public.health_dashboard_acknowledgements(owner_id, animal_id, record_type)
  where archived_at is null;

alter table public.health_dashboard_acknowledgements enable row level security;
drop policy if exists "health_dash_ack_select_own" on public.health_dashboard_acknowledgements;
create policy "health_dash_ack_select_own" on public.health_dashboard_acknowledgements
  for select using (owner_id = auth.uid());
drop policy if exists "health_dash_ack_insert_own" on public.health_dashboard_acknowledgements;
create policy "health_dash_ack_insert_own" on public.health_dashboard_acknowledgements
  for insert with check (owner_id = auth.uid());
drop policy if exists "health_dash_ack_update_own" on public.health_dashboard_acknowledgements;
create policy "health_dash_ack_update_own" on public.health_dashboard_acknowledgements
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
revoke delete on public.health_dashboard_acknowledgements from anon, authenticated;
```

### 4. Dashboard aggregation view
Materialized as a Postgres function `compute_herd_health(p_owner_id uuid)` returning `(animal_id, record_type, last_record_at, next_due_at, status)` — read by the Worker only (service_role). View is recomputed on each `/api/barn/herd-health` call (expected grid size: <30 horses × 7 record types = 210 rows; well within a sub-50ms read).

```sql
create or replace function public.compute_herd_health(p_owner_id uuid)
returns table (
  animal_id       uuid,
  record_type     text,
  last_record_at  timestamptz,
  next_due_at     timestamptz,
  interval_days   int,
  enabled         boolean,
  dismissed_until timestamptz,
  status          text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with thresholds as (
    select * from public.health_thresholds where owner_id = p_owner_id
  ),
  latest_rec as (
    select vr.animal_id, vr.record_type, max(vr.occurred_on) as last_record_at
    from public.vet_records vr
    join public.animals a on a.id = vr.animal_id
    where a.owner_id = p_owner_id
      and a.archived_at is null
    group by vr.animal_id, vr.record_type
  ),
  latest_ack as (
    select distinct on (animal_id, record_type)
      animal_id, record_type, dismissed_until
    from public.health_dashboard_acknowledgements
    where owner_id = p_owner_id
      and archived_at is null
      and dismissed_until > now()
    order by animal_id, record_type, created_at desc
  )
  select
    a.id as animal_id,
    t.record_type,
    lr.last_record_at,
    case when lr.last_record_at is not null and t.interval_days > 0
         then lr.last_record_at + (t.interval_days || ' days')::interval
         else null end as next_due_at,
    t.interval_days,
    t.enabled,
    la.dismissed_until,
    case
      when not t.enabled then 'disabled'
      when lr.last_record_at is null then 'no_record'
      when la.dismissed_until is not null then 'dismissed'
      when lr.last_record_at + (t.interval_days || ' days')::interval < now() then 'overdue'
      when lr.last_record_at + (t.interval_days * 0.5 || ' days')::interval < now() then 'warn'
      else 'ok'
    end as status
  from public.animals a
  cross join thresholds t
  left join latest_rec lr on lr.animal_id = a.id and lr.record_type = t.record_type
  left join latest_ack la on la.animal_id = a.id and la.record_type = t.record_type
  where a.owner_id = p_owner_id
    and a.archived_at is null;
$$;

grant execute on function public.compute_herd_health(uuid) to service_role;
```

---

## §C. Worker endpoints

All under `worker/routes/barn/herd-health.ts`. Every read + PDF export writes `audit_log`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/barn/herd-health` | owner | Returns grid: `{animals: [...], thresholds: [...], cells: [...]}`; seeds default thresholds if missing. |
| `GET` | `/api/barn/herd-health/animals/:id` | owner | Per-animal detail — all records + cell statuses for that horse. |
| `PATCH` | `/api/barn/herd-health/thresholds` | owner | Body: `{thresholds: [{record_type, interval_days, enabled}]}`. Upsert by (owner, record_type). |
| `POST` | `/api/barn/herd-health/thresholds/reset` | owner | Reset all to industry defaults (delete-via-archive + re-seed). |
| `POST` | `/api/barn/herd-health/acknowledge` | owner | Body: `{animal_id, record_type, dismissed_until, reason?}`. Inserts row; updates dashboard on next read. |
| `POST` | `/api/barn/herd-health/acknowledge/:id/unarchive` | owner | Restore a prematurely-archived dismissal (audit-safe). |
| `POST` | `/api/barn/herd-health/report.pdf` | owner (Barn Mode gate) | Returns `{r2_url, expires_at}` for a signed R2 URL. Gated by the Phase 8.5 Barn Mode middleware — returns 402 `barn_mode_required` otherwise. |

**PDF generation approach.** Same pattern as Phase 7 invoice PDFs:
1. Worker composes HTML using the existing `worker/pdf/template.ts` layout helpers.
2. Renders to PDF via Cloudflare Browser Rendering (`env.BROWSER`).
3. Stores in R2 under `herd-health-reports/{owner_id}/{yyyy-mm-dd}-{short_id}.pdf`.
4. Generates a signed URL (24h expiry) and returns it.
5. Audit-log row: `action='barn.herd_health.report_export'`, `target_id=<animal_count>`, context includes threshold snapshot.

---

## §D. UI

### `/app/barn/health`
- Shadcn `Card` wrapper with page title + "Export PDF" button (disabled + tooltip "Upgrade to Barn Mode" if caller is not subscribed/comped).
- Grid itself: shadcn `Table` with sticky header row; horses are rows, record types are columns. Each cell is a colored shadcn `Badge` with the next-due date; click opens a `Popover` with "Schedule event" (→ calendar handoff) and "Dismiss for N days" (→ acknowledgement dialog).
- Color mapping:
  - `ok` — `bg-emerald-50 text-emerald-700`
  - `warn` — `bg-amber-50 text-amber-700`
  - `overdue` — `bg-rose-100 text-rose-700`
  - `no_record` — `bg-slate-100 text-slate-500`
  - `dismissed` — `bg-slate-200 text-slate-600 border border-dashed`
  - `disabled` — `bg-slate-50 text-slate-400`
- Row color dot on the left edge = `animals.color_hex` (from 01-barn-calendar.md column add) for visual continuity with the Barn Calendar.

### `/app/barn/health/thresholds`
- Shadcn `Table`: record type / interval days input / enabled toggle / reset button.
- Save button at bottom calls `PATCH /api/barn/herd-health/thresholds` with the full set.

### `/app/barn/health/animals/:id`
- "Status at a glance" card: 7 cell pills in one row (same color mapping).
- Historical table below: `vet_records` for that animal, sorted by `occurred_on desc`, with next-due computed where applicable.

### Paywall affordance (PDF export)
Pre-Barn-Mode users see the export button rendered but inactive, with a tooltip "Barn Mode — $25/mo unlocks health reports." Click → opens the soft upsell modal from module 05.

### Empty / loading / error
- Loading: shadcn `Skeleton` rows (5 horses × 7 cells).
- Empty: "Add a horse to get started" card with button → `/app/animals/new`.
- Error: Sonner toast + retry.

---

## §E. PDF generation details

- **Template layout:**
  - Cover page: Mane Line brand header, "Herd Health Report — {owner.barn_name}", generated-at timestamp, threshold legend (one line per record type with configured interval).
  - Per horse: one half-page block — horse name, `color_hex` chip, 7 status pills horizontally, last-record date per record type, owner notes (optional — pulled from `animals.notes` truncated to 400 chars).
  - Footer: "Generated by Mane Line — maneline.co" + pagination.
- **Filename:** `herd-health-{barn_slug}-{YYYY-MM-DD}.pdf`.
- **Storage path:** `r2://maneline-prod/herd-health-reports/{owner_id}/{yyyy-mm-dd}-{uuid8}.pdf`.
- **Signed URL TTL:** 24 hours. Each export is a fresh URL; no long-lived sharing.
- **Size cap:** if owner has >50 horses, the PDF paginates automatically (shadcn doesn't apply here — the PDF template is its own HTML CSS file in `worker/pdf/templates/herd-health.css`).

---

## §F. Verify block

### 1. Migration integrity
```bash
psql $DATABASE_URL -c "
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on c.relnamespace = n.oid
  where n.nspname='public'
    and c.relname in ('health_thresholds','health_dashboard_acknowledgements');
"
# Expect: 2 rows, both RLS enabled
```

### 2. Dashboard read + default threshold seed
```bash
curl -sS https://worker.maneline.co/api/barn/herd-health \
  -H "Authorization: Bearer $OWNER_JWT" | jq '.thresholds | length'
# Expect: 7

psql $DATABASE_URL -c "
  select record_type, interval_days, enabled
  from health_thresholds where owner_id='$OWNER_ID' order by record_type;
"
# Expect: 7 rows matching the industry-default seed table
```

### 3. Cell color logic
Seed: one animal with a Coggins record dated `now() - 13 months`.
```bash
curl -sS https://worker.maneline.co/api/barn/herd-health \
  -H "Authorization: Bearer $OWNER_JWT" | jq '.cells[] | select(.animal_id=="'$ANIMAL_ID'" and .record_type=="coggins") | .status'
# Expect: "overdue"
```

Update record date to `now() - 8 months`:
```bash
# re-fetch
# Expect: "warn"
```

Update record date to `now() - 1 month`:
```bash
# re-fetch
# Expect: "ok"
```

### 4. Scheduler handoff — the cell deep-links into calendar
UI test (manual): click red Coggins cell → Barn Calendar create-event dialog opens with `title` containing "Coggins" + `animal_ids` pre-filled. Confirm network call:
```bash
# open browser devtools, click cell, confirm XHR to /api/barn/events with prefill_source='herd_health_dashboard'
```

### 5. Dismiss flow
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/herd-health/acknowledge \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"animal_id":"'$ANIMAL_ID'","record_type":"coggins","dismissed_until":"2026-07-15T00:00:00Z","reason":"Vet OK to wait"}'
# Expect: 201
curl -sS https://worker.maneline.co/api/barn/herd-health \
  -H "Authorization: Bearer $OWNER_JWT" | jq '.cells[] | select(.animal_id=="'$ANIMAL_ID'" and .record_type=="coggins") | .status'
# Expect: "dismissed"
```

### 6. PDF export — Barn Mode gate
Free tier caller:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST https://worker.maneline.co/api/barn/herd-health/report.pdf \
  -H "Authorization: Bearer $FREE_OWNER_JWT"
# Expect: 402
```

Barn Mode caller:
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/herd-health/report.pdf \
  -H "Authorization: Bearer $BARN_MODE_OWNER_JWT" | jq '.r2_url'
# Expect: valid signed R2 URL, HTTP 200
```

Download and verify the PDF opens:
```bash
curl -sS -o /tmp/health.pdf "$R2_URL"
file /tmp/health.pdf
# Expect: "PDF document, version 1.x"
```

### 7. Threshold reset
```bash
curl -sS -X PATCH https://worker.maneline.co/api/barn/herd-health/thresholds \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"thresholds":[{"record_type":"coggins","interval_days":180,"enabled":true}]}'
# then
curl -sS -X POST https://worker.maneline.co/api/barn/herd-health/thresholds/reset \
  -H "Authorization: Bearer $OWNER_JWT"
psql $DATABASE_URL -c "select interval_days from health_thresholds where owner_id='$OWNER_ID' and record_type='coggins';"
# Expect: 365
```

### 8. Audit log coverage
```bash
psql $DATABASE_URL -c "
  select action, count(*) from audit_log
  where created_at > now() - interval '1 hour'
    and action like 'barn.herd_health.%'
  group by action;
"
# Expect: barn.herd_health.read, barn.herd_health.thresholds_update,
# barn.herd_health.acknowledge, barn.herd_health.report_export
```

### 9. Static grep
```bash
! grep -R "@heroui/react" app/src/pages/barn/health 2>/dev/null
! grep -R "state-specific\|state_default" app/src worker/src 2>/dev/null
# liability firewall — no state-specific vaccine defaults
```

---

**End of 02-herd-health-dashboard.md — ships with 2 new tables + 1 Postgres function + 1 PDF template. Depends on 01-barn-calendar.md for the scheduler handoff dialog and `animals.color_hex`.**
