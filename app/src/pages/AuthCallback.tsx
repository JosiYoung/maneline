import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { homeForRole } from '../components/ProtectedRoute';
import { claimInvitation } from '../lib/invitations';

const PENDING_INVITE_KEY = 'maneline:pending-invite-token';

// Where the magic-link redirects land. Supabase processes the URL fragment
// via detectSessionInUrl=true in the createClient call; we just wait for the
// authStore to see the new session, then bounce to the right portal.
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const loading = useAuthStore((s) => s.loading);

  useEffect(() => {
    if (loading) return;

    const next = params.get('next');

    if (!session) {
      navigate('/login?error=invalid_link', { replace: true });
      return;
    }

    // Phase 6.2 — consume a pending invite token if one was stashed before
    // Supabase redirected us through the magic link. Claim-invite is
    // idempotent; a stale token just errors and we continue to the portal.
    const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
    if (pendingInvite) {
      sessionStorage.removeItem(PENDING_INVITE_KEY);
      void claimInvitation(pendingInvite)
        .catch(() => { /* swallow — non-fatal */ })
        .finally(() => {
          if (next) {
            navigate(next, { replace: true });
          } else if (profile) {
            navigate(homeForRole(profile.role), { replace: true });
          } else {
            navigate('/signup/complete-profile', { replace: true });
          }
        });
      return;
    }

    if (next) {
      navigate(next, { replace: true });
      return;
    }

    if (profile) {
      navigate(homeForRole(profile.role), { replace: true });
    } else {
      navigate('/signup/complete-profile', { replace: true });
    }
  }, [loading, session, profile, params, navigate]);

  return (
    <main style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
      Signing you in…
    </main>
  );
}
