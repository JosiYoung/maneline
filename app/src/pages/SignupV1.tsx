import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { mapSupabaseError } from '../lib/errors';

/**
 * Legacy single-step signup — the v1 waitlist flow, preserved in the SPA
 * for when `feature:signup_v2` is disabled. Functionally equivalent to the
 * old worker.js /join page (same fields, same metadata shape), but rendered
 * in React and using Mane Line chrome only.
 *
 * Owner-only. Trainers + Silver Lining staff pick their role in v2; v1
 * predates that concept and always creates owner accounts (role='owner'
 * is the default in handle_new_user()).
 */
export default function SignupV1() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus('sending');
    setErrorMessage(null);

    const fd = new FormData(e.currentTarget);
    const email = (fd.get('email') || '').toString().trim().toLowerCase();
    const full_name = (fd.get('full_name') || '').toString().trim();

    if (!email || !full_name) {
      setStatus('error');
      setErrorMessage('Name and email are both required.');
      return;
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent('/app')}`,
        data: {
          role: 'owner',
          full_name,
          display_name: full_name,
          phone: (fd.get('phone') || '').toString().trim(),
          location: (fd.get('location') || '').toString().trim(),
          owner_discipline: (fd.get('owner_discipline') || '').toString().trim(),
          marketing_opt_in: fd.get('opt_in') === 'on',
          first_horse: {
            barn_name: (fd.get('barn_name') || '').toString().trim(),
            breed: (fd.get('breed') || '').toString().trim(),
            sex: (fd.get('sex') || '').toString().trim(),
            year_born: (fd.get('year_born') || '').toString().trim(),
            discipline: (fd.get('horse_discipline') || '').toString().trim(),
          },
        },
      },
    });

    if (error) {
      setStatus('error');
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    sessionStorage.setItem('ml_pending_email', email);
    sessionStorage.setItem('ml_signup_role', 'owner');
    navigate('/check-email');
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px 80px' }}>
      <Link to="/" style={{ fontSize: 13, color: 'var(--text-muted)' }}>&larr; Back</Link>
      <div style={eyebrow}>Join the Waitlist</div>
      <h1 style={{ fontSize: 'clamp(32px, 4.4vw, 46px)', margin: '8px 0 16px' }}>Ride in the first wave.</h1>
      <p style={{ fontSize: 17, color: '#2a3130', maxWidth: '56ch', marginBottom: 28 }}>
        Sign up with you and your horse. Required fields are marked with <strong>*</strong>.
      </p>

      <form onSubmit={onSubmit} style={card}>
        {errorMessage ? <div style={errBox}>{errorMessage}</div> : null}

        <h2 style={h2Style}>About you</h2>
        <div style={grid2}>
          <Field label="Your name *"><input name="full_name" type="text" required autoComplete="name" style={inputStyle} placeholder="Sherry Cervi" /></Field>
          <Field label="Email *"><input name="email" type="email" required autoComplete="email" style={inputStyle} placeholder="you@yourranch.com" /></Field>
          <Field label="Phone (optional)"><input name="phone" type="tel" autoComplete="tel" style={inputStyle} /></Field>
          <Field label="State / Region *"><input name="location" type="text" required style={inputStyle} placeholder="Texas, Wyoming, Alberta..." /></Field>
        </div>
        <Field label="What do you do with horses? (optional)">
          <select name="owner_discipline" style={inputStyle} defaultValue="">
            <option value="">Choose one</option>
            <option>Barrel racing</option><option>Roping / team roping</option>
            <option>Ranch work</option><option>Cutting / reining</option>
            <option>Trail / pleasure</option><option>Breeding / foaling</option>
            <option>Show / hunter-jumper</option><option>Dressage / eventing</option>
            <option>Endurance</option><option>Other</option>
          </select>
        </Field>

        <hr style={hr} />

        <h2 style={h2Style}>Your first horse</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 13.5, marginBottom: 14 }}>
          You can add more once you're in.
        </p>
        <div style={grid2}>
          <Field label="Barn name *"><input name="barn_name" type="text" required style={inputStyle} placeholder="Stingray" /></Field>
          <Field label="Breed *">
            <select name="breed" required style={inputStyle} defaultValue="">
              <option value="">Choose breed</option>
              <option>Quarter Horse</option><option>Paint</option><option>Appaloosa</option>
              <option>Thoroughbred</option><option>Arabian</option><option>Warmblood</option>
              <option>Morgan</option><option>Tennessee Walker</option><option>Mustang</option>
              <option>Draft</option><option>Pony</option><option>Mixed / unknown</option><option>Other</option>
            </select>
          </Field>
        </div>
        <Field label="Sex *">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <RadioOption name="sex" value="mare" label="Mare" />
            <RadioOption name="sex" value="gelding" label="Gelding" />
            <RadioOption name="sex" value="stallion" label="Stallion" />
          </div>
        </Field>
        <div style={grid2}>
          <Field label="Year born *"><input name="year_born" type="number" min={1990} max={2026} required style={inputStyle} placeholder="2018" /></Field>
          <Field label="Primary discipline *">
            <select name="horse_discipline" required style={inputStyle} defaultValue="">
              <option value="">Choose one</option>
              <option>Barrel racing</option><option>Roping</option><option>Ranch work</option>
              <option>Cutting / reining</option><option>Trail / pleasure</option><option>Breeding</option>
              <option>Show</option><option>Dressage / eventing</option><option>Endurance</option>
              <option>Retired / companion</option><option>Other</option>
            </select>
          </Field>
        </div>

        <hr style={hr} />
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500 }}>
          <input type="checkbox" name="opt_in" defaultChecked style={{ width: 'auto', marginTop: 3 }} />
          <span style={{ fontSize: 13.5, color: '#2a3130' }}>
            Send me product updates from Mane Line. Unsubscribe anytime.
          </span>
        </label>

        <button type="submit" disabled={status === 'sending'} style={{ ...primaryBtn, marginTop: 20, width: '100%' }}>
          {status === 'sending' ? 'Sending…' : 'Send Me the Magic Link'}
        </button>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
          We'll email a one-tap sign-in link. No passwords.
        </p>
      </form>
    </main>
  );
}

/* --------------------------- shared UI bits --------------------------- */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function RadioOption({ name, value, label }: { name: string; value: string; label: string }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
      background: 'var(--color-bg)', border: '1.5px solid var(--color-line)', borderRadius: 10,
      cursor: 'pointer', fontWeight: 500, color: 'var(--color-ink)',
    }}>
      <input type="radio" name={name} value={value} required style={{ width: 'auto', margin: 0 }} />
      {label}
    </label>
  );
}

const eyebrow: React.CSSProperties = {
  display: 'inline-block', fontSize: 12, letterSpacing: '.2em', textTransform: 'uppercase',
  color: 'var(--color-accent)', fontWeight: 700, marginTop: 16,
};
const card: React.CSSProperties = {
  background: 'var(--color-surface)', borderRadius: 16, padding: 28,
  border: '1px solid var(--color-line)', boxShadow: '0 10px 30px -18px rgba(30,58,95,.35)',
};
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };
const h2Style: React.CSSProperties = { fontSize: 20, marginBottom: 14 };
const hr: React.CSSProperties = { margin: '24px 0', border: 0, borderTop: '1px solid var(--color-line)' };
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 10,
  border: '1.5px solid var(--color-line)', background: 'var(--color-bg)', color: 'var(--color-ink)',
  outline: 'none', fontFamily: 'inherit',
};
const primaryBtn: React.CSSProperties = {
  padding: '13px 22px', fontSize: 15, fontWeight: 600, background: 'var(--color-primary)',
  color: '#fff', border: 0, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
};
const errBox: React.CSSProperties = {
  padding: '12px 14px', borderRadius: 10, fontSize: 14, marginBottom: 14,
  background: '#fbe9e6', color: '#7a1d10', border: '1px solid #e9bdb5',
};
