-- =============================================================
-- Migration 00030 — audit-swarm hardening (2026-04-24)
--
-- Consolidates the non-config fixes from the 2026-04-24 audit swarm
-- (see docs/audits/2026-04-24-preflight-swarm.md):
--
--   1. Pin `search_path` on 10 functions the Supabase security
--      advisor flagged as mutable. Each function is redefined with
--      `set search_path = public, pg_temp` so a superuser dropping
--      a malicious shim into a different schema can't hijack the
--      call. We do this by ALTER FUNCTION rather than rewriting
--      bodies — safer, and doesn't require re-pasting SECURITY
--      DEFINER bodies we might mis-copy.
--
--   2. Add indexes for foreign keys that currently lack one. The
--      performance advisor flagged 30+; we include the ones that
--      sit on hot paths (messaging, invoicing, media lookups,
--      health thresholds). Cold-path FKs (hubspot_sync_log,
--      seed_run_log, etc.) are left for a later sweep.
--
--   3. Add an explicit admin-only SELECT policy on `promo_codes`.
--      Currently RLS is enabled with zero policies, so the SPA
--      under a user JWT reads empty — which happens to match the
--      "admin-only" design intent but is implicit. Making it
--      explicit is what the advisor wants and matches the pattern
--      used elsewhere in the admin surface.
--
-- Everything is idempotent (`if not exists` / `create or replace`
-- where applicable) so re-running is safe.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. search_path hardening (10 functions from the advisor list)
-- ---------------------------------------------------------------
-- Per the advisor, these functions have no explicit search_path,
-- which means a bad actor who can CREATE in a schema earlier in
-- the caller's search_path could shadow a lookup (e.g. pg_catalog
-- function names, `public.*` types). `ALTER FUNCTION ... SET` is
-- the recommended fix; no body rewrite required.
--
-- NOTE: overloads must be disambiguated by argument types. The
-- functions below are all zero- or one-arg, so the signatures
-- below match exactly what Phase 5/7/8/9 shipped. If a signature
-- has drifted, the ALTER will error; adjust and re-run.

do $$
declare
  fn text;
  signatures text[] := array[
    'public.trg_hubspot_emergency_triggered()',
    'public.trg_hubspot_order_placed()',
    'public.trg_hubspot_trainer_applied()',
    'public.trg_hubspot_trainer_status_changed()',
    'public.trg_hubspot_user_registered()',
    'public.touch_updated_at()',
    'public.touch_horse_message_reads()',
    'public.signed_url_ttl_seconds()',
    'public.my_rating_for_session(uuid)',
    -- horse_messages_unread_total takes no args — it reads
    -- auth.uid() internally as the "me" filter.
    'public.horse_messages_unread_total()'
  ];
begin
  foreach fn in array signatures loop
    begin
      execute format('alter function %s set search_path = public, pg_temp', fn);
    exception when undefined_function then
      -- Function signature may have drifted between environments.
      -- Log and continue so one mismatch doesn't block the rest.
      raise notice 'skip: function % not found', fn;
    end;
  end loop;
end$$;

-- ---------------------------------------------------------------
-- 2. FK indexes on hot paths
-- ---------------------------------------------------------------
-- Messaging: horse_messages is an animal-scoped group chat keyed
-- by (animal_id, sender_id) — no separate recipient column. Both
-- legs benefit from an index since list-my-conversations and
-- list-messages-for-animal are the two hot reads.
create index if not exists horse_messages_sender_idx
  on public.horse_messages(sender_id);
create index if not exists horse_messages_animal_idx
  on public.horse_messages(animal_id);

-- Invoicing: invoice_line_items.source_id is the polymorphic
-- pointer to an order / expense / recurring item. The trainer
-- line-item editor and admin drill-down filter by it.
create index if not exists invoice_line_items_source_idx
  on public.invoice_line_items(source_id)
  where source_id is not null;

-- R2 join from animal_media → r2_objects. Every media list does
-- this — without the index it's a seq scan on animal_media.
create index if not exists animal_media_r2_object_idx
  on public.animal_media(r2_object_id);

-- Health thresholds — per-owner dashboard filter.
create index if not exists health_thresholds_owner_idx
  on public.health_thresholds(owner_id);

-- Protocols: created_by + protocol_id lookups.
create index if not exists animal_protocols_created_by_idx
  on public.animal_protocols(created_by);
create index if not exists animal_protocols_protocol_idx
  on public.animal_protocols(protocol_id);

-- Audit events: actor_id filtered in admin forensics.
create index if not exists animal_archive_events_actor_idx
  on public.animal_archive_events(actor_id);

-- Barn events: invite → user join uses linked_user_id once the
-- invitee has a profile; the pro-contact path uses pro_contact_id.
-- Both are hot paths for "my invites" and "who's coming to X".
create index if not exists barn_event_attendees_linked_user_idx
  on public.barn_event_attendees(linked_user_id)
  where linked_user_id is not null;
create index if not exists barn_event_attendees_pro_contact_idx
  on public.barn_event_attendees(pro_contact_id)
  where pro_contact_id is not null;

-- ---------------------------------------------------------------
-- 3. promo_codes explicit admin-only SELECT
-- ---------------------------------------------------------------
-- promo_codes has `enable row level security` with zero policies,
-- which means PostgREST returns empty for every JWT — including
-- service_role (which bypasses RLS entirely). The intent, per
-- phase 8 decisions, is admin-only read/write. Making that
-- explicit clears the advisor warning and documents the scope
-- inline.

do $$
begin
  if exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'promo_codes'
  ) then
    -- Drop any older placeholder policy so re-running the migration
    -- doesn't duplicate it.
    drop policy if exists promo_codes_admin_read on public.promo_codes;

    create policy promo_codes_admin_read
      on public.promo_codes
      for select
      using (
        exists (
          select 1
          from public.user_profiles up
          where up.user_id = auth.uid()
            and up.role = 'silver_lining'
            and up.status = 'active'
        )
      );
  end if;
end$$;
