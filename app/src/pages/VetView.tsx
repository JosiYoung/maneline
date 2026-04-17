import { useParams } from 'react-router-dom';

// Scoped magic-link Vet View. Token is validated server-side in a later
// phase; for Phase 0 this is a placeholder that just proves the route
// resolves and the token parameter is wired through.
export default function VetView() {
  const { token } = useParams<{ token: string }>();

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <header style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--color-line)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--color-primary)' }}>
          Mane Line · Vet View
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2 }}>
          Shared record (read-only)
        </div>
      </header>

      <div style={{
        padding: 20,
        border: '1px solid var(--color-line)',
        borderRadius: 12,
        background: 'var(--color-surface)',
      }}>
        <strong style={{ display: 'block', marginBottom: 6 }}>Phase 0 placeholder</strong>
        <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: 0 }}>
          This is where a vet will see the 30-day record bundle an owner shared with them.
          Token: <code>{token ?? '(none)'}</code>
        </p>
      </div>
    </main>
  );
}
