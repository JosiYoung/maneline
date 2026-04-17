import { PortalHeader } from '../../components/PortalHeader';
import { PinSettings } from '../../components/PinSettings';

export default function AdminIndex() {
  return (
    <>
      <PortalHeader portal="admin" />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        <h1 style={{ fontSize: 30, marginBottom: 8 }}>Silver Lining admin</h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: 24 }}>
          Internal control panel — trainer vetting, system health, user overview.
        </p>

        <div style={{
          padding: 24,
          border: '1px solid var(--color-line)',
          borderRadius: 12,
          background: 'var(--color-surface)',
        }}>
          <strong style={{ display: 'block', marginBottom: 6 }}>Phase 0 placeholder</strong>
          <p style={{ color: 'var(--color-muted)', fontSize: 14, margin: 0 }}>
            Routes like <code>/admin/trainer-applications</code>, <code>/admin/users</code>, and
            <code>/admin/health</code> will hang off this index.
          </p>
        </div>
        <PinSettings />
      </main>
    </>
  );
}
