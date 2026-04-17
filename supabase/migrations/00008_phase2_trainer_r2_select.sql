-- Phase 2 Prompt 2.4 — trainer read-only animal view.
--
-- The trainer UI (VetRecordsList / MediaGallery) calls the Worker endpoint
-- /api/uploads/read-url (worker.js:930) to fetch a 5-minute signed GET,
-- and that endpoint takes `object_key` as its input. The Worker still
-- re-verifies trainer access via do_i_have_access_to_animal before
-- issuing the URL — this policy doesn't weaken that check; it just lets
-- the client resolve the object_key pointer from the typed row the
-- trainer is already allowed to read.
--
-- Phase 1's 00005:115-119 comment ("Trainers DO NOT read r2_objects
-- directly") was written before the trainer animal view was planned.
-- Resolve the conflict in favor of the feature: trainer SELECT is
-- transitively scoped to objects referenced by vet_records or
-- animal_media that the trainer already has access to.

drop policy if exists "r2_objects_trainer_select" on public.r2_objects;
create policy "r2_objects_trainer_select" on public.r2_objects
  for select using (
    exists (
      select 1
      from public.vet_records v
      where v.r2_object_id = r2_objects.id
        and public.do_i_have_access_to_animal(v.animal_id)
    )
    or exists (
      select 1
      from public.animal_media m
      where m.r2_object_id = r2_objects.id
        and public.do_i_have_access_to_animal(m.animal_id)
    )
  );
