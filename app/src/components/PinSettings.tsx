import { useState, useRef, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { useAuthStore } from '../lib/authStore';
import { mapSupabaseError } from '../lib/errors';

export function PinSettings() {
  const profile = useAuthStore((s) => s.profile);
  const withAuthPause = useAuthStore((s) => s.withAuthPause);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const hasPin = profile?.has_pin ?? false;

  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guard against concurrent submissions.
  const saving = useRef(false);

  async function onSetPin(e: FormEvent<HTMLFormElement>) {
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

      setNewPin('');
      setConfirmPin('');
      setStatus('success');
      await refreshProfile();
    } catch (err) {
      setStatus('error');
      setErrorMessage(mapSupabaseError(err as Error));
    } finally {
      saving.current = false;
    }
  }

  async function onRemovePin() {
    if (saving.current) return;
    saving.current = true;
    setStatus('saving');
    setErrorMessage(null);

    try {
      const { error } = await supabase.rpc('clear_pin');
      if (error) throw error;
      setStatus('success');
      await refreshProfile();
    } catch (err) {
      setStatus('error');
      setErrorMessage(mapSupabaseError(err as Error));
    } finally {
      saving.current = false;
    }
  }

  const inputStyle = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-line)',
    fontSize: 18,
    background: 'var(--color-surface)',
    letterSpacing: '0.3em',
    textAlign: 'center' as const,
  };

  return (
    <div style={{
      marginTop: 32,
      padding: 24,
      border: '1px solid var(--color-line)',
      borderRadius: 12,
      background: 'var(--color-surface)',
    }}>
      <strong style={{ display: 'block', marginBottom: 6 }}>
        {hasPin ? 'PIN login enabled' : 'Set a 6-digit PIN for faster login'}
      </strong>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, margin: '0 0 16px' }}>
        {hasPin
          ? 'You can sign in with your PIN instead of a magic link.'
          : 'A PIN lets you skip the magic link email and sign in instantly.'}
      </p>

      <form onSubmit={onSetPin}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
          {hasPin ? 'New PIN' : 'PIN'}
        </label>
        <input
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          value={newPin}
          onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="------"
          style={{ ...inputStyle, marginBottom: 10 }}
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
          style={{ ...inputStyle, marginBottom: 14 }}
        />
        <button
          type="submit"
          disabled={status === 'saving' || newPin.length < 6 || confirmPin.length < 6}
          style={{
            padding: '10px 20px',
            background: 'var(--color-primary)',
            color: 'white',
            border: 0,
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: status === 'saving' ? 'wait' : 'pointer',
            opacity: status === 'saving' ? 0.7 : 1,
          }}
        >
          {status === 'saving' ? 'Saving…' : hasPin ? 'Change PIN' : 'Set PIN'}
        </button>

        {hasPin && (
          <button
            type="button"
            onClick={onRemovePin}
            disabled={status === 'saving'}
            style={{
              marginLeft: 12,
              padding: '10px 20px',
              background: 'transparent',
              color: '#7a1d10',
              border: '1px solid #7a1d10',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Remove PIN
          </button>
        )}
      </form>

      {errorMessage && (
        <p style={{ color: '#7a1d10', fontSize: 13, marginTop: 10 }}>{errorMessage}</p>
      )}
      {status === 'success' && !errorMessage && (
        <p style={{ color: '#1a6d3a', fontSize: 13, marginTop: 10 }}>
          {hasPin ? 'PIN updated.' : 'PIN set successfully.'}
        </p>
      )}
    </div>
  );
}
