# Phase 8 Module 03 — Facility / Boarding Map (List + Daily Care Matrix)

**Parent plan:** `docs/phase-8-plan.md`
**Migration file:** extends `supabase/migrations/00020_phase8_barn_mode_core.sql` (same migration as 01-barn-calendar.md; block ordering: 01's tables first, then 03's blocks)
**Law references:** OAG §2 (care-matrix batch write goes through the Worker — SPA never inserts `care_matrix_entries` directly), §3 (every stall assign / turnout group change / care-matrix entry writes `audit_log` with before/after diff), §7 (RLS day one — every table owner-scoped via `ranches.owner_id` join), §8 (archive-never-delete on every new table; `stall_assignments` and `turnout_group_members` use `unassigned_at` / `left_at` as the archive marker to preserve historical roster).
**Feature-map reference:** §3.1 owner portal "Facility" surface.
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 shadcn `Card` / `Table` / `Dialog` / `Select` / `Checkbox` / `Tabs`, §10 error/empty/loading.

---

## §A. Scope + success criterion

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Stall list (1:1 assignment)** | `/app/barn/facility/:ranch_id` shows a shadcn `Table` of stalls for the selected ranch. Each row: stall label + assigned animal (dropdown, shadcn `Select` populated from owner's animals not yet assigned to another stall). Assignment is 1:1 — one horse per stall, one stall per horse at any time. Changing the assignment inserts a new `stall_assignments` row with `assigned_at=now()` and stamps the old row with `unassigned_at=now()`. |
| 2 | **Turnout groups (many-to-many tag)** | `/app/barn/facility/:ranch_id/turnout` shows shadcn `Tabs` per group. Each group is a chip: name, color hex, member count. Click a group → see members, add/remove horses. A horse can belong to multiple groups simultaneously (paddock A, night turnout, sale string). Removing a horse stamps `left_at=now()` on the `turnout_group_members` row — never deletes. |
| 3 | **Daily Care Matrix — editable + printable** | `/app/barn/facility/:ranch_id/care?date=YYYY-MM-DD` renders a shadcn `Table`: rows = horses at this ranch (via active `stall_assignments`), columns = care tasks (feed AM, feed PM, hay, turnout, blanket, supplements, meds, notes). Checkboxes + text inputs. Defaults to today. Save button commits a batch `POST /api/barn/facility/:ranch_id/care-matrix` with all edited rows in one transaction. |
| 4 | **Printable daily chart (PDF)** | "Print today's chart" button generates a letter-size PDF (feed chart + turnout groups + care matrix) via the Phase 7 R2 PDF pipeline. FREE for all tiers (no Barn Mode gate — this is table-stakes ops, not a premium feature). |
| 5 | **Multi-facility selector** | Owner with multiple `ranches` rows sees a shadcn `Select` at the top of the Facility surface. URL structure is `/app/barn/facility/:ranch_id/{stalls\|turnout\|care}` so state is deep-linkable. Each ranch has its own `color_hex` (from 01-barn-calendar.md column add) — palette drives stall-list row borders + turnout group default colors. |
| 6 | **Horse color persistence** | Horse colors (set in 01-barn-calendar.md) carry through: stall-list row pills, turnout group member chips, care-matrix row markers. A horse's color is the same everywhere in the app. |

**Non-goals (v1):** no drag-and-drop visual layout (future v1.1 design project); no barn staff sub-accounts (owner is sole check-off user in v1); no per-horse feed recipes / supplement SKUs (keep care matrix as free-text inputs — structured feed plans are v1.1); no attachment uploads per care-matrix entry (notes text field only); no historical audit UI surface — historical assignments live in `stall_assignments` / `turnout_group_members` rows and are queryable via SQL, but the v1 UI shows current state only.

---

## §B. Data model

### 1. `stalls`
```sql
create table if not exists public.stalls (
  id            uuid primary key default gen_random_uuid(),
  ranch_id      uuid not null references public.ranches(id) on delete cascade,
  label         text not null check (char_length(label) between 1 and 60),
  position_row  int,
  position_col  int,
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create unique index if not exists stalls_ranch_label_uniq
  on public.stalls(ranch_id, lower(label))
  where archived_at is null;
create index if not exists stalls_ranch_idx
  on public.stalls(ranch_id)
  where archived_at is null;

alter table public.stalls enable row level security;
drop policy if exists "stalls_owner_select" on public.stalls;
create policy "stalls_owner_select" on public.stalls
  for select using (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "stalls_owner_insert" on public.stalls;
create policy "stalls_owner_insert" on public.stalls
  for insert with check (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "stalls_owner_update" on public.stalls;
create policy "stalls_owner_update" on public.stalls
  for update using (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.ranches r where r.id = stalls.ranch_id and r.owner_id = auth.uid())
  );
revoke delete on public.stalls from anon, authenticated;
```

`position_row` / `position_col` are reserved for the v1.1 drag-drop layout; nullable in v1, ignored by the list UI.

### 2. `stall_assignments`
Historical log. Multiple rows per (`stall_id`, `animal_id`) are fine over time, but only one active row per stall and one active row per animal.

```sql
create table if not exists public.stall_assignments (
  id              uuid primary key default gen_random_uuid(),
  stall_id        uuid not null references public.stalls(id) on delete cascade,
  animal_id       uuid not null references public.animals(id) on delete cascade,
  assigned_at     timestamptz not null default now(),
  unassigned_at   timestamptz,
  assigned_by     uuid references auth.users(id),
  notes           text check (notes is null or char_length(notes) <= 500),
  created_at      timestamptz not null default now()
);

-- At most one active assignment per stall
create unique index if not exists stall_assignments_stall_active_uniq
  on public.stall_assignments(stall_id)
  where unassigned_at is null;
-- At most one active assignment per animal (animal can't be in two stalls)
create unique index if not exists stall_assignments_animal_active_uniq
  on public.stall_assignments(animal_id)
  where unassigned_at is null;

create index if not exists stall_assignments_stall_time_idx
  on public.stall_assignments(stall_id, assigned_at desc);
create index if not exists stall_assignments_animal_time_idx
  on public.stall_assignments(animal_id, assigned_at desc);

alter table public.stall_assignments enable row level security;
drop policy if exists "stall_assignments_owner_select" on public.stall_assignments;
create policy "stall_assignments_owner_select" on public.stall_assignments
  for select using (
    exists (
      select 1 from public.stalls s join public.ranches r on r.id = s.ranch_id
      where s.id = stall_assignments.stall_id and r.owner_id = auth.uid()
    )
  );
revoke insert, update, delete on public.stall_assignments from anon, authenticated;
-- Inserts go through the Worker so the "unassign previous + assign new" pair is atomic.
```

### 3. `turnout_groups`
```sql
create table if not exists public.turnout_groups (
  id            uuid primary key default gen_random_uuid(),
  ranch_id      uuid not null references public.ranches(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  color_hex     text check (color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$'),
  notes         text check (notes is null or char_length(notes) <= 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create unique index if not exists turnout_groups_ranch_name_uniq
  on public.turnout_groups(ranch_id, lower(name))
  where archived_at is null;
create index if not exists turnout_groups_ranch_idx
  on public.turnout_groups(ranch_id)
  where archived_at is null;

alter table public.turnout_groups enable row level security;
drop policy if exists "turnout_groups_owner_select" on public.turnout_groups;
create policy "turnout_groups_owner_select" on public.turnout_groups
  for select using (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "turnout_groups_owner_insert" on public.turnout_groups;
create policy "turnout_groups_owner_insert" on public.turnout_groups
  for insert with check (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  );
drop policy if exists "turnout_groups_owner_update" on public.turnout_groups;
create policy "turnout_groups_owner_update" on public.turnout_groups
  for update using (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.ranches r where r.id = turnout_groups.ranch_id and r.owner_id = auth.uid())
  );
revoke delete on public.turnout_groups from anon, authenticated;
```

### 4. `turnout_group_members`
Historical log; `left_at` is the archive marker.

```sql
create table if not exists public.turnout_group_members (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references public.turnout_groups(id) on delete cascade,
  animal_id     uuid not null references public.animals(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  left_at       timestamptz,
  added_by      uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

create unique index if not exists turnout_group_members_active_uniq
  on public.turnout_group_members(group_id, animal_id)
  where left_at is null;
create index if not exists turnout_group_members_group_idx
  on public.turnout_group_members(group_id)
  where left_at is null;
create index if not exists turnout_group_members_animal_idx
  on public.turnout_group_members(animal_id)
  where left_at is null;

alter table public.turnout_group_members enable row level security;
drop policy if exists "turnout_group_members_owner_select" on public.turnout_group_members;
create policy "turnout_group_members_owner_select" on public.turnout_group_members
  for select using (
    exists (
      select 1 from public.turnout_groups g join public.ranches r on r.id = g.ranch_id
      where g.id = turnout_group_members.group_id and r.owner_id = auth.uid()
    )
  );
revoke insert, update, delete on public.turnout_group_members from anon, authenticated;
-- Joins/leaves go through Worker for atomicity + audit.
```

### 5. `care_matrix_entries`
One row per (`animal_id`, `date`). Owner edits → batch upsert from the Worker.

```sql
create table if not exists public.care_matrix_entries (
  id                  uuid primary key default gen_random_uuid(),
  animal_id           uuid not null references public.animals(id) on delete cascade,
  entry_date          date not null,
  feed_am             boolean not null default false,
  feed_pm             boolean not null default false,
  hay                 boolean not null default false,
  turnout             boolean not null default false,
  blanket             boolean not null default false,
  supplements_given   boolean not null default false,
  meds_given          boolean not null default false,
  notes               text check (notes is null or char_length(notes) <= 1000),
  updated_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz,
  constraint care_matrix_entries_animal_date_uniq unique (animal_id, entry_date)
);

create index if not exists care_matrix_entries_animal_date_idx
  on public.care_matrix_entries(animal_id, entry_date desc)
  where archived_at is null;
create index if not exists care_matrix_entries_date_idx
  on public.care_matrix_entries(entry_date desc)
  where archived_at is null;

alter table public.care_matrix_entries enable row level security;
drop policy if exists "care_matrix_entries_owner_select" on public.care_matrix_entries;
create policy "care_matrix_entries_owner_select" on public.care_matrix_entries
  for select using (
    exists (select 1 from public.animals a where a.id = care_matrix_entries.animal_id and a.owner_id = auth.uid())
  );
-- Inserts/updates go through Worker (batch upsert path). Service-role only for writes.
revoke insert, update, delete on public.care_matrix_entries from anon, authenticated;
```

---

## §C. Worker endpoints

All under `worker/routes/barn/facility.ts`. Every write writes `audit_log` with before/after diff for the touched row.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/barn/facility/:ranch_id/map` | owner | Returns `{ranch, stalls: [{...stall, current_assignment}], turnout_groups: [{...group, members}]}`. |
| `POST` | `/api/barn/facility/:ranch_id/stalls` | owner | Create stall. |
| `PATCH` | `/api/barn/facility/:ranch_id/stalls/:id` | owner | Update label / notes / position. |
| `POST` | `/api/barn/facility/:ranch_id/stalls/:id/assign` | owner | Body: `{animal_id}` or `{animal_id: null}` to unassign. Transactional: unassigns previous animal if needed, unassigns the animal from its current stall if needed, inserts new assignment. |
| `POST` | `/api/barn/facility/:ranch_id/stalls/:id/archive` | owner | Archive stall (unassigns current animal via same transaction). |
| `POST` | `/api/barn/facility/:ranch_id/turnout-groups` | owner | Create group. |
| `PATCH` | `/api/barn/facility/:ranch_id/turnout-groups/:id` | owner | Update name / color / notes. |
| `POST` | `/api/barn/facility/:ranch_id/turnout-groups/:id/members` | owner | Body: `{animal_ids[]}`. Adds members (no-op for already-active). |
| `DELETE` | `/api/barn/facility/:ranch_id/turnout-groups/:id/members/:animal_id` | owner | Stamps `left_at=now()`. Route verb is DELETE but semantically archive. |
| `POST` | `/api/barn/facility/:ranch_id/turnout-groups/:id/archive` | owner | Archive group (stamps `left_at` on all active members). |
| `GET` | `/api/barn/facility/:ranch_id/care-matrix?date=YYYY-MM-DD` | owner | Returns rows for every horse currently at the ranch (via active `stall_assignments`). Missing rows rendered client-side as default-false. |
| `POST` | `/api/barn/facility/:ranch_id/care-matrix` | owner | Body: `{date, entries: [{animal_id, feed_am, feed_pm, hay, turnout, blanket, supplements_given, meds_given, notes}]}`. Batch upsert. |
| `GET` | `/api/barn/facility/:ranch_id/print.pdf?date=YYYY-MM-DD` | owner | Returns `{r2_url, expires_at}` for the signed PDF. FREE — no Barn Mode gate. |

Multi-ranch API: `GET /api/barn/facility` (no `:ranch_id`) returns a summary list of the owner's ranches for the selector.

---

## §D. UI

### `/app/barn/facility`
- If owner has one ranch → redirect to `/app/barn/facility/:ranch_id/stalls`.
- If multiple → shadcn `Select` ranch picker, landing on a "pick a facility" card.

### `/app/barn/facility/:ranch_id` — top shell
- Shadcn `Tabs` with three panels: **Stalls**, **Turnout**, **Daily Care**.
- Ranch color chip + name in the page header.

### Stalls tab
- Shadcn `Table`: stall label / current animal (Select) / row archive button.
- "Add stall" button → shadcn `Dialog` (label + notes).
- Assignment Select filters out animals already assigned elsewhere; assigning an already-assigned horse pops a confirm dialog ("Move Knight from stall 3 to stall 7?") and executes the transactional reassign.

### Turnout tab
- Shadcn `Tabs` per group (or a chip row if many groups). Active chip shows group members as shadcn `Badge` rows with their horse color + name.
- "Add group" button → `Dialog` (name + color picker from the Phase 8 palette).
- Per-member "Remove" button stamps `left_at`.

### Daily Care tab
- Date picker at the top (shadcn `Calendar` in a `Popover`). Default = today.
- Table: horse name (with color dot) / 7 checkbox columns / notes input.
- "Save" button → batch POST. Unsaved-changes warning on tab switch or navigate-away.
- "Print today's chart" button → PDF export (shared with the free print endpoint).

### Empty / loading / error
- Loading: shadcn `Skeleton` rows.
- Empty stalls: "No stalls yet — add your first stall" card.
- Empty turnout groups: "No groups yet — create one for day turnout, night turnout, pasture pals, etc."
- Errors: Sonner toast with retry.

### PDF template
`worker/pdf/templates/facility-care.css` + `facility-care.html`. Sections:
1. Header: Mane Line brand + ranch name + date.
2. Feed chart: horse × (AM / PM / Hay / Supplements / Meds) grid with checkbox marks.
3. Turnout groups: one row per group with member names.
4. Notes column: horse name + free-text notes for the day.
5. Footer: generated timestamp + pagination.

---

## §E. Verify block

### 1. Migration integrity
```bash
psql $DATABASE_URL -c "
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on c.relnamespace = n.oid
  where n.nspname='public'
    and c.relname in ('stalls','stall_assignments','turnout_groups','turnout_group_members','care_matrix_entries')
  order by c.relname;
"
# Expect: 5 rows, all RLS enabled
```

### 2. Stall 1:1 enforcement
Assign animal A to stall 1, animal A to stall 2:
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/facility/$RANCH/stalls/$STALL_1/assign \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"animal_id":"'$ANIMAL_A'"}'
# Expect: 200

curl -sS -X POST https://worker.maneline.co/api/barn/facility/$RANCH/stalls/$STALL_2/assign \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{"animal_id":"'$ANIMAL_A'"}'
# Expect: 200 (automatic unassign from stall 1 + re-assign to stall 2)

psql $DATABASE_URL -c "
  select stall_id, assigned_at, unassigned_at
  from stall_assignments where animal_id='$ANIMAL_A' order by assigned_at;
"
# Expect: 2 rows — first has unassigned_at set, second is active (unassigned_at null)
```

Attempt direct INSERT via SQL to force a second active row for the same stall → should fail on the partial unique index:
```bash
psql $DATABASE_URL -c "
  insert into stall_assignments(stall_id, animal_id, assigned_at)
  values ('$STALL_2'::uuid, '$ANIMAL_B'::uuid, now());
"
# Expect: ERROR duplicate key (because stall 2 already has an active assignment for animal A)
```

### 3. Turnout group many-to-many
Add animal A to group X and group Y:
```bash
curl -sS -X POST .../turnout-groups/$GROUP_X/members -d '{"animal_ids":["'$ANIMAL_A'"]}'
curl -sS -X POST .../turnout-groups/$GROUP_Y/members -d '{"animal_ids":["'$ANIMAL_A'"]}'
psql $DATABASE_URL -c "
  select group_id from turnout_group_members
  where animal_id='$ANIMAL_A' and left_at is null;
"
# Expect: 2 rows
```

### 4. Care matrix batch upsert
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/facility/$RANCH/care-matrix \
  -H "Authorization: Bearer $OWNER_JWT" -H "Content-Type: application/json" \
  -d '{
    "date":"2026-06-15",
    "entries":[
      {"animal_id":"'$ANIMAL_A'","feed_am":true,"feed_pm":true,"hay":true,"turnout":true,"blanket":false,"supplements_given":true,"meds_given":false,"notes":"Soaked hay"}
    ]
  }'
