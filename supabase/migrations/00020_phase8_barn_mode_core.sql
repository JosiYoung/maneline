-- =============================================================
-- Mane Line — Phase 8 (Barn Mode — "Barn in a Box") — Core Tables
-- Migration: 00020_phase8_barn_mode_core.sql
-- Date:      2026-04-22
--
-- This is the master Phase 8 data-model migration. It is grown
-- across sub-prompts 8.1 / 8.3 / 8.4 (per docs/phase-8-plan.md §2)
-- and is fully idempotent — `if not exists` on every create, and
-- every constraint / policy guard-wrapped in `do $$ … end $$`.
--
-- Sub-prompt 8.1 (this pass) — Barn Calendar + Professional Contacts:
--   • professional_contacts        — owner's pro address book
--   • barn_event_recurrence_rules  — RRULE templates (declared first; FK target)
--   • barn_events                  — the event row itself
--   • barn_event_attendees         — per-event attendee list + public token
--   • barn_event_responses         — append-only response audit trail
--   • barn_event_notifications_log — reminder + claim-pro email log
--   • user_notification_prefs      — per-user in_app / email / sms toggles
--
-- Column adds (8.1):
--   • animals.color_hex                     — swatch for calendar chips
--   • ranches.color_hex                     — swatch for facility + chips
--   • user_profiles.welcome_tour_barn_seen_at — one-shot tour stamp
--
-- Future passes append to this file:
--   8.3 (facility) — stalls, stall_assignments, turnout_groups,
--                    turnout_group_members, care_matrix_entries
--   8.4 (spending) — animals cost-basis + disposition columns,
--                    expenses.source_invoice_id, expenses.source_product_*,
--                    rollup views, invoice -> expense mirror trigger
--
-- Compliance:
--   OAG §2 — Worker + service_role is the only write path for the
--            append-only tables (responses, notifications_log). The
--            public accept/decline token path hits the Worker, which
--            validates the token before it touches the DB.
--   OAG §3 — Triggers stamp derived state (attendee.current_status,
--            professional_contacts.response_count_confirmed); the
--            Worker still writes an audit_log row on every mutation.
--   OAG §7 — RLS on every table day one. No blanket silver_lining
--            SELECT policies; admin reads route through service_role.
--   OAG §8 — archive-never-delete: `archived_at` column everywhere
--            removal is user-facing. Responses themselves never
--            archive (a revoke is a new row with status='cancelled').
--
-- Safe to re-run.
-- =============================================================


-- =============================================================
-- 1) professional_contacts
--    Owner-scoped address book of pros. Used as the attendee
--    picker in barn event create. linked_user_id populates lazily
--    when we recognize the email as a Maneline user.
-- =============================================================
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

alter table public.professional_contacts enable row level security;

drop policy if exists "professional_contacts_select_own" on public.professional_contacts;
create policy "professional_contacts_select_own" on public.professional_contacts
  for select using (owner_id = auth.uid());

drop policy if exists "professional_contacts_insert_own" on public.professional_contacts;
create policy "professional_contacts_insert_own" on public.professional_contacts
  for insert with check (owner_id = auth.uid());

drop policy if exists "professional_contacts_update_own" on public.professional_contacts;
create policy "professional_contacts_update_own" on public.professional_contacts
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke delete on public.professional_contacts from anon, authenticated;


-- =============================================================
-- 2) barn_event_recurrence_rules
--    RRULE-compatible template storage. Declared BEFORE barn_events
--    because barn_events.recurrence_rule_id FKs into it. The Worker
--    is the only writer and is responsible for materializing the
--    next 52 instances into barn_events on insert + daily top-up.
-- =============================================================
create table if not exists public.barn_event_recurrence_rules (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null references auth.users(id) on delete cascade,
  rrule_text                text not null check (char_length(rrule_text) between 1 and 500),
  template_title            text not null check (char_length(template_title) between 1 and 200),
  template_duration         int not null default 60 check (template_duration between 5 and 1440),
  template_animal_ids       uuid[] not null default '{}',
  template_notes            text check (template_notes is null or char_length(template_notes) <= 4000),
  series_start_at           timestamptz not null,
  series_end_at             timestamptz,
  last_materialized_through timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz
);

