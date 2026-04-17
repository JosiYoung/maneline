import { PortalHeader } from '../../components/PortalHeader';

// Holding page for trainers whose application hasn't been reviewed yet.
// ProtectedRoute forces all /trainer/* traffic here while status='pending_review'.
export default function TrainerPendingReview() {
  return (
    <>
      <PortalHeader portal="trainer" />
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>
        <h1 style={{ fontSize: 32, marginBottom: 12 }}>Application under review</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          Thanks for applying to join Mane Line as a trainer. Our vetting team
          is reviewing your details — we'll email you the moment you're approved.
        </p>

        <div style={{
          padding: 20,
          border: '1px solid var(--color-line)',
          borderRadius: 12,
          background: 'var(--color-surface)',
          fontSize: 14,
          color: 'var(--text-muted)',
        }}>
          <strong style={{ color: 'var(--color-ink)', display: 'block', marginBottom: 6 }}>
            What happens next
          </strong>
          Reviews typically take 1–3 business days. Once approved, this page will unlock
          and your trainer dashboard will appear here.
        </div>
      </main>
    </>
  );
}