psql $DATABASE_URL -c "
  select feed_am, feed_pm, hay, notes from care_matrix_entries
  where animal_id='$ANIMAL_A' and entry_date='2026-06-15';
"
# Expect: t, t, t, Soaked hay
```

Call again with a different set — verify upsert updates the row:
```bash
curl -sS -X POST .../care-matrix -d '{"date":"2026-06-15","entries":[{"animal_id":"'$ANIMAL_A'","feed_am":true,...}]}'
psql $DATABASE_URL -c "select count(*) from care_matrix_entries where animal_id='$ANIMAL_A' and entry_date='2026-06-15';"
# Expect: 1 (not 2)
```

### 5. Multi-ranch isolation
As owner B (different user), attempt to GET owner A's ranch:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://worker.maneline.co/api/barn/facility/$RANCH_A/map \
  -H "Authorization: Bearer $OWNER_B_JWT"
# Expect: 404 (RLS hides; Worker translates empty set to 404)
```

### 6. PDF export (free)
```bash
curl -sS -X GET "https://worker.maneline.co/api/barn/facility/$RANCH/print.pdf?date=2026-06-15" \
  -H "Authorization: Bearer $FREE_OWNER_JWT" | jq '.r2_url'
# Expect: signed URL; download + verify PDF

curl -sS -o /tmp/facility.pdf "$R2_URL"
file /tmp/facility.pdf
# Expect: "PDF document, version 1.x"
```