create index if not exists barn_event_recurrence_rules_owner_idx
  on public.barn_event_recurrence_rules(owner_id)
  where archived_at is null;

alter table public.barn_event_recurrence_rules enable row level security;

drop policy if exists "barn_recurrence_select_own" on public.barn_event_recurrence_rules;
create policy "barn_recurrence_select_own" on public.barn_event_recurrence_rules
  for select using (owner_id = auth.uid());

drop policy if exists "barn_recurrence_insert_own" on public.barn_event_recurrence_rules;
create policy "barn_recurrence_insert_own" on public.barn_event_recurrence_rules
  for insert with check (owner_id = auth.uid());

drop policy if exists "barn_recurrence_update_own" on public.barn_event_recurrence_rules;
create policy "barn_recurrence_update_own" on public.barn_event_recurrence_rules
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke delete on public.barn_event_recurrence_rules from anon, authenticated;


-- =============================================================
-- 3) barn_events
--    The event row. animal_ids is a uuid[] for multi-horse events
--    (farrier trip covering 3 horses, etc.). Trainer visibility is
--    computed at the Worker level via animal_access_grants overlap
--    with animal_ids — enforced by a helper in the SELECT policy.
-- =============================================================
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
create index if not exists barn_events_recurrence_idx
  on public.barn_events(recurrence_rule_id)
  where recurrence_rule_id is not null and archived_at is null;

alter table public.barn_events enable row level security;

drop policy if exists "barn_events_select_owner" on public.barn_events;
create policy "barn_events_select_owner" on public.barn_events
  for select using (owner_id = auth.uid());

-- Trainer visibility: event is visible if the trainer has a non-revoked
-- animal_access_grant that overlaps the event's animal_ids OR has
-- owner_all scope for this owner.
drop policy if exists "barn_events_select_trainer" on public.barn_events;
create policy "barn_events_select_trainer" on public.barn_events
  for select using (
    exists (
      select 1 from public.animal_access_grants g
      where g.trainer_id = auth.uid()
        and g.owner_id = barn_events.owner_id
        and g.revoked_at is null
        and (
          g.scope = 'owner_all'
          or (g.scope = 'ranch'  and g.ranch_id  = barn_events.ranch_id)
          or (g.scope = 'animal' and g.animal_id = any(barn_events.animal_ids))
        )
    )
  );

drop policy if exists "barn_events_insert_owner" on public.barn_events;
create policy "barn_events_insert_owner" on public.barn_events
  for insert with check (owner_id = auth.uid() and created_by = auth.uid());

drop policy if exists "barn_events_update_owner" on public.barn_events;
create policy "barn_events_update_owner" on public.barn_events
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

revoke delete on public.barn_events from anon, authenticated;


-- =============================================================
-- 4) barn_event_attendees
--    Per-event attendee row. pro_contact_id is the owner's address
--    book row; linked_user_id lazy-populates when we recognize the
--    email. External attendees carry public_token for /e/:token.
--    current_status is a cached-latest-response value, maintained by
--    the trigger in section 11.
-- =============================================================
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
create index if not exists barn_event_attendees_event_idx
  on public.barn_event_attendees(event_id)
  where archived_at is null;

alter table public.barn_event_attendees enable row level security;

-- Owner of the parent event sees all attendees on that event.
drop policy if exists "barn_attendees_select_owner" on public.barn_event_attendees;
create policy "barn_attendees_select_owner" on public.barn_event_attendees
  for select using (
    exists (
      select 1 from public.barn_events e
      where e.id = barn_event_attendees.event_id
        and e.owner_id = auth.uid()
    )
  );

-- Attendee sees their own row when linked.
drop policy if exists "barn_attendees_select_self" on public.barn_event_attendees;
create policy "barn_attendees_select_self" on public.barn_event_attendees
  for select using (linked_user_id is not null and linked_user_id = auth.uid());

