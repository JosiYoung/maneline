-- Phase 7 PR #7 — propagate trainer branding to the connected Stripe
-- account so the hosted-invoice page + PDF render with the trainer's
-- identity (logo, primary color, business name).
--
-- We push the logo as a Stripe File (files.stripe.com), then PATCH the
-- connected account with settings.branding.{icon,primary_color} and
-- business_profile.name. The File upload is not free (a few KB per
-- upload, plus one API call), so we cache the file id alongside the R2
-- key that produced it — next sync reuses the file unless the trainer
-- uploaded a new logo.
--
-- All three columns are nullable + default null. Sync is a one-way
-- push (Mane Line -> Stripe); we never overwrite what Stripe tells us
-- back.

alter table public.trainer_profiles
  add column if not exists invoice_logo_stripe_file_id  text,
  add column if not exists invoice_logo_stripe_file_key text,
  add column if not exists branding_synced_at           timestamptz;

comment on column public.trainer_profiles.invoice_logo_stripe_file_id  is
  'Phase 7 PR #7 — Stripe File id (file_xxx) pointing at the logo upload; used in settings.branding.icon.';
comment on column public.trainer_profiles.invoice_logo_stripe_file_key is
  'Phase 7 PR #7 — R2 object key that produced the cached Stripe File id. Lets the sync step short-circuit when the logo has not changed.';
comment on column public.trainer_profiles.branding_synced_at is
  'Phase 7 PR #7 — last time /api/trainer/branding/sync successfully pushed to the connected account.';