### 7. Archive-never-delete
```bash
curl -sS -X POST .../turnout-groups/$GROUP_X/archive -H "Authorization: Bearer $OWNER_JWT"
psql $DATABASE_URL -c "select archived_at from turnout_groups where id='$GROUP_X';"
# Expect: non-null timestamp (NOT zero rows)
psql $DATABASE_URL -c "select count(*) from turnout_group_members where group_id='$GROUP_X' and left_at is null;"
# Expect: 0 (all members stamped left_at when group archived)
```

### 8. Audit log coverage
```bash
psql $DATABASE_URL -c "
  select action, count(*) from audit_log
  where created_at > now() - interval '1 hour'
    and action like 'barn.facility.%'
  group by action;
"
# Expect: barn.facility.stall_assign, barn.facility.group_member_add,
# barn.facility.care_matrix_write, barn.facility.pdf_export
```

### 9. Static grep
```bash
! grep -R "delete from stalls\|delete from turnout\|delete from care_matrix" worker 2>/dev/null
! grep -R "@heroui/react" app/src/pages/barn/facility 2>/dev/null
```

---

**End of 03-facility-map.md — ships with 5 new tables + multi-ranch UI selector + free-tier PDF export. Depends only on the Phase 8 color palette and Phase 0 `ranches` table.**
