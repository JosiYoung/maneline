import { useState, type FormEvent, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { UserRole } from '../lib/types';

type SignupIntent = UserRole; // owner | trainer | silver_lining

const SLH_DOMAIN = 'silverliningherbs.com';

interface Step1 {
  email: string;
  full_name: string;
  phone: string;
  role: SignupIntent;
}

interface OwnerStep2 {
  location: string;
  owner_discipline: string;
  include_horse: boolean;
  barn_name: string;
  breed: string;
  sex: string;
  year_born: string;
  horse_discipline: string;
  marketing_opt_in: boolean;
}

interface TrainerRef {
  name: string;
  contact: string;
  relationship: string;
}

interface TrainerStep2 {
  business_name: string;
  years_training: string;
  primary_discipline: string;
  certifications: string; // newline-separated; normalized to string[] at submit
  insurance_carrier: string;
  bio: string;
  reference_1: TrainerRef;
  reference_2: TrainerRef;
  consent_vetting: boolean;
  marketing_opt_in: boolean;
}

const emptyRef = (): TrainerRef => ({ name: '', contact: '', relationship: '' });

/**
 * Two-step role-aware signup.
 *
 * Step 1 (always) — email, full name, phone, role intent.
 * Step 2 (role-conditional) —
 *   owner         → location + discipline + optional first-horse
 *   trainer       → business details + certifications + references + vetting consent
 *   silver_lining → confirm @silverliningherbs.com email (nothing else to collect)
 *
 * On submit, we pack metadata for handle_new_user() using BOTH the
 * trigger-canonical keys (owner_discipline / first_horse) and the
 * forward-looking spec keys (discipline / first_animal). The current
 * trigger reads the canonical ones; a future migration can swap to the
 * spec ones without changing this SPA.
 */
export default function SignupV2() {
  const [step, setStep] = useState<1 | 2>(1);

  const [s1, setS1] = useState<Step1>({
    email: '',
    full_name: '',
    phone: '',
    role: 'owner',
  });

  const [owner, setOwner] = useState<OwnerStep2>({
    location: '',
    owner_discipline: '',
    include_horse: true,
    barn_name: '',
    breed: '',
    sex: '',
    year_born: '',
    horse_discipline: '',
    marketing_opt_in: true,
  });

  const [trainer, setTrainer] = useState<TrainerStep2>({
    business_name: '',
    years_training: '',
    primary_discipline: '',
    certifications: '',
    insurance_carrier: '',
    bio: '',
    reference_1: emptyRef(),
    reference_2: emptyRef(),
    consent_vetting: false,
    marketing_opt_in: true,
  });

  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function emailIsSlh(email: string): boolean {
    return email.trim().toLowerCase().endsWith(`@${SLH_DOMAIN}`);
  }

  function goToStep2(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage(null);

    const email = s1.email.trim().toLowerCase();
    if (!email) return setErrorMessage('Email is required.');
    if (!s1.full_name.trim()) return setErrorMessage('Your name is required.');

    // Silver Lining staff: block at step 1 → step 2 if the email domain is wrong.
    // Polite message, doesn't reveal role-based gating to external users.
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
      setErrorMessage(error.message);
      return;
    }

    sessionStorage.setItem('ml_pending_email', email);
    sessionStorage.setItem('ml_signup_role', s1.role);
    window.location.href = '/check-email';
  }

  return (
    <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 24px 80px' }}>
      <Link to="/" style={{ fontSize: 13, color: 'var(--color-muted)' }}>&larr; Back</Link>
      <div style={eyebrow}>Create your account</div>
      <h1 style={{ fontSize: 'clamp(30px, 4vw, 42px)', margin: '8px 0 10px' }}>
        {step === 1 ? 'Who are you signing up as?' : titleForRole(s1.role)}
      </h1>
      <p style={{ color: 'var(--color-muted)', marginBottom: 24 }}>
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
            <OwnerStep2Form data={owner} setData={setOwner} />
          )}
          {s1.role === 'trainer' && (
            <TrainerStep2Form data={trainer} setData={setTrainer} />
          )}
          {s1.role === 'silver_lining' && (
            <SilverLiningStep2Form email={s1.email} />
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
          <p style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 10, textAlign: 'center' }}>
            We'll email a one-tap sign-in link. No passwords.
          </p>
        </form>
      )}

      <p style={{ marginTop: 24, fontSize: 14, color: 'var(--color-muted)', textAlign: 'center' }}>
        Already have an account? <Link to="/login" style={{ fontWeight: 600 }}>Sign in</Link>
      </p>
    </main>
  );
}

