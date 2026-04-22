import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';

interface AuthGateProps {
  children: ReactNode;
}

/**
 * Routes that do NOT require a session.
 *
 * Exact matches are used for root/single-page paths; prefix matches
 * ("/vet/") catch parametric routes. Keep this list narrow — adding
 * an entry opens a hole in the auth wall.
 */
const PUBLIC_EXACT = new Set<string>([
  '/',
  '/login',
  '/signup',
  '/check-email',
  '/auth/callback',
  '/welcome',
]);
const PUBLIC_PREFIXES = ['/vet/', '/e/'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * AuthGate — top-level routing hinge.
 *
 *   1. Kick off the auth store init on first mount.
 *   2. While the session + profile are loading, render a neutral splash
 *      so child routes don't flash unauthenticated content.
 *   3. For paths in PUBLIC_EXACT / PUBLIC_PREFIXES, pass children through.
 *   4. For any other path, if we have a session but no user_profiles
 *      row, redirect to /signup/complete-profile.
 *
 * Role-level authorization is re-checked in ProtectedRoute.
 */
export function AuthGate({ children }: AuthGateProps) {
  const location = useLocation();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const loading = useAuthStore((s) => s.loading);
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (loading) {
    return (
      <div style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Loading…
      </div>
    );
  }

  if (isPublicPath(location.pathname)) {
    return <>{children}</>;
  }

  if (!session) {
    const target = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${target}`} replace />;
  }

  const isCompleteProfile = location.pathname === '/signup/complete-profile';
  if (!profile && !isCompleteProfile) {
    return <Navigate to="/signup/complete-profile" replace />;
  }

  return <>{children}</>;
}
