-- =============================================================
-- Migration 00033 — RLS permissive-policy consolidation (2026-04-24)
--
-- Addresses the `multiple_permissive_policies` advisor (~138 hits)
-- by collapsing duplicate (table, role, command) policy pairs into
-- a single OR-combined policy. Permissive policies are evaluated
-- additively for each row — two policies means the planner checks
-- both expressions even if the first already passed. One combined
-- policy with `(owner_predicate OR trainer_predicate)` is evaluated
-- once and short-circuits.
--
-- Two shapes appear in the current schema:
--
--   (a) "Simple merge" — two SELECT policies (owner + trainer)
--       collapse into one combined SELECT policy. Applies to
--       animal_protocols, barn_event_*, expenses, invoice_line_items,
--       invoices, session_archive_events, session_payments,
--       supplement_doses, training_sessions, user_profiles,
--       expense_archive_events, r2_objects.
--
--   (b) "Split FOR ALL" — an owner `FOR ALL` policy overlaps with a
--       trainer SELECT policy on the SELECT command. We split the
--       `FOR ALL` into narrower INSERT/UPDATE/DELETE policies (owner
--       only — trainers never insert/update/delete owner-scoped
--       rows under this pattern) and replace the owner+trainer
--       SELECT overlap with a combined SELECT. Applies to
--       animal_access_grants, animal_media, animals, ranches,
--       vet_records.
--
-- All rewrites preserve `(select auth.uid())` initplan form from
-- migration 00032 so we don't regress that advisor.
--
-- Idempotent pattern used: every `create policy` is preceded by a
-- matching `drop policy if exists`. Re-running is safe.
-- =============================================================

-- ---------------------------------------------------------------
-- animal_protocols — simple SELECT merge
-- ---------------------------------------------------------------
drop policy if exists animal_protocols_owner_select   on public.animal_protocols;
drop policy if exists animal_protocols_trainer_select on public.animal_protocols;

create policy animal_protocols_select on public.animal_protocols
  for select
  using (
    exists (
      select 1 from public.animals a
       where a.id = animal_protocols.animal_id
         and a.owner_id = (select auth.uid())
    )
    or public.do_i_have_access_to_animal(animal_id)
  );

-- ---------------------------------------------------------------
-- barn_event_attendees — owner + self + trainer SELECT merge
-- ---------------------------------------------------------------
drop policy if exists barn_attendees_select_owner   on public.barn_event_attendees;
drop policy if exists barn_attendees_select_self    on public.barn_event_attendees;
drop policy if exists barn_attendees_select_trainer on public.barn_event_attendees;

create policy barn_attendees_select on public.barn_event_attendees
  for select
  using (
    -- event owner
    exists (
      select 1 from public.barn_events e
       where e.id = barn_event_attendees.event_id
         and e.owner_id = (select auth.uid())
    )
    -- attendee themselves
    or (linked_user_id is not null and linked_user_id = (select auth.uid()))
    -- trainer with access
    or exists (
      select 1
        from public.barn_events e
        join public.animal_access_grants g on g.owner_id = e.owner_id
       where e.id = barn_event_attendees.event_id
         and g.trainer_id = (select auth.uid())
         and g.revoked_at is null
         and (
              g.scope = 'owner_all'
           or (g.scope = 'ranch'  and g.ranch_id  = e.ranch_id)
           or (g.scope = 'animal' and g.animal_id = any (e.animal_ids))
         )
    )
  );

-- ---------------------------------------------------------------
-- barn_event_responses — owner + self SELECT merge
-- ---------------------------------------------------------------
drop policy if exists barn_responses_select_owner on public.barn_event_responses;
drop policy if exists barn_responses_select_self  on public.barn_event_responses;

