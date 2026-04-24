-- =============================================================
-- Migration 00031 — expand r2_objects.kind CHECK domain
--
-- The 2026-04-24 DB workflow verification (task a61de6a5c3b825b20)
-- caught that the Worker + SPA upload pipeline writes two `kind`
-- values — `expense_receipt` (Phase 3 / Phase 8 module 04-04) and
-- `trainer_logo` (Phase 7 trainer branding) — that the original
-- Phase 1 CHECK constraint still rejects.
--
-- Net result today: any call to /api/uploads/commit for those kinds
-- fails at the DB with SQLSTATE 23514 (`r2_objects_kind_check`).
-- The Worker deploy is gated on `expense_receipt` being accepted
-- (tech-debt 04-04), and trainer logo uploads silently never land.
--
-- Fix: swap the CHECK for the full enum set the application writes.
-- `ALTER … DROP CONSTRAINT … ADD CONSTRAINT` is the standard
-- pattern; the table is small so rewriting the check is cheap even
-- on production data.
-- =============================================================

alter table public.r2_objects
  drop constraint if exists r2_objects_kind_check;

alter table public.r2_objects
  add constraint r2_objects_kind_check
  check (kind in (
    'vet_record',
    'animal_photo',
    'animal_video',
    'records_export',
    'expense_receipt',  -- Phase 3 / Phase 8 module 04-04
    'trainer_logo'      -- Phase 7 trainer branding
  ));

-- No existing rows need migration: the failed-insert path never
-- persisted the bad kinds, so the table only holds values already
-- in the new list. (If a row slipped in via service_role bypass,
-- the CHECK re-add would fail and we'd need to clean up — the
-- advisor has never reported such a row.)
