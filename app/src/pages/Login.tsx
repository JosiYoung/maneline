import { useState, type FormEvent } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { mapSupabaseError, mapToUserMessage } from '../lib/errors';

type Step = 'email' | 'pin' | 'magic';

export default function Login() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [step, setStep] = useState<Step>('email');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function checkHasPin(emailValue: string): Promise<boolean> {
    // Phase 0 hardening: the check_has_pin RPC is no longer anon-callable.
    // We go through /api/has-pin, which rate-limits per-IP and proxies the
    // call with service_role.
    const res = await fetch('/api/has-pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: emailValue }),
    });
    if (res.status === 429) {
      throw new Error('rate_limited');
    }
    if (!res.ok) {
      // Treat any non-200 as "no PIN" so the user still gets a magic link
      // path. Don't surface "api broken" to the user here.
      return false;
    }
    const data = (await res.json().catch(() => ({}))) as { has_pin?: boolean };
    return data.has_pin === true;
  }

  async function onEmailSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage(null);

    const trimmed = email.trim().toLowerCase();

    try {
      const hasPin = await checkHasPin(trimmed);
      setStatus('idle');
      setStep(hasPin ? 'pin' : 'magic');
      if (!hasPin) {
        await sendMagicLink(trimmed);
      }
    } catch (err) {
      setStatus('error');
      setErrorMessage(mapToUserMessage(err));
    }
  }

  async function sendMagicLink(emailOverride?: string) {
    const trimmed = emailOverride ?? email.trim().toLowerCase();
    setStatus('loading');
    setErrorMessage(null);

    const next = params.get('next') || '/';
    const redirectPath = `/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}${redirectPath}`,
      },
    });

    if (error) {
      setStatus('error');
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    sessionStorage.setItem('ml_pending_email', trimmed);
    setStatus('idle');
    navigate('/check-email');
  }

  async function onPinSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('loading');
    setErrorMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password: pin,
    });

    if (error) {
      setStatus('error');
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    const next = params.get('next') || '/';
    navigate(next, { replace: true });
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--color-line)',
    fontSize: 15,
    marginBottom: 16,
    background: 'var(--color-surface)',
  } as const;

  const buttonStyle = {
    width: '100%',
    padding: '12px 16px',
    background: 'var(--color-primary)',
    color: 'white',
    border: 0,
    borderRadius: 10,
    fontWeight: 600,
    fontSize: 15,
    cursor: status === 'loading' ? 'wait' : 'pointer',
    opacity: status === 'loading' ? 0.7 : 1,
  } as const;

  const linkStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--color-primary)',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    padding: 0,
  } as const;

  return (
    <main style={{ maxWidth: 480, margin: '0 auto', padding: '64px 24px' }}>
      <Link to="/" style={{ fontSize: 13, color: 'var(--text-muted)' }}>&larr; Back</Link>
      <h1 style={{ fontSize: 36, marginTop: 16, marginBottom: 12 }}>Sign in</h1>

      {step === 'email' && (
        <>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            Enter your email to continue.
          </p>
          <form onSubmit={onEmailSubmit}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={inputStyle}
            />
            <button type="submit" disabled={status === 'loading'} style={buttonStyle}>
              {status === 'loading' ? 'Checking…' : 'Continue'}
            </button>
          </form>
        </>
      )}

      {step === 'pin' && (
        <>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            Enter your 6-digit PIN for <strong>{email}</strong>.
          </p>
          <form onSubmit={onPinSubmit}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="current-password"
              required
              value={pin}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setPin(v);
              }}
              placeholder="------"
              style={{ ...inputStyle, letterSpacing: '0.3em', textAlign: 'center', fontSize: 22 }}
            />
            <button type="submit" disabled={status === 'loading' || pin.length < 6} style={buttonStyle}>
              {status === 'loading' ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p style={{ marginTop: 16, textAlign: 'center' }}>
            <button type="button" onClick={() => sendMagicLink()} style={linkStyle}>
              Use magic link instead
            </button>
          </p>
        </>
      )}

      {step === 'magic' && (
        <>
          <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
            Sending a magic link to <strong>{email}</strong>…
          </p>
          {status === 'loading' && (
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Sending…</p>
          )}
        </>
      )}

      {errorMessage && (
        <p style={{ color: '#7a1d10', fontSize: 13, marginTop: 12 }}>{errorMessage}</p>
      )}

      {step !== 'email' && (
        <p style={{ marginTop: 12, textAlign: 'center' }}>
          <button
            type="button"
            onClick={() => { setStep('email'); setPin(''); setErrorMessage(null); }}
            style={linkStyle}
          >
            &larr; Different email
          </button>
        </p>
      )}

      <p style={{ marginTop: 28, fontSize: 14, color: 'var(--text-muted)', textAlign: 'center' }}>
        New here? <Link to="/signup" style={{ fontWeight: 600 }}>Create an account</Link>
      </p>
    </main>
  );
}
