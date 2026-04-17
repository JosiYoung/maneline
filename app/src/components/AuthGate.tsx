import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';

interface AuthGateProps {
  children: ReactNode;
}

/**
 * AuthGate is the top-level routing hinge.
 *
 * Responsibilities:
 *   1. Kick off the auth store init on first mount.
 *   2. While the session + profile are loading, render a neutral splash so
 *      child routes don't flash unauthenticated content.
 *   3. For paths that require no session (/, /login, /signup, /vet/:token,
 *      /auth/callback), pass the children through untouched.
 *   4. For any other path, if we have a session but no user_profiles row,
 *      redirect to /signup/complete-profile.
 *   5. If the session's role doesn't match the portal prefix, redirect
 *      to the role's home. Role-level authorization is re-checked in
 *      ProtectedRoute.
 *
 * This component does NOT enforce the trainer pending-review gate — that
 * lives in ProtectedRoute so it can bypass for /trainer/pending-review.
 */
export function AuthGate({ children }: AuthGateProps) {
  const location = useLocation();
  const { session, profile, loading, init } = useAuthStore();

  useEffect(() => {
    void init();
  }, [init]);

  const pathname = location.pathname;
  const isPublic =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname === '/check-email' ||
    pathname === '/auth/callback' ||
    pathname.startsWith('/vet/');

  if (loading) {
    return (
      <div style={{ padding: '80px 24px', textAlign: 'center', color: 'var(--color-muted)' }}>
        Loading…
      </div>
    );
  }

  if (isPublic) {
    return <>{children}</>;
  }

  // From here down, the route is "app-scoped" and requires a session.
  if (!session) {
    const target = encodeURIComponent(pathname + location.search);
    return <Navigate to={`/login?next=${target}`} replace />;
  }

  // Signed in but no user_profiles row — hand off to complete-profile.
  // Pre-Phase-0 users will land here.
  const isCompleteProfile = pathname === '/signup/complete-profile';
  if (!profile && !isCompleteProfile) {
    return <Navigate to="/signup/complete-profile" replace />;
  }

  return <>{children}</>;
}
