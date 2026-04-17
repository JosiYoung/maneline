import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '../lib/authStore';
import type { UserRole } from '../lib/types';

interface PortalHeaderProps {
  portal: 'owner' | 'trainer' | 'admin';
}

const PORTAL_LABELS: Record<PortalHeaderProps['portal'], string> = {
  owner: 'Mane Line',
  trainer: 'Mane Line · Trainer',
  admin: 'Mane Line · Admin',
};

export function PortalHeader({ portal }: PortalHeaderProps) {
  const navigate = useNavigate();
  const { session, profile, signOut } = useAuthStore();

  async function handleSignOut() {
    await signOut();
    navigate('/', { replace: true });
  }

  const email = session?.user.email ?? '';
  const role: UserRole | '(unknown)' = profile?.role ?? '(unknown)';

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 24px',
        borderBottom: '1px solid var(--color-line)',
        background: 'var(--color-surface)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--color-primary)' }}>
          {PORTAL_LABELS[portal]}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
          Logged in as <strong style={{ color: 'var(--color-ink)' }}>{email || 'unknown'}</strong>{' '}
          <span style={{ padding: '2px 8px', marginLeft: 6, borderRadius: 999, background: 'var(--color-bg)', border: '1px solid var(--color-line)' }}>
            role: {role}
          </span>
        </span>
      </div>
      <button
        type="button"
        onClick={handleSignOut}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 14px',
          border: '1px solid var(--color-line)',
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
          borderRadius: 8,
          cursor: 'pointer',
          fontSize: 14,
        }}
      >
        <LogOut size={16} />
        Sign out
      </button>
    </header>
  );
}
