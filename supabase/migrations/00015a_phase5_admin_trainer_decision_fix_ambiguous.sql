-- Applied remotely as 20260419232049_phase5_admin_trainer_decision_fix_ambiguous.
-- Backfilled into the local tree 2026-04-20 so `supabase db pull` / fresh
-- checkouts see the same function signature as prod.
--
-- Fix: the original phase5_admin_trainer_decision migration named its
-- `review_notes` parameter the same as the trainer_profiles column,
-- which caused "column reference 'review_notes' is ambiguous" under
-- PLpgSQL's default variable-shadows-column behavior. This migration
-- drops the old function and recreates it with `p_review_notes`.

drop function if exists public.admin_decide_trainer(uuid, text, uuid, text);

create or replace function public.admin_decide_trainer(
  app_id        uuid,
  decision      text,
  reviewer      uuid,
  p_review_notes text default null
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
  if decision not in ('approved','rejected') then
    raise exception 'bad_decision:%', decision;
  end if;

  select user_id into v_user_id
  from public.trainer_applications
  where id = app_id;

  if v_user_id is null then
    raise exception 'app_not_found';
  end if;

  if decision = 'approved' then
    v_new_app  := 'approved';
    v_new_user := 'active';
  else
    v_new_app  := 'rejected';
    v_new_user := 'suspended';
  end if;

  update public.trainer_applications
     set status      = v_new_app,
         updated_at  = now()
   where id = app_id;

  update public.trainer_profiles
     set application_status = v_new_app,
         reviewed_by        = reviewer,
         reviewed_at        = now(),
         review_notes       = p_review_notes,
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
    'review_notes',   p_review_notes
  );
end;
$$;

revoke execute on function public.admin_decide_trainer(uuid, text, uuid, text) from public, anon, authenticated;
