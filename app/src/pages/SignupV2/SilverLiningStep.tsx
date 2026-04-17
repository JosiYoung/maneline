import { SLH_DOMAIN } from './shared';

export function SilverLiningStep({ email }: { email: string }) {
  const ok = email.trim().toLowerCase().endsWith(`@${SLH_DOMAIN}`);
  return (
    <div style={{
      padding: 20,
      background: ok ? 'var(--color-bg)' : '#fbe9e6',
      border: '1px solid var(--color-line)',
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6 }}>
        {ok ? 'Looks good.' : 'Email domain mismatch'}
      </div>
      <div style={{ fontSize: 14, color: ok ? 'var(--color-ink)' : '#7a1d10' }}>
        {ok ? (
          <>
            We'll email a magic link to <strong>{email}</strong>. After you click it,
            your account will have Silver Lining admin access.
          </>
        ) : (
          <>
            Silver Lining staff accounts must use an <strong>@{SLH_DOMAIN}</strong> email.
            Go back and either change your email or pick a different role.
          </>
        )}
      </div>
    </div>
  );
}