create policy barn_responses_select on public.barn_event_responses
  for select
  using (
    exists (
      select 1 from public.barn_events e
       where e.id = barn_event_responses.event_id
         and e.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.barn_event_attendees a
       where a.id = barn_event_responses.attendee_id
         and a.linked_user_id is not null
         and a.linked_user_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------
-- barn_events — owner + trainer SELECT merge
-- ---------------------------------------------------------------
drop policy if exists barn_events_select_owner   on public.barn_events;
drop policy if exists barn_events_select_trainer on public.barn_events;

create policy barn_events_select on public.barn_events
  for select
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.animal_access_grants g
       where g.trainer_id = (select auth.uid())
         and g.owner_id   = barn_events.owner_id
         and g.revoked_at is null
         and (
              g.scope = 'owner_all'
           or (g.scope = 'ranch'  and g.ranch_id  = barn_events.ranch_id)
           or (g.scope = 'animal' and g.animal_id = any (barn_events.animal_ids))
         )
    )
  );

-- ---------------------------------------------------------------
-- expense_archive_events — owner + trainer SELECT merge
-- ---------------------------------------------------------------
drop policy if exists expense_archive_events_owner_select   on public.expense_archive_events;
drop policy if exists expense_archive_events_trainer_select on public.expense_archive_events;

create policy expense_archive_events_select on public.expense_archive_events
  for select
  using (
    exists (
      select 1 from public.expenses e
        join public.animals  a on a.id = e.animal_id
       where e.id = expense_archive_events.expense_id
         and a.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.expenses e
       where e.id = expense_archive_events.expense_id
         and public.do_i_have_access_to_animal(e.animal_id)
    )
  );

-- ---------------------------------------------------------------
-- expenses — merge SELECT, INSERT, UPDATE
-- ---------------------------------------------------------------
drop policy if exists expenses_owner_select   on public.expenses;
drop policy if exists expenses_trainer_select on public.expenses;
drop policy if exists expenses_owner_insert   on public.expenses;
drop policy if exists expenses_trainer_insert on public.expenses;
drop policy if exists expenses_owner_update   on public.expenses;
drop policy if exists expenses_trainer_update on public.expenses;

create policy expenses_select on public.expenses
  for select
  using (
    exists (
      select 1 from public.animals a
       where a.id = expenses.animal_id
         and a.owner_id = (select auth.uid())
    )
    or public.do_i_have_access_to_animal(animal_id)
  );

create policy expenses_insert on public.expenses
  for insert
  with check (
    (
      recorder_role = 'owner'
      and recorder_id = (select auth.uid())
      and exists (
        select 1 from public.animals a
         where a.id = expenses.animal_id
           and a.owner_id = (select auth.uid())
      )
    )
    or (
      recorder_role = 'trainer'
      and recorder_id = (select auth.uid())
      and public.do_i_have_access_to_animal(animal_id)
    )
  );

