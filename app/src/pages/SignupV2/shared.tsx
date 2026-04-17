import type { ReactNode } from 'react';
import type { UserRole } from '../../lib/types';

export type SignupIntent = UserRole;

export const SLH_DOMAIN = 'silverliningherbs.com';

export interface Step1Data {
  email: string;
  full_name: string;
  phone: string;
  role: SignupIntent;
}

export interface TrainerRef {
  name: string;
  contact: string;
  relationship: string;
}

export function emptyRef(): TrainerRef {
  return { name: '', contact: '', relationship: '' };
}

/* --------------------------- Field -------------------------- */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/* --------------------------- StepIndicator ------------------- */
export function StepIndicator({ current }: { current: 1 | 2 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, fontSize: 13, color: 'var(--text-muted)' }}>
      <StepDot n={1} active={current === 1} done={current > 1} label="You" />
      <span style={{ flex: '0 0 24px', height: 1, background: 'var(--color-line)' }} />
      <StepDot n={2} active={current === 2} done={false} label="Details" />
    </div>
  );
}

function StepDot({ n, active, done, label }: { n: number; active: boolean; done: boolean; label: string }) {
  const fg = active || done ? 'var(--color-surface)' : 'var(--text-muted)';
  const bg = active || done ? 'var(--color-primary)' : 'var(--color-bg)';
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 999, background: bg, color: fg,
        border: '1px solid var(--color-line)', fontWeight: 700, fontSize: 13,
      }}>{n}</span>
      <span style={{ fontWeight: active ? 600 : 500, color: active ? 'var(--color-ink)' : 'var(--text-muted)' }}>
        {label}
      </span>
    </div>
  );
}

/* --------------------------- RoleCard ------------------------ */
export function RoleCard({
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
      <div style={{ fontSize: 13.5, color: 'var(--text-muted)', paddingLeft: 28 }}>
        {description}
      </div>
      {note ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', paddingLeft: 28, marginTop: 4, fontStyle: 'italic' }}>
          {note}
        </div>
      ) : null}
    </button>
  );
}

export function emailIsSlh(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${SLH_DOMAIN}`);
}

export function titleForRole(role: SignupIntent): string {
  switch (role) {
    case 'owner':          return 'Tell us about your barn';
    case 'trainer':        return 'Trainer application';
    case 'silver_lining':  return 'Confirm your Silver Lining email';
  }
}

export function stepTwoSubtitleForRole(role: SignupIntent): string {
  switch (role) {
    case 'owner':
      return 'A couple of details to pre-populate your barn. Your first horse is optional — you can add animals later.';
    case 'trainer':
      return 'The Silver Lining team reviews every trainer before access is granted. Typical turnaround is under 48 hours.';
    case 'silver_lining':
      return 'Admin accounts only — we just need to confirm the domain.';
  }
}

export function nextForRole(role: SignupIntent): string {
  switch (role) {
    case 'owner':          return '/app';
    case 'trainer':        return '/trainer';
    case 'silver_lining':  return '/admin';
  }
}
