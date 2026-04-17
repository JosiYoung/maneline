import { Link } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';

/**
 * Pre-migration catch-all.
 *
 * Since Phase 0 hardening, `handle_new_user()` creates a user_profiles row
 * on magic-link redemption for every new signup, so normal users never see
 * this page. It exists for accounts that signed up before the trigger
 * existed (or that failed the trigger for any reason) and have an auth.users
 * row but no matching user_profiles row — ProtectedRoute routes them here.
 *
 * Phase 1 will replace this with a real completion form. For Phase 0 we
 * display a clear recovery message so these users don't hit a white screen.
 */
export default function SignupCompleteProfile() {
  const session = useAuthStore((s) => s.session);

  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 30, marginBottom: 12 }}>One more step</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 20 }}>
        Your account exists, but we couldn't find a Mane Line profile for it.
        This usually means you signed up before profiles were part of the
        onboarding flow. Please reach out to support and we'll finish setting
        up your portal.
      </p>

      <div style={{
        padding: 20,
        border: '1px solid var(--color-line)',
        background: 'var(--color-surface)',
        borderRadius: 12,
        color: 'var(--text-muted)',
        fontSize: 14,
      }}>
        <strong style={{ color: 'var(--color-ink)', display: 'block', marginBottom: 6 }}>
          Signed in as
        </strong>
        <code>{session?.user.email ?? 'none'}</code>
      </div>

      <p style={{ marginTop: 24, fontSize: 14 }}>
        <Link to="/">&larr; Back to home</Link>
      </p>
    </main>
  );
}