-- Trainer sees attendee rows on events they're entitled to via animal_access_grants.
drop policy if exists "barn_attendees_select_trainer" on public.barn_event_attendees;
create policy "barn_attendees_select_trainer" on public.barn_event_attendees
  for select using (
    exists (
      select 1 from public.barn_events e
      join public.animal_access_grants g on g.owner_id = e.owner_id
      where e.id = barn_event_attendees.event_id
        and g.trainer_id = auth.uid()
        and g.revoked_at is null
        and (
          g.scope = 'owner_all'
          or (g.scope = 'ranch'  and g.ranch_id  = e.ranch_id)
          or (g.scope = 'animal' and g.animal_id = any(e.animal_ids))
        )
    )
  );

-- Writes happen through the Worker (service_role) to keep the
-- token + email + linked_user_id resolution atomic.
revoke insert, update, delete on public.barn_event_attendees from anon, authenticated;


-- =============================================================
-- 5) barn_event_responses
--    Append-only response audit trail. Never archived, never
--    updated — a "revoke" is a new row with status='cancelled'.
--    SELECT follows the parent-event visibility; inserts go
--    through the Worker (service_role) for both in-app and
--    signed-token paths.
-- =============================================================
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

alter table public.barn_event_responses enable row level security;

drop policy if exists "barn_responses_select_owner" on public.barn_event_responses;
create policy "barn_responses_select_owner" on public.barn_event_responses
  for select using (
    exists (
      select 1 from public.barn_events e
      where e.id = barn_event_responses.event_id
        and e.owner_id = auth.uid()
    )
  );

drop policy if exists "barn_responses_select_self" on public.barn_event_responses;
create policy "barn_responses_select_self" on public.barn_event_responses
  for select using (
    exists (
      select 1 from public.barn_event_attendees a
      where a.id = barn_event_responses.attendee_id
        and a.linked_user_id is not null
        and a.linked_user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.barn_event_responses from anon, authenticated;


-- =============================================================
-- 6) barn_event_notifications_log
--    Append-only fire log — reminders (48h/24h/2h) + claim-pro
--    emails. Service-role only on reads AND writes. Used by the
--    /api/_integrations-health tile and the reminder cron for
--    dedupe across ticks.
-- =============================================================
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
create index if not exists barn_event_notifications_log_dedupe_idx
  on public.barn_event_notifications_log(event_id, attendee_id, bucket, channel)
  where event_id is not null and attendee_id is not null and bucket is not null;

alter table public.barn_event_notifications_log enable row level security;

-- Service-role only. No anon, no authenticated reads or writes.
revoke all on public.barn_event_notifications_log from anon, authenticated;


-- =============================================================
-- 7) user_notification_prefs
--    Per-user override for the default reminder policy. Defaults
--    mean no row is required for normal behavior — the Worker
--    falls back to (in_app=on, email=on, sms=off, all buckets on).
-- =============================================================
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

drop policy if exists "user_notification_prefs_insert_own" on public.user_notification_prefs;
create policy "user_notification_prefs_insert_own" on public.user_notification_prefs
  for insert with check (user_id = auth.uid());

drop policy if exists "user_notification_prefs_update_own" on public.user_notification_prefs;
create policy "user_notification_prefs_update_own" on public.user_notification_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke delete on public.user_notification_prefs from anon, authenticated;


-- =============================================================
-- 8) Column adds — color swatches + welcome-tour stamp
--
-- Color palette (locked 2026-04-22): the 16 Tailwind-500 swatches
-- from docs/phase-8/01-barn-calendar.md §B.10. Same set drives
-- animals.color_hex and ranches.color_hex. Enforced by a format
-- check (#RRGGBB); the palette itself lives in the SPA color
-- picker, not in the DB (so design can tweak without a migration).
-- =============================================================
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


-- =============================================================
-- 9) updated_at triggers
--    Reuses the existing public.touch_updated_at() helper from
--    migration 00002. One trigger per table with an updated_at.
-- =============================================================
drop trigger if exists professional_contacts_touch_updated_at on public.professional_contacts;
create trigger professional_contacts_touch_updated_at
  before update on public.professional_contacts
  for each row execute function public.touch_updated_at();