/* =============================================================
   Metadata assembly
   ============================================================= */
function buildMetadata(s1: Step1, owner: OwnerStep2, trainer: TrainerStep2) {
  const base = {
    role: s1.role,
    full_name: s1.full_name.trim(),
    display_name: s1.full_name.trim(),
    phone: s1.phone.trim(),
  };

  if (s1.role === 'owner') {
    const horse = owner.include_horse && owner.barn_name.trim() ? {
      barn_name: owner.barn_name.trim(),
      breed: owner.breed.trim(),
      sex: owner.sex.trim(),
      year_born: owner.year_born.trim(),
      discipline: owner.horse_discipline.trim(),
    } : null;

    return {
      ...base,
      location: owner.location.trim(),
      // Canonical key for the trigger + forward-looking alias for future renames.
      owner_discipline: owner.owner_discipline.trim(),
      discipline: owner.owner_discipline.trim(),
      marketing_opt_in: owner.marketing_opt_in,
      ...(horse
        ? {
            first_horse: horse,   // trigger reads this today
            first_animal: horse,  // spec alias for the eventual rename
          }
        : {}),
    };
  }

  if (s1.role === 'trainer') {
    const certs = trainer.certifications
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const references = [trainer.reference_1, trainer.reference_2]
      .filter((r) => r.name.trim() || r.contact.trim());

    const application = {
      business_name: trainer.business_name.trim(),
      years_training: trainer.years_training.trim(),
      primary_discipline: trainer.primary_discipline.trim(),
      certifications: certs,
      insurance_carrier: trainer.insurance_carrier.trim(),
      references,
      consent_vetting: trainer.consent_vetting,
      consent_vetting_at: new Date().toISOString(),
    };

    return {
      ...base,
      bio: trainer.bio.trim(),
      marketing_opt_in: trainer.marketing_opt_in,
      trainer_application: application,
    };
  }

  // silver_lining
  return base;
}

function nextForRole(role: SignupIntent): string {
  switch (role) {
    case 'owner':          return '/app';
    case 'trainer':        return '/trainer';
    case 'silver_lining':  return '/admin';
  }
}

function titleForRole(role: SignupIntent): string {
  switch (role) {
    case 'owner':          return 'Tell us about your barn';
    case 'trainer':        return 'Trainer application';
    case 'silver_lining':  return 'Confirm your Silver Lining email';
  }
}

function stepTwoSubtitleForRole(role: SignupIntent): string {
  switch (role) {
    case 'owner':
      return 'A couple of details to pre-populate your barn. Your first horse is optional — you can add animals later.';
    case 'trainer':
      return 'The Silver Lining team reviews every trainer before access is granted. Typical turnaround is under 48 hours.';
    case 'silver_lining':
      return 'Admin accounts only — we just need to confirm the domain.';
  }
}

/* =============================================================
   Step indicator
   ============================================================= */
function StepIndicator({ current }: { current: 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, fontSize: 13, color: 'var(--color-muted)' }}>
      <StepDot n={1} active={current === 1} done={current > 1} label="You" />
      <span style={{ flex: '0 0 24px', height: 1, background: 'var(--color-line)' }} />
      <StepDot n={2} active={current === 2} done={false} label="Details" />
    </div>
  );
}

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  const fg = active || done ? 'var(--color-surface)' : 'var(--color-muted)';
  const bg = active || done ? 'var(--color-primary)' : 'var(--color-bg)';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 999, background: bg, color: fg,
        border: '1px solid var(--color-line)', fontWeight: 700, fontSize: 13,
      }}>{n}</span>
      <span style={{ fontWeight: active ? 600 : 500, color: active ? 'var(--color-ink)' : 'var(--color-muted)' }}>
        {label}
      </span>
    </div>
  );
}

