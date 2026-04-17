import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { mapSupabaseError } from '../../lib/errors';
import {
  Field, RoleCard, StepIndicator,
  emailIsSlh, nextForRole, stepTwoSubtitleForRole, titleForRole,
  SLH_DOMAIN,
  type Step1Data,
} from './shared';
import {
  card, errBox, eyebrow, ghostBtn, grid2, inputStyle, primaryBtn,
} from './styles';
import { OwnerStep, emptyOwnerStep2 } from './OwnerStep';
import { TrainerStep, emptyTrainerStep2 } from './TrainerStep';
import { SilverLiningStep } from './SilverLiningStep';
import { buildMetadata } from './metadata';

/**
 * Two-step role-aware signup.
 *
 * Step 1 (always) — email, full name, phone, role intent.
 * Step 2 (role-conditional) —
 *   owner         → location + discipline + optional first-horse
 *   trainer       → business details + certifications + references + vetting consent
 *   silver_lining → confirm @silverliningherbs.com email (nothing else to collect)
 *
 * On submit, we pack metadata for handle_new_user() using the canonical keys
 * the trigger reads (`owner_discipline`, `first_horse`). The old alias dance
 * (`discipline`, `first_animal`) was removed in the Phase 0 hardening
 * migration — see SignupV2/metadata.ts for the contract.
 */
export default function SignupV2() {
  const navigate = useNavigate();
  const [step, setStep] = useState<1 | 2>(1);

  const [s1, setS1] = useState<Step1Data>({
    email: '',
    full_name: '',
    phone: '',
    role: 'owner',
  });

  const [owner, setOwner] = useState(emptyOwnerStep2);
  const [trainer, setTrainer] = useState(emptyTrainerStep2);

  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function goToStep2(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    const email = s1.email.trim().toLowerCase();
    if (!email) return setErrorMessage('Email is required.');
    if (!s1.full_name.trim()) return setErrorMessage('Your name is required.');

    // Silver Lining staff: block at step 1 → step 2 if the email domain is wrong.
    if (s1.role === 'silver_lining' && !emailIsSlh(email)) {
      return setErrorMessage(
        `Silver Lining staff accounts require an @${SLH_DOMAIN} email. ` +
          `If you're a horse owner or trainer, pick that role instead.`
      );
    }

    setStep(2);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    const email = s1.email.trim().toLowerCase();
    if (s1.role === 'silver_lining' && !emailIsSlh(email)) {
      return setErrorMessage(
        `Silver Lining staff accounts require an @${SLH_DOMAIN} email.`
      );
    }

    if (s1.role === 'trainer' && !trainer.consent_vetting) {
      return setErrorMessage('Please agree to the vetting review to continue.');
    }

    setStatus('sending');

    const metadata = buildMetadata(s1, owner, trainer);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          nextForRole(s1.role)
        )}`,
        data: metadata,
      },
    });

    if (error) {
      setStatus('idle');
      setErrorMessage(mapSupabaseError(error));
      return;
    }

    sessionStorage.setItem('ml_pending_email', email);
    sessionStorage.setItem('ml_signup_role', s1.role);
    navigate('/check-email');
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px 80px' }}>
      <Link to="/" style={{ fontSize: 13, color: 'var(--text-muted)' }}>&larr; Back</Link>
      <div style={eyebrow}>Create your account</div>
      <h1 style={{ fontSize: 'clamp(30px, 4vw, 42px)', margin: '8px 0 10px' }}>
        {step === 1 ? 'Who are you signing up as?' : titleForRole(s1.role)}
      </h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        {step === 1
          ? "We'll tailor the next step to your role."
          : stepTwoSubtitleForRole(s1.role)}
      </p>

      <StepIndicator current={step} />

      {errorMessage ? <div style={errBox}>{errorMessage}</div> : null}

      {step === 1 ? (
        <form onSubmit={goToStep2} style={card}>
          <div style={grid2}>
            <Field label="Your name *">
              <input
                type="text"
                required
                autoComplete="name"
                value={s1.full_name}
                onChange={(e) => setS1({ ...s1, full_name: e.target.value })}
                style={inputStyle}
                placeholder="Jane Rider"
              />
            </Field>
            <Field label="Email *">
              <input
                type="email"
                required
                autoComplete="email"
                value={s1.email}
                onChange={(e) => setS1({ ...s1, email: e.target.value })}
                style={inputStyle}
                placeholder="you@yourranch.com"
              />
            </Field>
            <Field label="Phone (optional)">
              <input
                type="tel"
                autoComplete="tel"
                value={s1.phone}
                onChange={(e) => setS1({ ...s1, phone: e.target.value })}
                style={inputStyle}
              />
            </Field>
          </div>

          <div style={{ marginTop: 8, marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 10 }}>
              What brings you to Mane Line? *
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <RoleCard
                value="owner" label="Horse Owner"
                description="I own one or more horses and want to manage their care."
                current={s1.role} onPick={(r) => setS1({ ...s1, role: r })}
              />
              <RoleCard
                value="owner" label="Dog Owner"
                description="I own one or more dogs. (Same foundation, horse-first UX for Phase 0.)"
                current={s1.role} onPick={(r) => setS1({ ...s1, role: r })}
                note="Picks the Owner role — dog support ships with Phase 2."
              />
              <RoleCard
                value="trainer" label="Professional Trainer"
                description="I work with clients' animals. Requires a short vetting review before access."
                current={s1.role} onPick={(r) => setS1({ ...s1, role: r })}
              />
              <RoleCard
                value="silver_lining" label="Silver Lining staff"
                description="Internal admin — requires a Silver Lining Herbs email."
                current={s1.role} onPick={(r) => setS1({ ...s1, role: r })}
              />
            </div>
          </div>

          <button type="submit" style={{ ...primaryBtn, width: '100%' }}>
            Continue
          </button>
        </form>
      ) : (
        <form onSubmit={onSubmit} style={card}>
          {s1.role === 'owner' && (
            <OwnerStep data={owner} setData={setOwner} />
          )}
          {s1.role === 'trainer' && (
            <TrainerStep data={trainer} setData={setTrainer} />
          )}
          {s1.role === 'silver_lining' && (
            <SilverLiningStep email={s1.email} />
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 24, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => { setStep(1); setErrorMessage(null); }}
              style={ghostBtn}
            >
              &larr; Back
            </button>
            <button
              type="submit"
              disabled={status === 'sending'}
              style={{ ...primaryBtn, flex: 1, minWidth: 180 }}
            >
              {status === 'sending' ? 'Sending…' : 'Send Me the Magic Link'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10, textAlign: 'center' }}>
            We'll email a one-tap sign-in link. No passwords.
          </p>
        </form>
      )}

      <p style={{ marginTop: 24, fontSize: 14, color: 'var(--text-muted)', textAlign: 'center' }}>
        Already have an account? <Link to="/login" style={{ fontWeight: 600 }}>Sign in</Link>
      </p>
    </main>
  );
}
