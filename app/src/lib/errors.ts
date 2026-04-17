// Error surfacing helper. Every form used to do
//   setErrorMessage(error.message)
// which leaks PostgREST / RLS messages to end users ("new row violates
// row-level security policy for table ..."). This central helper maps
// the ones we care about to human-readable text and falls back to a
// safe generic message otherwise.
//
// Keep the mapping narrow — we'd rather ship a bland "Please try
// again" than accidentally leak table names.

import type { AuthError, PostgrestError } from '@supabase/supabase-js';

type AnyErr = AuthError | PostgrestError | Error | { message?: string; code?: string } | null | undefined;

const GENERIC = 'Something went wrong. Please try again.';

/**
 * Map a Supabase (or generic) error to a user-facing string.
 * Always returns something renderable — never null.
 */
export function mapSupabaseError(err: AnyErr): string {
  if (!err) return GENERIC;

  const raw = (typeof err === 'object' && 'message' in err && err.message) || '';
  const code = (typeof err === 'object' && 'code' in err && err.code) || '';
  const msg = String(raw);
  const lower = msg.toLowerCase();

  // ----- Auth (supabase-js AuthError) -----
  if (lower.includes('email rate limit')) {
    return 'Too many sign-in attempts. Please wait a minute and try again.';
  }
  if (lower.includes('invalid login credentials') || lower.includes('invalid pin')) {
    return 'That PIN is incorrect.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Please click the magic link we emailed you to confirm your account.';
  }
  if (lower.includes('user not found')) {
    // Deliberately vague — don't confirm whether an email is registered.
    return 'If that email is on file, a sign-in link is on its way.';
  }
  if (lower.includes('password should be') || lower.includes('weak password')) {
    return 'PIN must be exactly 6 digits.';
  }

  // ----- Network -----
  if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
    return 'Connection problem. Check your internet and try again.';
  }

  // ----- PostgREST / RLS — NEVER echo verbatim -----
  // 42501 = insufficient_privilege (RLS denied)
  // PGRST301 = JWT expired
  if (code === '42501' || lower.includes('row-level security') || lower.includes('violates row-level')) {
    return 'You don\u2019t have permission to do that.';
  }
  if (code === 'PGRST301' || lower.includes('jwt expired')) {
    return 'Your session expired. Please sign in again.';
  }
  if (code === '23505' || lower.includes('duplicate key')) {
    return 'That value is already in use.';
  }

  // ----- Rate limit (our Worker returns these) -----
  if (lower.includes('rate_limited') || lower.includes('rate limited') || lower.includes('429')) {
    return 'Too many requests. Please wait a moment and try again.';
  }

  return GENERIC;
}

/** For non-Supabase places that still have a message they want to surface. */
export function mapToUserMessage(err: unknown, fallback = GENERIC): string {
  if (err instanceof Error) return mapSupabaseError(err);
  if (typeof err === 'string') return err;
  return fallback;
}