/* =============================================================
   Owner step 2
   ============================================================= */
function OwnerStep2Form({
  data, setData,
}: {
  data: OwnerStep2;
  setData: (d: OwnerStep2) => void;
}) {
  return (
    <>
      <div style={grid2}>
        <Field label="State / Region">
          <input
            type="text"
            value={data.location}
            onChange={(e) => setData({ ...data, location: e.target.value })}
            style={inputStyle}
            placeholder="Texas, Wyoming, Alberta..."
          />
        </Field>
        <Field label="What do you do with horses? (optional)">
          <select
            value={data.owner_discipline}
            onChange={(e) => setData({ ...data, owner_discipline: e.target.value })}
            style={inputStyle}
          >
            <option value="">Choose one</option>
            <option>Barrel racing</option><option>Roping / team roping</option>
            <option>Ranch work</option><option>Cutting / reining</option>
            <option>Trail / pleasure</option><option>Breeding / foaling</option>
            <option>Show / hunter-jumper</option><option>Dressage / eventing</option>
            <option>Endurance</option><option>Other</option>
          </select>
        </Field>
      </div>

      <hr style={hr} />

      <label style={{ display: 'flex', gap: 10, alignItems: 'center', fontWeight: 500, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={data.include_horse}
          onChange={(e) => setData({ ...data, include_horse: e.target.checked })}
          style={{ width: 'auto' }}
        />
        <span>Add my first horse now (optional — you can skip and add later)</span>
      </label>

      {data.include_horse && (
        <div style={{ marginTop: 14 }}>
          <div style={grid2}>
            <Field label="Barn name">
              <input type="text" value={data.barn_name}
                onChange={(e) => setData({ ...data, barn_name: e.target.value })}
                style={inputStyle} placeholder="Stingray" />
            </Field>
            <Field label="Breed">
              <select value={data.breed}
                onChange={(e) => setData({ ...data, breed: e.target.value })} style={inputStyle}>
                <option value="">Choose breed</option>
                <option>Quarter Horse</option><option>Paint</option><option>Appaloosa</option>
                <option>Thoroughbred</option><option>Arabian</option><option>Warmblood</option>
                <option>Morgan</option><option>Tennessee Walker</option><option>Mustang</option>
                <option>Draft</option><option>Pony</option><option>Mixed / unknown</option><option>Other</option>
              </select>
            </Field>
          </div>
          <Field label="Sex">
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {['mare', 'gelding', 'stallion'].map((v) => (
                <label key={v} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: 'var(--color-bg)', border: '1.5px solid var(--color-line)', borderRadius: 10,
                  cursor: 'pointer', fontWeight: 500,
                }}>
                  <input
                    type="radio" name="sex" value={v} checked={data.sex === v}
                    onChange={(e) => setData({ ...data, sex: e.target.value })}
                    style={{ width: 'auto', margin: 0 }}
                  />
                  {v[0].toUpperCase() + v.slice(1)}
                </label>
              ))}
            </div>
          </Field>
          <div style={grid2}>
            <Field label="Year born">
              <input type="number" min={1990} max={2026} value={data.year_born}
                onChange={(e) => setData({ ...data, year_born: e.target.value })}
                style={inputStyle} placeholder="2018" />
            </Field>
            <Field label="Primary discipline">
              <select value={data.horse_discipline}
                onChange={(e) => setData({ ...data, horse_discipline: e.target.value })} style={inputStyle}>
                <option value="">Choose one</option>
                <option>Barrel racing</option><option>Roping</option><option>Ranch work</option>
                <option>Cutting / reining</option><option>Trail / pleasure</option><option>Breeding</option>
                <option>Show</option><option>Dressage / eventing</option><option>Endurance</option>
                <option>Retired / companion</option><option>Other</option>
              </select>
            </Field>
          </div>
        </div>
      )}

      <hr style={hr} />
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500 }}>
        <input type="checkbox" checked={data.marketing_opt_in}
          onChange={(e) => setData({ ...data, marketing_opt_in: e.target.checked })}
          style={{ width: 'auto', marginTop: 3 }} />
        <span style={{ fontSize: 13.5, color: '#2a3130' }}>
          Send me product updates from Mane Line. Unsubscribe anytime.
        </span>
      </label>
    </>
  );
}

