-- =============================================================
-- Migration 00026 — expense ↔ training_session link
--
-- Adds an optional session_id FK to expenses so trainers can
-- attach expenses to a specific session at log time. The owner
-- sees these expenses on the session detail / approve-and-pay
-- view as a read-only list alongside the session summary.
--
-- Design notes:
--   - Nullable: most expenses are not tied to a session.
--   - ON DELETE SET NULL: archiving a session does not remove
--     the expense; it simply disassociates it.
--   - No new RLS policies needed — existing animal-based
--     owner_select / trainer_select policies already gate rows
--     at the animal level, which covers session-linked rows.
-- =============================================================

alter table public.expenses
  add column if not exists session_id uuid
    references public.training_sessions(id)
    on delete set null;

create index if not exists expenses_session_idx
  on public.expenses(session_id)
  where session_id is not null;
