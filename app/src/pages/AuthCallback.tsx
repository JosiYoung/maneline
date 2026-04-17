import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { homeForRole } from '../components/ProtectedRoute';

// Where the magic-link redirects land. Supabase processes the URL fragment
// via detectSessionInUrl=true in the createClient call; we just wait for the
// authStore to see the new session, then bounce to the right portal.
export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { session, profile, loading } = useAuthStore();

  useEffect(() => {
    if (loading) return;

    const next = params.get('next');

    if (!session) {
      // Link was bad / expired — send them back to login with a hint.
      navigate('/login?error=invalid_link', { replace: true });
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
    <main style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--color-muted)' }}>
      Signing you in…
    </main>
  );
}