/* =============================================================
   Trainer step 2
   ============================================================= */
function TrainerStep2Form({
  data, setData,
}: {
  data: TrainerStep2;
  setData: (d: TrainerStep2) => void;
}) {
  return (
    <>
      <div style={grid2}>
        <Field label="Business / barn name *">
          <input
            type="text" required value={data.business_name}
            onChange={(e) => setData({ ...data, business_name: e.target.value })}
            style={inputStyle} placeholder="Cervi Performance Horses"
          />
        </Field>
        <Field label="Years training *">
          <input
            type="number" min={0} max={80} required value={data.years_training}
            onChange={(e) => setData({ ...data, years_training: e.target.value })}
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Primary discipline *">
        <select required value={data.primary_discipline}
          onChange={(e) => setData({ ...data, primary_discipline: e.target.value })}
          style={inputStyle}>
          <option value="">Choose one</option>
          <option>Barrel racing</option><option>Roping / team roping</option>
          <option>Ranch work</option><option>Cutting / reining</option>
          <option>Trail / pleasure</option><option>Breeding / foaling</option>
          <option>Show / hunter-jumper</option><option>Dressage / eventing</option>
          <option>Endurance</option><option>Other</option>
        </select>
      </Field>

      <Field label="Certifications (one per line)">
        <textarea
          value={data.certifications}
          onChange={(e) => setData({ ...data, certifications: e.target.value })}
          rows={4}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder={'AQHA Professional Horseman\nPATH Intl. Registered Instructor'}
        />
      </Field>

      <Field label="Insurance carrier *">
        <input
          type="text" required value={data.insurance_carrier}
          onChange={(e) => setData({ ...data, insurance_carrier: e.target.value })}
          style={inputStyle} placeholder="Markel, Equisure, Hallmark, self-insured..."
        />
      </Field>

      <Field label="Short bio (optional)">
        <textarea
          value={data.bio}
          onChange={(e) => setData({ ...data, bio: e.target.value })}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
          placeholder="Shown to owners when they consider granting you access to their animals."
        />
      </Field>

      <hr style={hr} />
      <h3 style={{ fontSize: 18, marginBottom: 6 }}>Two references *</h3>
      <p style={{ fontSize: 13, color: 'var(--color-muted)', marginBottom: 14 }}>
        Clients, mentors, or colleagues who can vouch for your work. Silver Lining may reach out.
      </p>

      <ReferenceBlock
        index={1}
        value={data.reference_1}
        onChange={(r) => setData({ ...data, reference_1: r })}
      />
      <ReferenceBlock
        index={2}
        value={data.reference_2}
        onChange={(r) => setData({ ...data, reference_2: r })}
      />

      <hr style={hr} />
      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500 }}>
        <input type="checkbox" required checked={data.consent_vetting}
          onChange={(e) => setData({ ...data, consent_vetting: e.target.checked })}
          style={{ width: 'auto', marginTop: 3 }} />
        <span style={{ fontSize: 13.5, color: '#2a3130' }}>
          I agree to a vetting review by the Silver Lining team. My account stays in
          pending-review status until approved. *
        </span>
      </label>

      <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontWeight: 500, marginTop: 10 }}>
        <input type="checkbox" checked={data.marketing_opt_in}
          onChange={(e) => setData({ ...data, marketing_opt_in: e.target.checked })}
          style={{ width: 'auto', marginTop: 3 }} />
        <span style={{ fontSize: 13.5, color: '#2a3130' }}>
          Send me product updates from Mane Line. Unsubscribe anytime.
        </span>
      </label>
    </>
  );
}

