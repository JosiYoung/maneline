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
 * As of Phase 0 hardening, the Worker's /join route is a 301 redirect to
 * /signup (the legacy inline HTML signup was deleted), so this flag is the
 * only thing that governs which signup UI the user sees.
 */
export default function SignupPage() {
  const { flags } = useFeatureFlags();

  if (flags.signup_v2) {
    return <SignupV2 />;
  }
  return <SignupV1 />;
}
