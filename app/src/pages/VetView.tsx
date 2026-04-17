import { useParams } from 'react-router-dom';

/**
 * Scoped magic-link Vet View.
 *
 * Phase 0 status: the `vet_tokens` table, the validation RPC, and the
 * 30-day record-bundle query do NOT exist yet. This page is a deliberately
 * inert placeholder — it does not hit the database, does not render the
 * raw token string (shoulder-surf / screenshot leak), and does not surface
 * any user data. Phase 3 replaces the body with the real vet UI.
 *
 * The route must still resolve cleanly so QA can test /vet/<token> URLs
 * without a white screen.
 */
export default function VetView() {
  const { token } = useParams<{ token: string }>();
  const hasToken = typeof token === 'string' && token.length > 0;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '48px 24px' }}>
      <header style={{ marginBottom: 24, paddingBottom: 16, borderBottom: '1px solid var(--color-line)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--color-primary)' }}>
          Mane Line · Vet View
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginTop: 2 }}>
          Shared record (read-only)
        </div>
      </header>

      <div style={{
        padding: 20,
        border: '1px solid var(--color-line)',
        borderRadius: 12,
        background: 'var(--color-surface)',
      }}>
        <strong style={{ display: 'block', marginBottom: 6 }}>Not available yet</strong>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
          {hasToken
            ? "The shared record for this link isn't live yet. Vet-share bundles ship in a later phase; please check back with the horse owner for another way to receive the record."
            : "This link is missing its access code. Ask the horse owner to re-share the record."}
        </p>
      </div>
    </main>
  );
}