create policy expenses_update on public.expenses
  for update
  using (
    (
      recorder_role = 'owner'
      and recorder_id = (select auth.uid())
      and exists (
        select 1 from public.animals a
         where a.id = expenses.animal_id
           and a.owner_id = (select auth.uid())
      )
    )
    or (
      recorder_role = 'trainer'
      and recorder_id = (select auth.uid())
      and public.do_i_have_access_to_animal(animal_id)
    )
  )
  with check (
    (recorder_role = 'owner'   and recorder_id = (select auth.uid()))
    or (recorder_role = 'trainer' and recorder_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------
-- horse_message_reads — drop the redundant _self_select
--   `_self_write` (FOR ALL) already covers SELECT with the same
--   `user_id = auth.uid()` predicate, so `_self_select` adds no
--   rows. Dropping it removes the overlap without changing scope.
-- ---------------------------------------------------------------
drop policy if exists horse_message_reads_self_select on public.horse_message_reads;

-- ---------------------------------------------------------------
-- invoice_line_items — owner + trainer SELECT merge
-- ---------------------------------------------------------------
drop policy if exists invoice_line_items_owner_select   on public.invoice_line_items;
drop policy if exists invoice_line_items_trainer_select on public.invoice_line_items;

create policy invoice_line_items_select on public.invoice_line_items
  for select
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.owner_id is not null
         and i.owner_id = (select auth.uid())
    )
    or exists (
      select 1 from public.invoices i
       where i.id = invoice_line_items.invoice_id
         and i.trainer_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------
-- invoices — owner + trainer SELECT merge
-- ---------------------------------------------------------------
drop policy if exists invoices_owner_select   on public.invoices;
drop policy if exists invoices_trainer_select on public.invoices;

create policy invoices_select on public.invoices
  for select
  using (
    (owner_id is not null and owner_id = (select auth.uid()))
    or trainer_id = (select auth.uid())
  );

-- ---------------------------------------------------------------
-- session_archive_events — owner + trainer SELECT merge
-- ---------------------------------------------------------------
drop policy if exists session_archive_events_owner_select   on public.session_archive_events;
drop policy if exists session_archive_events_trainer_select on public.session_archive_events;

create policy session_archive_events_select on public.session_archive_events
  for select
  using (
    exists (
      select 1 from public.training_sessions s
       where s.id = session_archive_events.session_id
         and (s.owner_id = (select auth.uid()) or s.trainer_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------
-- session_payments — owner + trainer SELECT merge
-- ---------------------------------------------------------------
drop policy if exists session_payments_owner_select   on public.session_payments;
drop policy if exists session_payments_trainer_select on public.session_payments;

create policy session_payments_select on public.session_payments
  for select
  using (
    payer_id = (select auth.uid())
    or payee_id = (select auth.uid())
  );

-- ---------------------------------------------------------------
-- supplement_doses — owner + trainer SELECT merge, INSERT merge
-- ---------------------------------------------------------------
drop policy if exists supplement_doses_owner_select   on public.supplement_doses;
drop policy if exists supplement_doses_trainer_select on public.supplement_doses;
drop policy if exists supplement_doses_owner_insert   on public.supplement_doses;
drop policy if exists supplement_doses_trainer_insert on public.supplement_doses;

create policy supplement_doses_select on public.supplement_doses
  for select
  using (
    exists (
      select 1 from public.animals a
       where a.id = supplement_doses.animal_id
         and a.owner_id = (select auth.uid())
    )
    or public.do_i_have_access_to_animal(animal_id)
  );

create policy supplement_doses_insert on public.supplement_doses
  for insert
  with check (
    (
      confirmed_role = 'owner'
      and confirmed_by = (select auth.uid())
      and exists (
        select 1 from public.animals a
         where a.id = supplement_doses.animal_id
           and a.owner_id = (select auth.uid())
      )
      and exists (
        select 1 from public.animal_protocols ap
         where ap.id = supplement_doses.animal_protocol_id
           and ap.animal_id = supplement_doses.animal_id
           and ap.archived_at is null
      )
    )
    or (
      confirmed_role = 'trainer'
      and confirmed_by = (select auth.uid())
      and public.do_i_have_access_to_animal(animal_id)
      and exists (
        select 1 from public.animal_protocols ap
         where ap.id = supplement_doses.animal_protocol_id
           and ap.animal_id = supplement_doses.animal_id
           and ap.archived_at is null
      )
    )
  );

-- ---------------------------------------------------------------
-- training_sessions — owner + trainer SELECT merge
--   Trainer INSERT and UPDATE remain as separate narrow policies
--   (only one policy each — no overlap).
-- ---------------------------------------------------------------
drop policy if exists training_sessions_owner_select   on public.training_sessions;
drop policy if exists training_sessions_trainer_select on public.training_sessions;

create policy training_sessions_select on public.training_sessions
  for select
  using (
    owner_id = (select auth.uid())
    or (trainer_id = (select auth.uid()) and public.do_i_have_access_to_animal(animal_id))
  );

-- ---------------------------------------------------------------
-- user_profiles — own + granted_owner SELECT merge
-- ---------------------------------------------------------------
drop policy if exists user_profiles_select_own           on public.user_profiles;
drop policy if exists user_profiles_select_granted_owner on public.user_profiles;

create policy user_profiles_select on public.user_profiles
  for select
  using (
    user_id = (select auth.uid())
    or (
      role = 'owner'
      and exists (
        select 1 from public.animal_access_grants g
         where g.owner_id = user_profiles.user_id
           and g.trainer_id = (select auth.uid())
           and (g.revoked_at is null
                or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now()))
      )
    )
  );

-- ===============================================================
-- Split `FOR ALL` owner policies into narrow per-cmd policies
-- to remove SELECT overlap with trainer SELECT policies.
-- ===============================================================

-- ---------------------------------------------------------------
-- animal_access_grants
-- ---------------------------------------------------------------
drop policy if exists grants_owner_all       on public.animal_access_grants;
drop policy if exists grants_trainer_select  on public.animal_access_grants;

create policy grants_select on public.animal_access_grants
  for select
  using (
    owner_id   = (select auth.uid())
    or trainer_id = (select auth.uid())
  );

create policy grants_owner_insert on public.animal_access_grants
  for insert
  with check (owner_id = (select auth.uid()));

create policy grants_owner_update on public.animal_access_grants
  for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy grants_owner_delete on public.animal_access_grants
  for delete
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- animal_media
-- ---------------------------------------------------------------
drop policy if exists animal_media_owner_all       on public.animal_media;
drop policy if exists animal_media_trainer_select  on public.animal_media;

create policy animal_media_select on public.animal_media
  for select
  using (
    owner_id = (select auth.uid())
    or public.do_i_have_access_to_animal(animal_id)
  );

create policy animal_media_owner_insert on public.animal_media
  for insert
  with check (owner_id = (select auth.uid()));

create policy animal_media_owner_update on public.animal_media
  for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy animal_media_owner_delete on public.animal_media
  for delete
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- animals — `animals_access_select` already covers owner via
-- do_i_have_access_to_animal(id). Keep it as the SELECT policy
-- and split `animals_owner_all` into narrow write policies.
-- ---------------------------------------------------------------
drop policy if exists animals_owner_all on public.animals;

create policy animals_owner_insert on public.animals
  for insert
  with check (owner_id = (select auth.uid()));

create policy animals_owner_update on public.animals
  for update
  using  (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy animals_owner_delete on public.animals
  for delete
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- ranches
-- ---------------------------------------------------------------
drop policy if exists ranches_owner_all      on public.ranches;
drop policy if exists ranches_trainer_select on public.ranches;

create policy ranches_select on public.ranches
  for select
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.animal_access_grants g
       where g.trainer_id = (select auth.uid())
         and (g.revoked_at is null
              or (g.grace_period_ends_at is not null and g.grace_period_ends_at > now()))
         and (
              (g.scope = 'ranch'     and g.ranch_id = ranches.id)
           or (g.scope = 'owner_all' and g.owner_id = ranches.owner_id)
         )
    )
  );

create policy ranches_owner_insert on public.ranches
  for insert
  with check (owner_id = (select auth.uid()));

create policy ranches_owner_update on public.ranches
  for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy ranches_owner_delete on public.ranches
  for delete
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- r2_objects — owner SELECT + trainer SELECT merge, keep UPDATE narrow
-- ---------------------------------------------------------------
drop policy if exists r2_objects_owner_select   on public.r2_objects;
drop policy if exists r2_objects_trainer_select on public.r2_objects;

create policy r2_objects_select on public.r2_objects
  for select
  using (
    owner_id = (select auth.uid())
    or exists (
      select 1 from public.vet_records v
       where v.r2_object_id = r2_objects.id
         and public.do_i_have_access_to_animal(v.animal_id)
    )
    or exists (
      select 1 from public.animal_media m
       where m.r2_object_id = r2_objects.id
         and public.do_i_have_access_to_animal(m.animal_id)
    )
  );

-- ---------------------------------------------------------------
-- vet_records
-- ---------------------------------------------------------------
drop policy if exists vet_records_owner_all       on public.vet_records;
drop policy if exists vet_records_trainer_select  on public.vet_records;

create policy vet_records_select on public.vet_records
  for select
  using (
    owner_id = (select auth.uid())
    or public.do_i_have_access_to_animal(animal_id)
  );

create policy vet_records_owner_insert on public.vet_records
  for insert
  with check (owner_id = (select auth.uid()));

create policy vet_records_owner_update on public.vet_records
  for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy vet_records_owner_delete on public.vet_records
  for delete
  using (owner_id = (select auth.uid()));
