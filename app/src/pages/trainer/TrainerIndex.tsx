import { PortalHeader } from '../../components/PortalHeader';
import { PinSettings } from '../../components/PinSettings';

export default function TrainerIndex() {
  return (
    <>
      <PortalHeader portal="trainer" />
      <main style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 30, marginBottom: 8 }}>Trainer portal</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
          Clients who've granted you access will show up here.
        </p>

        <div style={{
          padding: 24,
          border: '1px solid var(--color-line)',
          borderRadius: 12,
          background: 'var(--color-surface)',
        }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>Phase 0 placeholder</strong>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
            Routes like <code>/trainer/clients</code> and <code>/trainer/animals/:id</code>{' '}
            will hang off this index. Access is governed by
            <code>animal_access_grants</code> rows in the database.
          </p>
        </div>
        <PinSettings />
      </main>
    </>
  );
}
