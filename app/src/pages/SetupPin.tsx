import { useState, useRef, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../lib/authStore';
import { mapSupabaseError } from '../lib/errors';
import { homeForRole } from '../components/ProtectedRoute';

// One-time post-login step. AuthGate routes any signed-in user without a
// PIN here so PIN login is offered to *every* new user (owner, trainer,
// silver_lining) on first sign-in. They can skip — the choice is stored
// in localStorage so we don't pester on every navigation.
const SKIP_KEY = 'maneline:pin-setup-skipped';

export function markPinSetupSkipped(userId: string) {
  try { localStorage.setItem(`${SKIP_KEY}:${userId}`, '1'); } catch { /* ignore */ }
}

export function pinSetupWasSkipped(userId: string): boolean {
  try { return localStorage.getItem(`${SKIP_KEY}:${userId}`) === '1'; } catch { return false; }
}

export default function SetupPin() {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const withAuthPause = useAuthStore((s) => s.withAuthPause);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);

  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const saving = useRef(false);

  function done() {
    if (profile) navigate(homeForRole(profile.role), { replace: true });
    else navigate('/', { replace: true });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving.current) return;
    setErrorMessage(null);

    if (newPin.length !== 6) {
      setErrorMessage('PIN must be exactly 6 digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setErrorMessage('PINs do not match.');
      return;
    }

    saving.current = true;
    setStatus('saving');
    try {
      await withAuthPause(async () => {
        const { error: pwError } = await supabase.auth.updateUser({ password: newPin });
        if (pwError) throw pwError;
        const { error: rpcError } = await supabase.rpc('set_pin');
        if (rpcError) throw rpcError;
      });
      await refreshProfile();
      done();
    } catch (err) {
      setStatus('idle');
      setErrorMessage(mapSupabaseError(err as Error));
    } finally {
      saving.current = false;
    }
  }

  function onSkip() {
    if (session?.user.id) markPinSetupSkipped(session.user.id);
    done();
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--color-line)',
    fontSize: 22,
    background: 'var(--color-surface)',
    letterSpacing: '0.3em',
    textAlign: 'center' as const,
    marginBottom: 12,
  };

  return (
    <main style={{ maxWidth: 460, margin: '0 auto', padding: '64px 24px' }}>
      <h1 style={{ fontSize: 30, marginBottom: 8 }}>Set a 6-digit PIN</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        A PIN lets you sign in instantly next time, without waiting on a magic-link email.
      </p>

      <form onSubmit={onSubmit}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          New PIN
        </label>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="------"
          style={inputStyle}
        />
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          Confirm PIN
        </label>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={confirmPin}
          onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="------"
          style={inputStyle}
        />

        <button
          type="submit"
          disabled={status === 'saving' || newPin.length < 6 || confirmPin.length < 6}
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'var(--color-primary)',
            color: 'white',
            border: 0,
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 15,
            cursor: status === 'saving' ? 'wait' : 'pointer',
            opacity: status === 'saving' ? 0.7 : 1,
          }}
        >
          {status === 'saving' ? 'Saving…' : 'Set PIN and continue'}
        </button>

        {errorMessage && (
          <p style={{ color: '#7a1d10', fontSize: 13, marginTop: 12 }}>{errorMessage}</p>
        )}

        <p style={{ marginTop: 18, textAlign: 'center' }}>
          <button
            type="button"
            onClick={onSkip}
            disabled={status === 'saving'}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 600,
              padding: 0,
            }}
          >
            Skip for now — I'll use magic links
          </button>
        </p>
      </form>
    </main>
  );
}
