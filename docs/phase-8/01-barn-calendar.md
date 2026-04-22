# Phase 8 Module 01 — Barn Calendar + Professional Contacts + Invite/Accept

**Parent plan:** `docs/phase-8-plan.md`
**Migration file:** `supabase/migrations/00020_phase8_barn_mode_core.sql` (this module owns the calendar + pro-contacts portion; 03-facility-map and 04-barn-spending extend the same migration)
**Law references:** OAG §2 (Worker + service_role for all calendar reads/writes; public accept/decline token endpoint is the only anon path, gated by signed-token validation in the Worker), §3 (audit every event create / update / response / revoke), §7 (RLS day one — owner-scoped on every new table; trainer visibility via `animal_access_grants` join), §8 (archive-never-delete — events, pro contacts, attendees, recurrence rules all carry `archived_at`).
**Feature-map reference:** §3.1 owner portal, §3.2 trainer portal mirror.
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 shadcn `Card` / `Dialog` / `Tabs` / `Calendar` / `Popover` / `Badge`, §10 error/empty/loading.

---

## §A. Scope + success criterion

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Owner "Barn Calendar" surface** | `/app/barn/calendar` renders week / month / agenda shadcn Tabs. Owner can create an event (title, start_at, duration_minutes, location_text, animal_ids[], notes, attendees, recurrence rule optional). `POST /api/barn/events` persists `barn_events` row + `barn_event_attendees` rows; materializes up to 52 future instances if RRULE is present. |
| 2 | **Trainer "My Schedule" mirror** | `/trainer/my-schedule` renders the same shadcn Calendar primitive, but reads events filtered to the trainer's granted animals (join via `animal_access_grants` → `barn_events.animal_ids && granted_animal_ids`). Response/counter actions available if the trainer was invited. |
| 3 | **Professional Contacts CRUD** | `/app/barn/contacts` lists owner's `professional_contacts` with role filter (trainer / vet / farrier / staff / other). Add/edit dialog captures name, role, email, phone_e164, company, notes. Used as the attendee picker in the event-create dialog. |
| 4 | **Dual-path attendee invite** | On event create/update, the Worker determines per-attendee whether they are a Maneline user (lookup on `user_profiles.email`) or external (unlinked email in `professional_contacts`). Maneline users get in-app + email; external gets branded email with `.ics` + `https://maneline.co/e/:token` public accept/decline/counter link. |
| 5 | **Response flow** | `POST /api/barn/events/:id/respond` (in-app, auth) or `POST /api/public/events/:token/respond` (external, signed token) writes a `barn_event_responses` row. Each response is append-only audit. The owner sees per-attendee status pills (pending / confirmed / declined / countered / cancelled) on the event detail dialog. |
| 6 | **Counter-proposal** | External pro can counter with a new `proposed_start_at`. Counter keeps the same `barn_events.id`, inserts a `barn_event_responses` row with `status='countered'` + `counter_start_at`. Owner sees a "Counter proposed" badge; accepts with one click (updates `barn_events.start_at`) or edits and re-sends. |
| 7 | **Recurrence** | Owner picks quick-picks (farrier Q6W, worming Q3M, dental annual, custom RRULE). Stored in `barn_event_recurrence_rules`. Worker materializes the next 52 instances into `barn_events` rows with `recurrence_rule_id` FK. Editing a recurring event prompts "this event only" vs "this and future" — Phase 8 scope is "this event only" + "end series"; full mutation across series is v1.1. |
| 8 | **Notification reminders** | `pg_cron` every 15m scans `barn_events` for `start_at` falling within the next 48h / 24h / 2h buckets; fires in-app + email notifications. SMS tier is gated on Barn Mode (owner must be on paid or comp tier for SMS to fire to external attendees; opt-in per-contact). Reminder fires are logged in `barn_event_notifications_log`. |
| 9 | **Soft-signup "claim your pro account" email** | After 3 successful `barn_event_responses.status='confirmed'` from the same `professional_contacts.id`, Worker fires a one-shot email: "Your clients have been booking you through Mane Line — claim your trainer/vet/farrier account." `professional_contacts.claim_email_sent_at` stamps to prevent re-fire. |
| 10 | **Horse color + barn color persistence** | `animals.color_hex` and `ranches.color_hex` column adds — swatches picked from the Phase 8 palette. Color is used consistently on Barn Calendar event chips, Facility Map stall rows, and Herd Health dashboard rows. |

