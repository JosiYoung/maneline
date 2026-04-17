import { Link } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';

// Placeholder — the real "complete your profile" flow (display name, first
// animal for owners, trainer application details, etc.) is deferred. For
// Phase 0, `handle_new_user()` creates the user_profiles row on magic-link
// redemption, so most users will pass through AuthGate and never see this
// page. Pre-migration users who still lack a profiles row will land here.
export default function SignupCompleteProfile() {
  const { session } = useAuthStore();

  return (
    <main style={{ maxWidth: 520, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 30, marginBottom: 12 }}>One more step</h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: 20 }}>
        We need a few details before we can set up your Mane Line portal.
      </p>

      <div style={{
        padding: 20,
        border: '1px solid var(--color-line)',
        background: 'var(--color-surface)',
        borderRadius: 12,
        color: 'var(--color-muted)',
        fontSize: 14,
      }}>
        <strong style={{ color: 'var(--color-ink)', display: 'block', marginBottom: 6 }}>
          Phase 0 placeholder
        </strong>
        This form will collect display name, role, and (for trainers) application details.
        Signed-in user: <code>{session?.user.email ?? 'none'}</code>
      </div>

      <p style={{ marginTop: 24, fontSize: 14 }}>
        <Link to="/">&larr; Back to home</Link>
      </p>
    </main>
  );
}
