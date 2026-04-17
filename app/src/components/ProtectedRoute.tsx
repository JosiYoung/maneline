import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import type { UserRole } from '../lib/types';

interface ProtectedRouteProps {
  /** Which role(s) may enter this subtree. */
  allow: UserRole | UserRole[];
  children: ReactNode;
}

/**
 * Guards a portal subtree.
 *
 * - If no session or no profile, defer to AuthGate (should have redirected
 *   upstream) and render null.
 * - If the profile's role isn't in `allow`, send the user to their role's
 *   home page. We never render the wrong portal.
 * - Trainer-specific: if role=trainer and status=pending_review, force
 *   them to /trainer/pending-review. They are allowed IN the trainer
 *   subtree, but only on the pending page, until SLH approves them.
 */
export function ProtectedRoute({ allow, children }: ProtectedRouteProps) {
  const location = useLocation();
  const { profile } = useAuthStore();

  if (!profile) return null;

  const allowed = Array.isArray(allow) ? allow : [allow];
  if (!allowed.includes(profile.role)) {
    return <Navigate to={homeForRole(profile.role)} replace />;
  }

  if (profile.role === 'trainer' && profile.status === 'pending_review') {
    if (location.pathname !== '/trainer/pending-review') {
      return <Navigate to="/trainer/pending-review" replace />;
    }
  }

  return <>{children}</>;
}

export function homeForRole(role: UserRole): string {
  switch (role) {
    case 'owner':
      return '/app';
    case 'trainer':
      return '/trainer';
    case 'silver_lining':
      return '/admin';
  }
}
