import { Link } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { homeForRole } from '../components/ProtectedRoute';

// Public marketing landing. Mane Line chrome only — no Silver Lining co-brand
// (per post-2026-04-15 call).
export default function Home() {
  const { profile } = useAuthStore();

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px' }}>
      <header style={{ marginBottom: 40 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 700, color: 'var(--color-primary)' }}>
          Mane Line
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase' }}>
          The Horse OS
        </div>
      </header>

      <h1 style={{ fontSize: 'clamp(36px, 5vw, 56px)', lineHeight: 1.05, marginBottom: 20 }}>
        Everything your horse needs, <em style={{ color: 'var(--color-accent)', fontStyle: 'italic' }}>in the palm of your hand.</em>
      </h1>

      <p style={{ fontSize: 18, color: 'var(--color-ink)', maxWidth: '56ch', marginBottom: 32 }}>
        The daily companion for owners, trainers, and vets. Animals at the center — feed, supplements,
        records, training, and schedule, all in one place.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {profile ? (
          <Link
            to={homeForRole(profile.role)}
            style={{
              padding: '12px 22px',
              background: 'var(--color-primary)',
              color: 'white',
              borderRadius: 10,
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            Go to my portal
          </Link>
        ) : (
          <>
            <Link
              to="/signup"
              style={{
                padding: '12px 22px',
                background: 'var(--color-primary)',
                color: 'white',
                borderRadius: 10,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Create an account
            </Link>
            <Link
              to="/login"
              style={{
                padding: '12px 22px',
                background: 'transparent',
                color: 'var(--color-primary)',
                border: '1px solid var(--color-line)',
                borderRadius: 10,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Sign in
            </Link>
          </>
        )}
      </div>

      <footer style={{ marginTop: 80, fontSize: 12, color: 'var(--text-muted)' }}>
        Mane Line &middot; Phase 0 preview &middot; not for public distribution
      </footer>
    </main>
  );
}