function ReferenceBlock({
  index, value, onChange,
}: {
  index: number;
  value: TrainerRef;
  onChange: (r: TrainerRef) => void;
}) {
  return (
    <fieldset style={{ border: '1px solid var(--color-line)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <legend style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--color-primary)', padding: '0 6px' }}>
        Reference {index}
      </legend>
      <div style={grid2}>
        <Field label="Name *">
          <input type="text" required value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })} style={inputStyle} />
        </Field>
        <Field label="Phone or email *">
          <input type="text" required value={value.contact}
            onChange={(e) => onChange({ ...value, contact: e.target.value })} style={inputStyle} />
        </Field>
      </div>
      <Field label="Relationship">
        <input type="text" value={value.relationship}
          onChange={(e) => onChange({ ...value, relationship: e.target.value })}
          style={inputStyle} placeholder="Client of 4 years, mentor, barn owner..." />
      </Field>
    </fieldset>
  );
}

/* =============================================================
   Silver Lining step 2
   ============================================================= */
function SilverLiningStep2Form({ email }: { email: string }) {
  const ok = email.trim().toLowerCase().endsWith(`@${SLH_DOMAIN}`);
  return (
    <div style={{ padding: 20, background: ok ? 'var(--color-bg)' : '#fbe9e6', border: '1px solid var(--color-line)', borderRadius: 12 }}>
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

/* =============================================================
   Role picker card
   ============================================================= */
function RoleCard({
  value, label, description, current, onPick, note,
}: {
  value: SignupIntent;
  label: string;
  description: string;
  current: SignupIntent;
  onPick: (r: SignupIntent) => void;
  note?: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onPick(value)}
      style={{
        textAlign: 'left',
        padding: 14,
        borderRadius: 12,
        border: active ? '1.5px solid var(--color-primary)' : '1px solid var(--color-line)',
        background: active ? 'var(--color-surface)' : 'transparent',
        boxShadow: active ? '0 0 0 3px rgba(30,58,95,.08)' : 'none',
        cursor: 'pointer',
        width: '100%',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{
          display: 'inline-block', width: 18, height: 18, borderRadius: 999,
          border: '1.5px solid var(--color-primary)',
          background: active ? 'var(--color-primary)' : 'transparent',
        }} />
        <span style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--color-muted)', paddingLeft: 28 }}>
        {description}
      </div>
      {note ? (
        <div style={{ fontSize: 12, color: 'var(--color-muted)', paddingLeft: 28, marginTop: 4, fontStyle: 'italic' }}>
          {note}
        </div>
      ) : null}
    </button>
  );
}

/* =============================================================
   Shared bits
   ============================================================= */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const eyebrow: CSSProperties = {
  display: 'inline-block', fontSize: 12, letterSpacing: '.2em', textTransform: 'uppercase',
  color: 'var(--color-accent)', fontWeight: 700, marginTop: 16,
};
const card: CSSProperties = {
  background: 'var(--color-surface)', borderRadius: 16, padding: 28,
  border: '1px solid var(--color-line)', boxShadow: '0 10px 30px -18px rgba(30,58,95,.35)',
};
const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };
const hr: CSSProperties = { margin: '24px 0', border: 0, borderTop: '1px solid var(--color-line)' };
const inputStyle: CSSProperties = {
  width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 10,
  border: '1.5px solid var(--color-line)', background: 'var(--color-bg)', color: 'var(--color-ink)',
  outline: 'none', fontFamily: 'inherit',
};
const primaryBtn: CSSProperties = {
  padding: '13px 22px', fontSize: 15, fontWeight: 600, background: 'var(--color-primary)',
  color: '#fff', border: 0, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
};
const ghostBtn: CSSProperties = {
  padding: '13px 18px', fontSize: 14, fontWeight: 600, background: 'transparent',
  color: 'var(--color-primary)', border: '1px solid var(--color-line)', borderRadius: 10,
  cursor: 'pointer', fontFamily: 'inherit',
};
const errBox: CSSProperties = {
  padding: '12px 14px', borderRadius: 10, fontSize: 14, marginBottom: 14,
  background: '#fbe9e6', color: '#7a1d10', border: '1px solid #e9bdb5',
};
