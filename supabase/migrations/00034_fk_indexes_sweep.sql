-- =============================================================
-- Migration 00034 — FK indexes sweep (2026-04-24)
--
-- Closes out the `unindexed_foreign_keys` advisor by creating a
-- covering index on every FK column that didn't already have one.
-- Migration 00030 covered the hot messaging/invoicing/media paths;
-- this pass covers the remaining 31 cold-path FKs (admin audit,
-- ops, recurring, invitations, etc.).
--
-- Pattern: `CREATE INDEX IF NOT EXISTS <table>_<col>_idx ON …`.
-- Partial-index WHERE clauses are added where the FK column is
-- nullable and most rows are expected to be null (keeps the index
-- small and the planner happy).
--
-- All indexes are low-cost to add: most of these tables carry < 10k
-- rows, and the write amplification is trivial compared to the
-- planner benefit when PostgREST joins through these FKs.
-- =============================================================

-- Messaging / notifications
create index if not exists barn_event_notifications_log_attendee_idx on public.barn_event_notifications_log(attendee_id);
create index if not exists barn_event_responses_responder_user_idx  on public.barn_event_responses(responder_user_id) where responder_user_id is not null;
create index if not exists barn_events_created_by_idx               on public.barn_events(created_by);

-- Care matrix + health
create index if not exists care_matrix_entries_updated_by_idx          on public.care_matrix_entries(updated_by);
create index if not exists health_dashboard_acknowledgements_animal_idx on public.health_dashboard_acknowledgements(animal_id);

-- Expenses / orders
create index if not exists expense_archive_events_actor_idx    on public.expense_archive_events(actor_id);
create index if not exists expenses_order_idx                  on public.expenses(order_id)              where order_id is not null;
create index if not exists expenses_product_idx                on public.expenses(product_id)            where product_id is not null;
create index if not exists expenses_receipt_r2_object_idx      on public.expenses(receipt_r2_object_id)  where receipt_r2_object_id is not null;
create index if not exists order_line_items_product_idx        on public.order_line_items(product_id);
create index if not exists order_refunds_refunded_by_idx       on public.order_refunds(refunded_by);

-- Chat
create index if not exists horse_message_reads_animal_idx on public.horse_message_reads(animal_id);

-- Invitations + onboarding
create index if not exists invitations_accepted_user_idx on public.invitations(accepted_user_id) where accepted_user_id is not null;
create index if not exists invitations_invited_by_idx   on public.invitations(invited_by);

-- Professionals + contacts
create index if not exists professional_contacts_linked_user_idx on public.professional_contacts(linked_user_id) where linked_user_id is not null;

-- Admin / promo / platform
create index if not exists promo_codes_created_by_idx         on public.promo_codes(created_by);
create index if not exists promo_codes_redeemed_by_owner_idx  on public.promo_codes(redeemed_by_owner_id) where redeemed_by_owner_id is not null;
create index if not exists platform_settings_updated_by_idx   on public.platform_settings(updated_by);

-- Protocols + supplements
create index if not exists protocols_product_idx          on public.protocols(product_id) where product_id is not null;
create index if not exists supplement_doses_confirmed_by_idx on public.supplement_doses(confirmed_by);

-- Recurring invoicing
create index if not exists recurring_line_items_animal_idx on public.recurring_line_items(animal_id);
create index if not exists recurring_line_items_owner_idx  on public.recurring_line_items(owner_id);

-- Audit + forensics
create index if not exists session_archive_events_actor_idx on public.session_archive_events(actor_id);
create index if not exists session_ratings_rater_idx        on public.session_ratings(rater_id);

-- Ops / on-call
create index if not exists sms_dispatches_on_call_user_idx on public.sms_dispatches(on_call_user_id);

-- Facility
create index if not exists stall_assignments_assigned_by_idx  on public.stall_assignments(assigned_by);
create index if not exists turnout_group_members_added_by_idx on public.turnout_group_members(added_by);

-- Stripe
create index if not exists stripe_connect_accounts_fee_override_set_by_idx on public.stripe_connect_accounts(fee_override_set_by) where fee_override_set_by is not null;

-- Trainer ops
create index if not exists trainer_customer_map_owner_idx   on public.trainer_customer_map(owner_id);
create index if not exists trainer_profiles_reviewed_by_idx on public.trainer_profiles(reviewed_by) where reviewed_by is not null;

-- Media
create index if not exists vet_records_r2_object_idx on public.vet_records(r2_object_id) where r2_object_id is not null;
