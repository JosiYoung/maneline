-- =============================================================
-- 00038_phase9_platform_fee_gross_up.sql
--
-- Switches platform-fee model:
--   • Trainer lists a session price T.
--   • Owner pays T + a grossed-up service fee that covers Stripe
--     processing + the platform's owner-side margin.
--   • Trainer receives T minus a small platform deduction
--     (trainer-side margin only — no Stripe absorption).
--   • Platform's application_fee_amount on Stripe is the sum of
--     (owner gross-up) + (trainer deduction). With the
--     application_express controller, Stripe processing fees are
--     pulled from the platform's slice, leaving the platform's net
--     equal to (owner-side margin) + (trainer-side margin).
--
-- Defaults seeded here:
--   owner-side margin   = 0.5% + $0.10  (0.5% × T + $0.10 platform net)
--   trainer-side margin = 2.0% + $0.00  (flat 2% deduction from T)
-- Net effect on a $200 session:
--   • Owner pays    ~$207.41  (advertised as 3.4% + $0.40 service fee;
--                              actual is ~3.7% + $0.40 because the 2.9%
--                              Stripe fee compounds on the grossed-up total)
--   • Trainer nets  $196.00   (= T − 2% × T)
--   • Stripe takes  ~$6.32
--   • Platform nets ~$5.09    (≈ 2.5% × T + $0.10)
-- Per-trainer override (`fee_override_bps`) continues to override
-- the owner-side percentage only — that's the bigger lever for
-- discounting a specific trainer's listings.
--
-- Stripe processing constants (2.9% + $0.30) live in the Worker.
-- =============================================================

-- ---------- platform_settings ----------
alter table public.platform_settings
  add column if not exists default_fee_flat_cents int not null default 10
    check (default_fee_flat_cents >= 0 and default_fee_flat_cents <= 10000),
  add column if not exists default_trainer_fee_bps int not null default 200
    check (default_trainer_fee_bps >= 0 and default_trainer_fee_bps <= 10000),
  add column if not exists default_trainer_fee_flat_cents int not null default 0
    check (default_trainer_fee_flat_cents >= 0 and default_trainer_fee_flat_cents <= 10000);

-- Reset existing row to the new defaults. Pre-existing
-- fee_override_bps rows on stripe_connect_accounts are left intact.
update public.platform_settings
set
  default_fee_bps                = 50,    -- 0.5% owner-side margin
  default_fee_flat_cents         = 10,    -- $0.10 owner-side flat
  default_trainer_fee_bps        = 200,   -- 2.0% trainer-side deduction
  default_trainer_fee_flat_cents = 0,     -- no flat trainer-side
  updated_at                     = now()
where id = 1;

-- ---------- session_payments ----------
alter table public.session_payments
  add column if not exists gross_amount_cents int
    check (gross_amount_cents is null or gross_amount_cents >= 0),
  add column if not exists stripe_fee_estimate_cents int
    check (stripe_fee_estimate_cents is null or stripe_fee_estimate_cents >= 0),
  add column if not exists owner_surcharge_cents int
    check (owner_surcharge_cents is null or owner_surcharge_cents >= 0),
  add column if not exists trainer_cut_cents int
    check (trainer_cut_cents is null or trainer_cut_cents >= 0);

comment on column public.session_payments.amount_cents is
  'Trainer''s listed session price (T). Audit anchor — never includes fees.';
comment on column public.session_payments.platform_fee_cents is
  'application_fee_amount sent to Stripe. Equals owner_surcharge_cents + trainer_cut_cents.';
comment on column public.session_payments.gross_amount_cents is
  'Total charged to the owner''s card (= amount_cents + owner_surcharge_cents).';
comment on column public.session_payments.stripe_fee_estimate_cents is
  'Worker''s pre-charge estimate of Stripe''s 2.9%+30c fee on gross_amount_cents.';
comment on column public.session_payments.owner_surcharge_cents is
  'Owner-side service fee shown to the owner at checkout. Covers Stripe processing + owner-side platform margin.';
comment on column public.session_payments.trainer_cut_cents is
  'Trainer-side platform fee deducted from amount_cents before transfer. Trainer''s net = amount_cents - trainer_cut_cents.';
