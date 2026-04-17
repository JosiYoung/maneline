import type { Step1Data } from './shared';
import type { OwnerStep2Data } from './OwnerStep';
import type { TrainerStep2Data } from './TrainerStep';

/**
 * Build the `options.data` payload for Supabase's signInWithOtp call.
 *
 * IMPORTANT: this MUST match the keys read by handle_new_user() in
 * supabase/migrations/00002 + 00004. After the Phase 0 hardening
 * migration, the trigger only reads these canonical keys:
 *
 *   role, full_name, display_name, phone, location,
 *   owner_discipline,
 *   first_horse : { barn_name, breed, sex, year_born, discipline },
 *   bio (trainer),
 *   trainer_application : { ... } (trainer)
 *
 * The previous `first_animal` / `discipline` aliases have been removed
 * on BOTH sides in the same commit. If you add a key, add it in the
 * trigger first, then here.
 */
export function buildMetadata(
  s1: Step1Data,
  owner: OwnerStep2Data,
  trainer: TrainerStep2Data,
) {
  const base = {
    role: s1.role,
    full_name: s1.full_name.trim(),
    display_name: s1.full_name.trim(),
    phone: s1.phone.trim(),
  };

  if (s1.role === 'owner') {
    const horse = owner.include_horse && owner.barn_name.trim() ? {
      barn_name: owner.barn_name.trim(),
      breed: owner.breed.trim(),
      sex: owner.sex.trim(),
      year_born: owner.year_born.trim(),
      discipline: owner.horse_discipline.trim(),
    } : null;

    return {
      ...base,
      location: owner.location.trim(),
      owner_discipline: owner.owner_discipline.trim(),
      marketing_opt_in: owner.marketing_opt_in,
      ...(horse ? { first_horse: horse } : {}),
    };
  }

  if (s1.role === 'trainer') {
    const certs = trainer.certifications
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const references = [trainer.reference_1, trainer.reference_2]
      .filter((r) => r.name.trim() || r.contact.trim());

    const application = {
      business_name: trainer.business_name.trim(),
      years_training: trainer.years_training.trim(),
      primary_discipline: trainer.primary_discipline.trim(),
      certifications: certs,
      insurance_carrier: trainer.insurance_carrier.trim(),
      references,
      consent_vetting: trainer.consent_vetting,
      consent_vetting_at: new Date().toISOString(),
    };

    return {
      ...base,
      bio: trainer.bio.trim(),
      marketing_opt_in: trainer.marketing_opt_in,
      trainer_application: application,
    };
  }

  // silver_lining
  return base;
}
