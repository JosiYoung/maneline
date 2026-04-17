import type { CSSProperties } from 'react';

// Shared CSS objects for the signup v2 flow. Broken out so form-
// component files don't have to re-declare them. Phase 1 replaces
// these with Tailwind tokens once the design system lands.

export const eyebrow: CSSProperties = {
  display: 'inline-block', fontSize: 12, letterSpacing: '.2em', textTransform: 'uppercase',
  color: 'var(--color-accent)', fontWeight: 700, marginTop: 16,
};
export const card: CSSProperties = {
  background: 'var(--color-surface)', borderRadius: 16, padding: 28,
  border: '1px solid var(--color-line)', boxShadow: '0 10px 30px -18px rgba(30,58,95,.35)',
};
export const grid2: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 };
export const hr: CSSProperties = { margin: '24px 0', border: 0, borderTop: '1px solid var(--color-line)' };
export const inputStyle: CSSProperties = {
  width: '100%', padding: '12px 14px', fontSize: 15, borderRadius: 10,
  border: '1.5px solid var(--color-line)', background: 'var(--color-bg)', color: 'var(--color-ink)',
  outline: 'none', fontFamily: 'inherit',
};
export const primaryBtn: CSSProperties = {
  padding: '13px 22px', fontSize: 15, fontWeight: 600, background: 'var(--color-primary)',
  color: '#fff', border: 0, borderRadius: 10, cursor: 'pointer', fontFamily: 'inherit',
};
export const ghostBtn: CSSProperties = {
  padding: '13px 18px', fontSize: 14, fontWeight: 600, background: 'transparent',
  color: 'var(--color-primary)', border: '1px solid var(--color-line)', borderRadius: 10,
  cursor: 'pointer', fontFamily: 'inherit',
};
export const errBox: CSSProperties = {
  padding: '12px 14px', borderRadius: 10, fontSize: 14, marginBottom: 14,
  background: '#fbe9e6', color: '#7a1d10', border: '1px solid #e9bdb5',
};
