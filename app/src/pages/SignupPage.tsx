import { useFeatureFlags } from '../lib/featureFlags';
import SignupV1 from './SignupV1';
import SignupV2 from './SignupV2';

/**
 * /signup entry point.
 *
 * Reads the `feature:signup_v2` flag from /api/flags and renders:
 *   - SignupV2 (two-step, role-aware) when flag = true (default)
 *   - SignupV1 (single-step legacy waitlist form) when flag = false
 *
 * Both flows submit via Supabase magic-link auth and end on /check-email.
 * The live /join route in the Worker remains unchanged either way — this
 * flag only governs the SPA's /signup experience, not the legacy waitlist
 * page.
 */
export default function SignupPage() {
  const { flags } = useFeatureFlags();

  if (flags.signup_v2) {
    return <SignupV2 />;
  }
  return <SignupV1 />;
}
