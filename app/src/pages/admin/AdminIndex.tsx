import { Link, Navigate, Route, Routes } from 'react-router-dom';

import { PortalHeader } from '../../components/PortalHeader';
import { PinSettings } from '../../components/PinSettings';
import PlatformFeesIndex from './PlatformFeesIndex';

// AdminIndex — /admin/*
//
// Phase 2 Prompt 2.6 gives the admin surface its first real tab
// (/admin/settings/fees). Earlier surfaces — trainer applications,
// users, health — remain stubs and will land as subsequent admins-only
// features come online.

export default function AdminIndex() {
  return (
    <>
      <PortalHeader portal="admin" />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 24px' }}>
        <Routes>
          <Route index element={<AdminLanding />} />
          <Route path="settings/fees" element={<PlatformFeesIndex />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </main>
    </>
  );
}

function AdminLanding() {
  return (
    <div>
      <h1 style={{ fontSize: 30, marginBottom: 8 }}>Admin</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        Internal control panel — trainer vetting, system health, user overview.
      </p>

      <div
        style={{
          padding: 24,
          border: '1px solid var(--color-line)',
          borderRadius: 12,
          background: 'var(--color-surface)',
          marginBottom: 24,
        }}
      >
        <strong style={{ display: 'block', marginBottom: 6 }}>Live routes</strong>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>
          <li>
            <Link to="/admin/settings/fees">/admin/settings/fees</Link> — platform fee + trainer overrides
          </li>
        </ul>
      </div>

      <div
        style={{
          padding: 24,
          border: '1px solid var(--color-line)',
          borderRadius: 12,
          background: 'var(--color-surface)',
        }}
      >
        <strong style={{ display: 'block', marginBottom: 6 }}>Coming soon</strong>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: 0 }}>
          Routes like <code>/admin/trainer-applications</code>, <code>/admin/users</code>, and{' '}
          <code>/admin/health</code> will hang off this index as their features land.
        </p>
      </div>
      <PinSettings />
    </div>
  );
}