**Non-goals (v1):** no Google/Apple two-way sync; no drag-to-reschedule in the UI (edit-by-click only); no counter-of-counter chain (one counter level max); no per-user quiet-hours for reminders; no event-level file attachments (owner's existing `vet_records` upload flow covers the vet-prep attachment case).

---

## §B. Data model

All tables RLS-enabled at create. Every table has `archived_at timestamptz`. `touch_updated_at` trigger on every table with `updated_at`. All text fields use check-constraints for reasonable length bounds. Enum-like status columns use `check` constraints, not Postgres enums (to keep migrations forward-compatible).

### 1. `professional_contacts`
Owner-scoped address book of pros. Used as the attendee picker in event create.

```sql
create table if not exists public.professional_contacts (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null references auth.users(id) on delete cascade,
  name                      text not null check (char_length(name) between 1 and 120),
  role                      text not null check (role in ('trainer','vet','farrier','staff','other')),
  email                     text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone_e164                text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  company                   text check (company is null or char_length(company) <= 200),
  notes                     text check (notes is null or char_length(notes) <= 2000),
  sms_opt_in                boolean not null default false,
  linked_user_id            uuid references auth.users(id) on delete set null,
  response_count_confirmed  int not null default 0 check (response_count_confirmed >= 0),
  claim_email_sent_at       timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz
);

create unique index if not exists professional_contacts_owner_email_uniq
  on public.professional_contacts(owner_id, lower(email))
  where email is not null and archived_at is null;
create index if not exists professional_contacts_owner_role_idx
  on public.professional_contacts(owner_id, role)
  where archived_at is null;
```

### 2. `barn_events`
The event itself. Per-animal chip color derives from `animals.color_hex` via join; per-ranch color from `ranches.color_hex`.

```sql
create table if not exists public.barn_events (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null references auth.users(id) on delete cascade,
  ranch_id              uuid references public.ranches(id) on delete set null,
  title                 text not null check (char_length(title) between 1 and 200),
  start_at              timestamptz not null,
  duration_minutes      int not null default 60 check (duration_minutes between 5 and 1440),
  location_text         text check (location_text is null or char_length(location_text) <= 300),
  animal_ids            uuid[] not null default '{}',
  notes                 text check (notes is null or char_length(notes) <= 4000),
  created_by            uuid not null references auth.users(id),
  status                text not null default 'scheduled' check (status in (
                          'scheduled','in_progress','completed','cancelled'
                        )),
  recurrence_rule_id    uuid references public.barn_event_recurrence_rules(id) on delete set null,
  prefill_source        text check (prefill_source is null or prefill_source in (
                          'herd_health_dashboard','manual','recurrence_materialize'
                        )),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz
);

create index if not exists barn_events_owner_start_idx
  on public.barn_events(owner_id, start_at)
  where archived_at is null;
create index if not exists barn_events_ranch_start_idx
  on public.barn_events(ranch_id, start_at)
  where ranch_id is not null and archived_at is null;
create index if not exists barn_events_animals_gin_idx
  on public.barn_events using gin (animal_ids)
  where archived_at is null;
```

### 3. `barn_event_attendees`
Per-event attendee list. `pro_contact_id` is the owner's row; `linked_user_id` is populated when the attendee resolves to a Maneline user. External attendees have a signed token in `public_token`.

```sql
create table if not exists public.barn_event_attendees (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.barn_events(id) on delete cascade,
  pro_contact_id    uuid references public.professional_contacts(id) on delete set null,
  linked_user_id    uuid references auth.users(id) on delete set null,
  email             text,
  phone_e164        text,
  delivery_channel  text not null check (delivery_channel in ('in_app','email','email_sms')),
  public_token      text unique,
  token_expires_at  timestamptz,
  current_status    text not null default 'pending' check (current_status in (
                      'pending','confirmed','declined','countered','cancelled'
                    )),
  last_notified_at  timestamptz,
  created_at        timestamptz not null default now(),
  archived_at       timestamptz,
  constraint barn_event_attendees_resolution_check check (
    linked_user_id is not null or email is not null
  )
);

create unique index if not exists barn_event_attendees_event_pro_uniq
  on public.barn_event_attendees(event_id, pro_contact_id)
  where pro_contact_id is not null and archived_at is null;
create index if not exists barn_event_attendees_token_idx
  on public.barn_event_attendees(public_token)
  where public_token is not null;
create index if not exists barn_event_attendees_user_idx
  on public.barn_event_attendees(linked_user_id)
  where linked_user_id is not null and archived_at is null;
```

### 4. `barn_event_responses`
Append-only audit trail of every response action. `current_status` on the attendee row is maintained by a trigger that reads the latest non-archived response. Responses themselves are never archived or edited — a revoke is a new response with `status='cancelled'`.

```sql
create table if not exists public.barn_event_responses (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.barn_events(id) on delete cascade,
  attendee_id       uuid not null references public.barn_event_attendees(id) on delete cascade,
  responder_channel text not null check (responder_channel in ('in_app','public_token')),
  responder_user_id uuid references auth.users(id),
  status            text not null check (status in (
                      'confirmed','declined','countered','cancelled'
                    )),
  counter_start_at  timestamptz,
  response_note     text check (response_note is null or char_length(response_note) <= 1000),
  ip                inet,
  user_agent        text,
  created_at        timestamptz not null default now()
);

create index if not exists barn_event_responses_event_idx
  on public.barn_event_responses(event_id, created_at desc);
create index if not exists barn_event_responses_attendee_idx
  on public.barn_event_responses(attendee_id, created_at desc);
```

### 5. `barn_event_recurrence_rules`
RRULE-compatible storage. Worker is the only writer; materializes the next 52 instances into `barn_events` on insert and on a daily top-up cron.

```sql
create table if not exists public.barn_event_recurrence_rules (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references auth.users(id) on delete cascade,
  rrule_text          text not null check (char_length(rrule_text) between 1 and 500),
  template_title      text not null check (char_length(template_title) between 1 and 200),
  template_duration   int not null default 60 check (template_duration between 5 and 1440),
  template_animal_ids uuid[] not null default '{}',
  template_notes      text check (template_notes is null or char_length(template_notes) <= 4000),
  series_start_at     timestamptz not null,
  series_end_at       timestamptz,
  last_materialized_through timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  archived_at         timestamptz
);

create index if not exists barn_event_recurrence_rules_owner_idx
  on public.barn_event_recurrence_rules(owner_id)
  where archived_at is null;
```

### 6. `barn_event_notifications_log`
Append-only log of fired reminders (48h/24h/2h) + claim-pro emails. Service-role only. Used by health endpoint to surface `barn.claim_pro_emails_sent_7d`.

```sql
create table if not exists public.barn_event_notifications_log (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid references public.barn_events(id) on delete set null,
  attendee_id     uuid references public.barn_event_attendees(id) on delete set null,
  pro_contact_id  uuid references public.professional_contacts(id) on delete set null,
  channel         text not null check (channel in ('in_app','email','sms','claim_pro_email')),
  bucket          text check (bucket is null or bucket in ('48h','24h','2h','claim_pro')),
  status          text not null check (status in ('sent','failed','skipped')),
  error           text,
  created_at      timestamptz not null default now()
);

create index if not exists barn_event_notifications_log_event_idx
  on public.barn_event_notifications_log(event_id, created_at desc)
  where event_id is not null;
create index if not exists barn_event_notifications_log_pro_claim_idx
  on public.barn_event_notifications_log(pro_contact_id)
  where channel = 'claim_pro_email';
```

### 7. Column adds
```sql
alter table public.animals
  add column if not exists color_hex text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'animals_color_hex_format') then
    alter table public.animals
      add constraint animals_color_hex_format
      check (color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

alter table public.ranches
  add column if not exists color_hex text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ranches_color_hex_format') then
    alter table public.ranches
      add constraint ranches_color_hex_format
      check (color_hex is null or color_hex ~ '^#[0-9a-fA-F]{6}$');
  end if;
end $$;

alter table public.user_profiles
  add column if not exists welcome_tour_barn_seen_at timestamptz;
```

### 8. `user_notification_prefs`
Per-user overrides for the default reminder policy. Defaults to "email on, in-app on, SMS off" at user create (no row required for default behavior).

```sql
create table if not exists public.user_notification_prefs (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  in_app_enabled      boolean not null default true,
  email_enabled       boolean not null default true,
  sms_enabled         boolean not null default false,
  reminder_48h        boolean not null default true,
  reminder_24h        boolean not null default true,
  reminder_2h         boolean not null default true,
  updated_at          timestamptz not null default now()
);

alter table public.user_notification_prefs enable row level security;

drop policy if exists "user_notification_prefs_select_own" on public.user_notification_prefs;
create policy "user_notification_prefs_select_own" on public.user_notification_prefs
  for select using (user_id = auth.uid());

drop policy if exists "user_notification_prefs_upsert_own" on public.user_notification_prefs;
create policy "user_notification_prefs_upsert_own" on public.user_notification_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

### 9. RLS — pattern summary
- `professional_contacts` — `owner_id = auth.uid()` for SELECT/INSERT/UPDATE. No DELETE grant.
- `barn_events` — owner sees own; trainer sees where `animal_access_grants.granted_animal_ids && barn_events.animal_ids`. INSERT/UPDATE by owner; trainer may only create events on their granted animals.
- `barn_event_attendees` — owner of the parent event sees all; the attendee user sees own row (if `linked_user_id = auth.uid()`); trainer sees rows where the parent event is visible.
- `barn_event_responses` — insert allowed only via Worker (service_role); SELECT follows parent-event visibility.
- `barn_event_recurrence_rules` — `owner_id = auth.uid()` for SELECT/INSERT/UPDATE.
- `barn_event_notifications_log` — service_role only (no anon or authenticated reads).
- Public token endpoint path is **anon-allowed on the Worker**, but the token validates against `barn_event_attendees.public_token` + `token_expires_at > now()` + Worker-level rate limit `public_event:token:{token}` = 60 GETs / 20 POSTs per 60s.

### 10. Color palette — TODO(phase-8)
**Default:** 16 Tailwind-500 swatches (`#f59e0b amber`, `#f43f5e rose`, `#10b981 emerald`, `#0ea5e9 sky`, `#8b5cf6 violet`, `#d946ef fuchsia`, `#f97316 orange`, `#14b8a6 teal`, `#6366f1 indigo`, `#84cc16 lime`, `#06b6d4 cyan`, `#ec4899 pink`, `#ef4444 red`, `#eab308 yellow`, `#22c55e green`, `#3b82f6 blue`). Cedric final pick expected before 8.1 ships.

---

## §C. Worker endpoints (Hono)

All routes live under `worker/routes/barn/` + `worker/routes/public/`. Zod schemas in `worker/schemas/barn.ts`. Every write path calls `writeAuditLog(env, { action, ... })` per OAG §3. Rate limiter `rateLimitDO` from Phase 6 wraps every endpoint.

| Method | Path | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/barn/events?view=week\|month\|agenda&from=&to=` | owner or trainer | Trainer sees filtered set via `animal_access_grants` join. |
| `GET` | `/api/barn/events/:id` | owner or trainer (granted) | Returns event + attendees + latest responses. |
| `POST` | `/api/barn/events` | owner (only) | Body: `{title, start_at, duration_minutes, location_text?, animal_ids[], notes?, attendees: [{pro_contact_id?, email?, delivery_channel}], recurrence?: {rrule, series_end_at?}}`. Materializes up to 52 future instances if recurrence. Fires invites. |
| `PATCH` | `/api/barn/events/:id` | owner (only) | Updates event fields; retrigger notifications if `start_at` or `duration_minutes` change. "Edit this only" — does NOT propagate to other instances of the same recurrence series. |
| `POST` | `/api/barn/events/:id/cancel` | owner | Flips status to `cancelled`, fires cancellation email to attendees. |
| `POST` | `/api/barn/events/:id/archive` | owner | `update set archived_at = now()`. |
| `POST` | `/api/barn/events/:id/respond` | attendee (auth user) | Body: `{status, counter_start_at?, response_note?}`. Inserts `barn_event_responses` row; updates `barn_event_attendees.current_status` via trigger. |
| `GET` | `/api/public/events/:token` | anon | Returns event summary + attendee row + response history. Rate-limited. |
| `POST` | `/api/public/events/:token/respond` | anon (signed token) | Body: `{status, counter_start_at?, response_note?}`. Token in URL; CSRF-safe because the token is the credential. Rate-limited. |
| `POST` | `/api/public/events/:token/revoke` | anon (signed token) | Attendee-initiated revoke. |
| `GET` | `/api/barn/pro-contacts` | owner | List + filter by role. |
| `POST` | `/api/barn/pro-contacts` | owner | Create. |
| `PATCH` | `/api/barn/pro-contacts/:id` | owner | Update; includes `sms_opt_in` toggle (owner asserts consent on behalf of the pro; copy in the UI makes the TCPA scope explicit). |
| `POST` | `/api/barn/pro-contacts/:id/archive` | owner | Archive. |
| `POST` | `/api/_internal/barn-reminders-tick` | service-role (cron) | Called every 15m by `pg_cron`; scans events and fires reminders. |
| `POST` | `/api/_internal/barn-materialize-recurrences` | service-role (cron) | Called daily at 03:00 UTC; extends `last_materialized_through` by materializing new instances through `now() + 12 months`. |
| `POST` | `/api/_internal/pro-claim-email` | service-role | Fires "claim your pro account" email; invoked from the response-insert trigger once `response_count_confirmed` hits 3. |

**Signed-token format.** 32-byte `crypto.getRandomValues`, base64url-encoded. Stored verbatim in `barn_event_attendees.public_token`. Expires at `token_expires_at = min(event.start_at + 72h, now() + 30d)` — whichever is sooner.

---

## §D. UI (shadcn only)

### Owner surface `/app/barn/calendar`
- Top shell: existing owner portal chrome. New "Barn" tab in the bottom nav (horse-icon) exposes three sub-surfaces: **Calendar**, **Health**, **Facility**.
- **Calendar tab** — shadcn `Tabs` for `week / month / agenda`. Week view is a custom 7-column grid built on shadcn `Card`; month view uses the shadcn `Calendar` primitive with day-cells showing event badges; agenda is a shadcn `Table` of upcoming 30 days.
- Event chip color = `animals.color_hex` of the first animal in `animal_ids[]`; if `animal_ids` empty, use `ranches.color_hex` of `ranch_id`; if neither, a neutral gray chip.
- **Event detail dialog** (shadcn `Dialog`): title, start, duration, location, animals, notes, attendee rows with response pills (pending gray / confirmed green / declined red / countered amber / cancelled slate). "Copy public link" button for external attendees. Counter rows show a "Accept counter" button that updates the event's `start_at` in one click.
- **Create-event dialog** — shadcn `Dialog` + `Form` (react-hook-form + Zod). Animal multi-select is shadcn `Popover` + `Command`. Attendee picker is a shadcn `Popover` driven by `/api/barn/pro-contacts`. Recurrence dropdown: Off (default) / Every 6 weeks / Every 3 months / Annual / Custom RRULE (text input).
- **Pro Contacts tab** at `/app/barn/contacts` — shadcn `Table`, role filter chips, add/edit `Dialog`.

### Trainer surface `/trainer/my-schedule`
Same shadcn `Calendar` / `Tabs` layout as owner. Read-only for most rows; respond/counter affordances only for events where the trainer is an attendee. No create-event affordance in v1 (owners are the scheduling authority). TECH_DEBT(phase-8): trainer-initiated events is a v1.1 ask.

### Public accept/decline `/e/:token`
Minimal shadcn shell — no portal chrome, no bottom nav. Mane Line brand header. Shows event title, time (converted to attendee's browser tz), location, animals summary, owner name. Three buttons: **Confirm**, **Decline**, **Propose new time**. Propose opens a date-time picker (shadcn `Calendar` + time select). After submit, a success screen with "Mane Line — your clients' barn in a box" marketing footer (the growth-loop real estate).

### Response status pill component
`app/src/components/shared/ResponseStatusPill.tsx` — shadcn `Badge` wrapper; shared by Barn Calendar, trainer schedule, public event page.

### Empty / loading / error states
Per UI guide §10 — every list uses shadcn `Skeleton` during load, empty state uses `Card` + illustration slot, errors use Sonner toast with retry affordance.

---

## §E. Notification orchestration

### Reminder cron
```
pg_cron: barn_reminders_tick
schedule: */15 * * * *
body: select net.http_post(
  'https://worker.maneline.co/api/_internal/barn-reminders-tick',
  body := '{}'::jsonb,
  headers := '{"X-Internal-Secret": "<secret>"}'::jsonb
);
```

Worker handler scans non-archived `scheduled` events with `start_at` inside three windows: `[now()+47h, now()+49h]`, `[now()+23h, now()+25h]`, `[now()+95m, now()+125m]`. Per-window, per-attendee dedupe via `barn_event_notifications_log.bucket`. Fires in-app + email always; SMS only if all three hold: (a) `professional_contacts.sms_opt_in = true`, (b) `phone_e164 is not null`, (c) owner's `subscriptions.tier = 'barn_mode'` or `comp_source is not null`.

### Claim-pro email trigger
Insert trigger on `barn_event_responses`: when `status='confirmed'`, increment `professional_contacts.response_count_confirmed`. AFTER the increment, if the new count = 3 AND `claim_email_sent_at is null` AND `linked_user_id is null` AND `email is not null` — enqueue a job row (reuse `pending_hubspot_syncs` pattern OR a small `pending_pro_claim_emails` queue; spec defers to implementer). Worker drains the queue every 5m, fires the branded email via Resend, stamps `claim_email_sent_at`.

### Templates
- `worker/emails/barn/invitation.ts` — external invite with `.ics` attachment + public token link.
- `worker/emails/barn/reminder-48h.ts` / `reminder-24h.ts` / `reminder-2h.ts`.
- `worker/emails/barn/counter-proposed.ts` — owner-side.
- `worker/emails/barn/counter-accepted.ts` — attendee-side.
- `worker/emails/barn/cancelled.ts` — attendee-side.
- `worker/emails/barn/claim-pro-account.ts` — growth loop.

All templates extend the shared header/footer module from Phase 6.

### `.ics` attachment
`worker/ics/generate.ts` — composes VCALENDAR/VEVENT with `UID = event_id@maneline.co`, `SUMMARY`, `DTSTART/DTEND`, `LOCATION`, `DESCRIPTION`, `ORGANIZER = mailto:<owner_email>`, `ATTENDEE = mailto:<attendee_email>;PARTSTAT=NEEDS-ACTION`. Attachment filename `{event_title_slug}.ics`.

---

## §F. Verify block

Run after the migration applies + the Worker routes ship. Copy/paste into a terminal; stop on red.

### 1. Migration integrity
```bash
psql $DATABASE_URL -c "
  select c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on c.relnamespace = n.oid
  where n.nspname = 'public'
    and c.relname in (
      'professional_contacts','barn_events','barn_event_attendees',
      'barn_event_responses','barn_event_recurrence_rules',
      'barn_event_notifications_log','user_notification_prefs'
    )
  order by c.relname;
"
# Expect: 7 rows, every relrowsecurity = t
```

### 2. Color columns applied
```bash
psql $DATABASE_URL -c "
  select column_name, data_type
  from information_schema.columns
  where (table_name, column_name) in (('animals','color_hex'), ('ranches','color_hex'))
  order by table_name;
"
# Expect: 2 rows, both text
```

### 3. Create an event (owner JWT)
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/events \
  -H "Authorization: Bearer $OWNER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Farrier — Knight + Rumor",
    "start_at": "2026-06-15T14:00:00Z",
    "duration_minutes": 60,
    "location_text": "Main barn aisle",
    "animal_ids": ["'$ANIMAL_1'", "'$ANIMAL_2'"],
    "notes": "Front shoes only, hot-shod",
    "attendees": [
      {"pro_contact_id": "'$FARRIER_CONTACT_ID'", "delivery_channel": "email"}
    ]
  }'
# Expect: 201 with {id, public_token_count: 1}
```

### 4. External pro confirms via public token
```bash
TOKEN=$(psql $DATABASE_URL -tA -c "select public_token from barn_event_attendees where event_id='$EVENT_ID' order by created_at desc limit 1")
curl -sS -X POST https://worker.maneline.co/api/public/events/$TOKEN/respond \
  -H "Content-Type: application/json" \
  -d '{"status":"confirmed"}'
# Expect: 200 with {current_status:"confirmed"}
psql $DATABASE_URL -c "select status, created_at from barn_event_responses where event_id='$EVENT_ID';"
# Expect: 1 row, status='confirmed'
```

### 5. Counter-proposal flow
```bash
curl -sS -X POST https://worker.maneline.co/api/public/events/$TOKEN/respond \
  -H "Content-Type: application/json" \
  -d '{"status":"countered","counter_start_at":"2026-06-16T14:00:00Z","response_note":"Truck in the shop"}'
# Expect: 200 with {current_status:"countered"}
```

### 6. Owner accepts counter
```bash
curl -sS -X PATCH https://worker.maneline.co/api/barn/events/$EVENT_ID \
  -H "Authorization: Bearer $OWNER_JWT" \
  -H "Content-Type: application/json" \
  -d '{"start_at":"2026-06-16T14:00:00Z"}'
# Expect: 200; attendee notification re-fires; new barn_event_notifications_log row
```

### 7. Claim-pro threshold fire
Seed 3 confirmed responses from the same `pro_contact_id`, verify:
```bash
psql $DATABASE_URL -c "select claim_email_sent_at from professional_contacts where id='$FARRIER_CONTACT_ID';"
# Expect: non-null timestamp within 5 minutes of the 3rd confirm
psql $DATABASE_URL -c "select count(*) from barn_event_notifications_log where channel='claim_pro_email' and pro_contact_id='$FARRIER_CONTACT_ID';"
# Expect: 1
```

### 8. Trainer "My Schedule" scope
As a trainer JWT granted access to `$ANIMAL_1`:
```bash
curl -sS "https://worker.maneline.co/api/barn/events?view=week&from=2026-06-15&to=2026-06-22" \
  -H "Authorization: Bearer $TRAINER_JWT"
# Expect: event $EVENT_ID present; events from other owners absent
```

### 9. Public token rate limit
```bash
for i in $(seq 1 61); do
  curl -sS -o /dev/null -w "%{http_code}\n" https://worker.maneline.co/api/public/events/$TOKEN &
done; wait
# Expect: 60 × 200, 1 × 429 (within a single 60s window)
```

### 10. Archive-not-delete
```bash
curl -sS -X POST https://worker.maneline.co/api/barn/pro-contacts/$FARRIER_CONTACT_ID/archive \
  -H "Authorization: Bearer $OWNER_JWT"
psql $DATABASE_URL -c "select id, archived_at from professional_contacts where id='$FARRIER_CONTACT_ID';"
# Expect: 1 row, archived_at non-null (NOT zero rows)
```

### 11. Recurrence materialization
```bash
# Create a Q6W farrier recurrence starting 2026-06-15
curl -sS -X POST https://worker.maneline.co/api/barn/events \
  -H "Authorization: Bearer $OWNER_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"Farrier — Knight",
    "start_at":"2026-06-15T14:00:00Z",
    "duration_minutes":60,
    "animal_ids":["'$ANIMAL_1'"],
    "attendees":[],
    "recurrence":{"rrule":"FREQ=WEEKLY;INTERVAL=6;COUNT=52"}
  }'
psql $DATABASE_URL -c "
  select count(*) from barn_events
  where recurrence_rule_id is not null
    and owner_id='$OWNER_ID';
"
# Expect: 52
```

### 12. Reminder cron dry-run
```bash
curl -sS -X POST https://worker.maneline.co/api/_internal/barn-reminders-tick \
  -H "X-Internal-Secret: $INTERNAL_SECRET"
# Expect: 200 with {fired: N, skipped_dedupe: M}
```

### 13. Static grep (no HeroUI / no hex literals / no console.log on error paths)
```bash
! grep -R "@heroui/react" app/src/pages/barn app/src/pages/trainer/my-schedule 2>/dev/null
! grep -RE "#[0-9a-fA-F]{6}" app/src/pages/barn 2>/dev/null | grep -v color_hex
! grep -R "console.log" worker/routes/barn worker/routes/public/events 2>/dev/null | grep -i error
```
All three commands return zero lines.

### 14. Audit log coverage
```bash
psql $DATABASE_URL -c "
  select action, count(*) from audit_log
  where created_at > now() - interval '1 hour'
    and action like 'barn.%'
  group by action order by action;
"
# Expect at least: barn.event.create, barn.event.update, barn.event.respond,
# barn.pro_contact.create, barn.public_event.respond, barn.claim_pro_email.send
```

---

**End of 01-barn-calendar.md — ships with 7 new tables + 2 column adds + 1 settings table. Blocks 8.2 only on the migration landing (Herd Health's scheduler handoff prefills events via the same `barn_events.prefill_source='herd_health_dashboard'` path).**