drop trigger if exists barn_event_recurrence_rules_touch_updated_at on public.barn_event_recurrence_rules;
create trigger barn_event_recurrence_rules_touch_updated_at
  before update on public.barn_event_recurrence_rules
  for each row execute function public.touch_updated_at();

drop trigger if exists barn_events_touch_updated_at on public.barn_events;
create trigger barn_events_touch_updated_at
  before update on public.barn_events
  for each row execute function public.touch_updated_at();

drop trigger if exists user_notification_prefs_touch_updated_at on public.user_notification_prefs;
create trigger user_notification_prefs_touch_updated_at
  before update on public.user_notification_prefs
  for each row execute function public.touch_updated_at();


-- =============================================================
-- 10) Attendee current_status + pro response counter
--     AFTER INSERT on barn_event_responses does two things in one
--     pass:
--       a) updates barn_event_attendees.current_status to the new
--          response's status (latest-response-wins — previous
--          statuses remain in barn_event_responses for audit).
--       b) if the new status='confirmed' AND the attendee maps
--          to a professional_contacts row, bump that pro's
--          response_count_confirmed. This is what the Worker's
--          claim-pro-email trigger watches for (threshold=3).
-- =============================================================
create or replace function public.barn_event_response_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pro_contact_id uuid;
begin
  -- (a) update attendee.current_status to the new response status
  update public.barn_event_attendees
     set current_status = NEW.status
   where id = NEW.attendee_id;

  -- (b) on confirm, bump the pro-contact counter
  if NEW.status = 'confirmed' then
    select pro_contact_id into v_pro_contact_id
      from public.barn_event_attendees
     where id = NEW.attendee_id;

    if v_pro_contact_id is not null then
      update public.professional_contacts
         set response_count_confirmed = response_count_confirmed + 1,
             updated_at = now()
       where id = v_pro_contact_id;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists barn_event_responses_after_insert on public.barn_event_responses;
create trigger barn_event_responses_after_insert
  after insert on public.barn_event_responses
  for each row execute function public.barn_event_response_after_insert();


-- =============================================================
-- 11) Post-apply verification
--
--   -- a. RLS enabled on every new table:
--   select c.relname, c.relrowsecurity
--     from pg_class c join pg_namespace n on c.relnamespace = n.oid
--    where n.nspname = 'public'
--      and c.relname in (
--        'professional_contacts','barn_event_recurrence_rules',
--        'barn_events','barn_event_attendees','barn_event_responses',
--        'barn_event_notifications_log','user_notification_prefs'
--      )
--    order by c.relname;
--   -- Expect: 7 rows, relrowsecurity = t on every row.
--
--   -- b. Color columns applied with format checks:
--   select column_name, data_type
--     from information_schema.columns
--    where (table_name, column_name) in (
--            ('animals','color_hex'),
--            ('ranches','color_hex'),
--            ('user_profiles','welcome_tour_barn_seen_at')
--          )
--    order by table_name, column_name;
--   -- Expect: 3 rows, color_hex text, welcome_tour_barn_seen_at timestamptz.
--
--   -- c. Check constraints exist:
--   select conname from pg_constraint
--    where conname in ('animals_color_hex_format','ranches_color_hex_format',
--                      'barn_event_attendees_resolution_check');
--   -- Expect: 3 rows.
--
--   -- d. Policy counts on new tables (no table should have zero):
--   select tablename, count(*) as policy_count
--     from pg_policies
--    where schemaname='public'
--      and tablename in (
--        'professional_contacts','barn_event_recurrence_rules',
--        'barn_events','barn_event_attendees','barn_event_responses',
--        'barn_event_notifications_log','user_notification_prefs'
--      )
--    group by tablename order by tablename;
--   -- Expect: every table >= 1; barn_events >= 4; barn_event_attendees >= 3.
--
--   -- e. Trigger landed:
--   select tgname from pg_trigger
--    where tgname = 'barn_event_responses_after_insert';
--   -- Expect: 1 row.
--
--   -- f. Invalid hex rejected:
--   -- update animals set color_hex = 'not-a-hex' where id = '<some id>';
--   -- Expect: constraint violation on animals_color_hex_format.
-- =============================================================
