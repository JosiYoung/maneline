-- 00037_admin_trainer_revoke_ban
-- =============================================================
-- UAT follow-up: admins need actions on the Approved trainer queue
-- to take a working trainer offline. Two new terminal-ish states:
--
--   revoked — reversible. Trainer's portal access is shut off (user
--             status flips to 'suspended') but they can re-apply or
--             we can re-approve them. application_status='revoked'
--             so the row is distinguishable from a fresh rejection.
--
--   banned  — terminal. Same effect on access (user status is set to
--             a new 'banned' value so we don't conflate with
--             vacation-suspended trainers), but the application is
--             marked 'banned' to prevent re-approval without explicit
--             admin override.
--
-- Both decisions REQUIRE a non-empty notes field — the UI enforces
-- this and we re-check at the RPC layer so an admin can't slip a
-- silent revoke in via the API.
-- =============================================================

-- 1) Extend application_status check on trainer_profiles +
--    trainer_applications. We also accept the existing values so
--    the backfill is pure addition.

alter table public.trainer_profiles
  drop constraint if exists trainer_profiles_application_status_check;

alter table public.trainer_profiles
  add constraint trainer_profiles_application_status_check
  check (application_status in (
    'submitted','approved','rejected','suspended','revoked','banned'
  ));

alter table public.trainer_applications
  drop constraint if exists trainer_applications_status_check;

alter table public.trainer_applications
  add constraint trainer_applications_status_check
  check (status in (
    'submitted','approved','rejected','withdrawn','archived','revoked','banned'
  ));

-- 2) Extend user_profiles.status so we can flag a banned account
--    distinctly from suspended (suspended trainers can come back;
--    banned ones cannot without admin intervention).

alter table public.user_profiles
  drop constraint if exists user_profiles_status_check;

alter table public.user_profiles
  add constraint user_profiles_status_check
  check (status in (
    'active','pending_review','suspended','archived','banned'
  ));

-- 3) admin_revoke_or_ban_trainer — companion to admin_decide_trainer.
--    Keyed off the application id (the same id the admin UI already
--    has). Notes are required (raises bad_notes if blank/null).

drop function if exists public.admin_revoke_or_ban_trainer(uuid, text, uuid, text);

create or replace function public.admin_revoke_or_ban_trainer(
  app_id          uuid,
  action_kind     text,
  reviewer        uuid,
  p_review_notes  text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id      uuid;
  v_new_app      text;
  v_new_user     text;
  v_email        text;
  v_display_name text;
begin
  if action_kind not in ('revoke','ban') then
    raise exception 'bad_action:%', action_kind;
  end if;

  if p_review_notes is null or btrim(p_review_notes) = '' then
    raise exception 'bad_notes';
  end if;

  select user_id into v_user_id
  from public.trainer_applications
  where id = app_id;

  if v_user_id is null then
    raise exception 'app_not_found';
  end if;

  if action_kind = 'revoke' then
    v_new_app  := 'revoked';
    v_new_user := 'suspended';
  else
    v_new_app  := 'banned';
    v_new_user := 'banned';
  end if;

  update public.trainer_applications
     set status     = v_new_app,
         updated_at = now()
   where id = app_id;

  update public.trainer_profiles
     set application_status = v_new_app,
         reviewed_by        = reviewer,
         reviewed_at        = now(),
         review_notes       = btrim(p_review_notes),
         updated_at         = now()
   where user_id = v_user_id;

  update public.user_profiles
     set status     = v_new_user,
         updated_at = now()
   where user_id = v_user_id;

  select email, display_name
    into v_email, v_display_name
  from public.user_profiles
  where user_id = v_user_id;

  return jsonb_build_object(
    'application_id', app_id,
    'user_id',        v_user_id,
    'email',          v_email,
    'display_name',   v_display_name,
    'decision',       v_new_app,
    'user_status',    v_new_user,
    'review_notes',   btrim(p_review_notes)
  );
end;
$$;

revoke execute on function public.admin_revoke_or_ban_trainer(uuid, text, uuid, text) from public, anon, authenticated;
