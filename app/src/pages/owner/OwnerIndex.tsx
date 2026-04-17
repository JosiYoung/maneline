import { PortalHeader } from '../../components/PortalHeader';
import { PinSettings } from '../../components/PinSettings';

export default function OwnerIndex() {
  return (
    <>
      <PortalHeader portal="owner" />
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 30, marginBottom: 8 }}>My Barn</h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: 24 }}>
          This is where the Today view, animals list, and protocols will live.
        </p>

        <div style={{
          padding: 24,
          border: '1px solid var(--color-line)',
          borderRadius: 12,
          background: 'var(--color-surface)',
        }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>Phase 0 placeholder</strong>
          <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: 0 }}>
            The owner portal is wired up at <code>/app</code>. Future routes
            (<code>/app/animals</code>, <code>/app/protocols</code>, <code>/app/records</code>,
            <code>/app/trainers</code>) will hang off this index.
          </p>
        </div>
        <PinSettings />
      </main>
    </>
  );
}
