import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { UserRole } from '../lib/types';

type StoredRole = UserRole | null;

interface RoleCopy {
  headline: string;
  body: string;
  aside: string;
}

// Keep the copy close to the spec. Owner = immediate access; Trainer = 48h
// review; Silver Lining = admin access once the link is clicked.
function copyForRole(role: StoredRole, email: string): RoleCopy {
  const e = email || 'your email';
  if (role === 'trainer') {
    return {
      headline: 'Application received',
      body:
        `We sent a sign-in link to ${e}. After you click it, the Silver Lining ` +
        `team will review your application. You'll hear back within 48 hours.`,
      aside:
        'Until you\'re approved, the trainer portal will show a holding page — no client data is visible yet.',
    };
  }
  if (role === 'silver_lining') {
    return {
      headline: 'Check your Silver Lining inbox',
      body:
        `We sent a sign-in link to ${e}. You'll have admin access the moment you click it.`,
      aside:
        'The admin portal is read-only until the audit-log wiring lands in Phase 5 — see OAG_DECISION_LAWS Decision 8.',
    };
  }
  // default: owner
  return {
    headline: "You're in",
    body:
      `We sent a one-tap sign-in link to ${e}. Your dashboard will be ready when you click the link.`,
    aside:
      'Open it on any device — your barn, profile, and any animal you added during signup will be waiting.',
  };
}

export default function CheckEmail() {
  const [email, setEmail] = useState<string>('your email');
  const [role, setRole] = useState<StoredRole>(null);

  useEffect(() => {
    const storedEmail = sessionStorage.getItem('ml_pending_email');
    if (storedEmail) setEmail(storedEmail);

    const storedRole = sessionStorage.getItem('ml_signup_role');
    if (storedRole === 'owner' || storedRole === 'trainer' || storedRole === 'silver_lining') {
      setRole(storedRole);
    }
  }, []);

  const c = copyForRole(role, email);

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 36, marginBottom: 16 }}>{c.headline}</h1>
      <p style={{ fontSize: 16, color: 'var(--color-ink)', marginBottom: 12, lineHeight: 1.5 }}>
        {c.body}
      </p>
      {c.aside ? (
        <p style={{ fontSize: 13.5, color: 'var(--text-muted)', marginBottom: 28, lineHeight: 1.5 }}>
          {c.aside}
        </p>
      ) : null}

      <div style={{
        textAlign: 'left',
        padding: 20,
        border: '1px solid var(--color-line)',
        borderRadius: 12,
        background: 'var(--color-surface)',
        fontSize: 14,
        color: 'var(--color-ink)',
      }}>
        <strong style={{ display: 'block', marginBottom: 8 }}>Not seeing it?</strong>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
          <li>Check your spam / promotions folder</li>
          <li>Links expire after 1 hour — just request a new one</li>
          <li>Typo in the email? <Link to="/signup">Start over</Link></li>
        </ul>
      </div>

      <p style={{ marginTop: 28 }}>
        <Link to="/" style={{ fontSize: 14, color: 'var(--text-muted)' }}>&larr; Back to home</Link>
      </p>
    </main>
  );
}
