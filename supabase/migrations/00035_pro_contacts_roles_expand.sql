-- =============================================================
-- Migration 00035 — professional_contacts role CHECK expand (2026-04-24)
--
-- The SPA BarnContacts form offers 8 role categories
-- (farrier | vet | nutritionist | bodyworker | trainer | boarding |
-- hauler | other) but the original CHECK only accepts
-- trainer | vet | farrier | staff | other, so four of the SPA roles
-- always 400 at the Worker validator + would violate the CHECK if
-- the Worker were loosened. Expand the CHECK to match the SPA surface
-- and keep `staff` for backwards compatibility with any already-saved
-- rows. Worker.js BARN_CONTACT_ROLES is updated in the same change.
-- =============================================================

alter table public.professional_contacts
  drop constraint if exists professional_contacts_role_check;

alter table public.professional_contacts
  add constraint professional_contacts_role_check
  check (role in (
    'farrier',
    'vet',
    'nutritionist',
    'bodyworker',
    'trainer',
    'boarding',
    'hauler',
    'staff',
    'other'
  ));
