import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { UserProfile } from './types';

interface AuthState {
  /** Null before first check, then either a Session or false-equivalent. */
  session: Session | null;
  /** Row from public.user_profiles, or null if the user has not completed signup yet. */
  profile: UserProfile | null;
  /** True until we've done the first getSession + profile fetch. */
  loading: boolean;
  /** One-time initialization — safe to call multiple times. */
  init: () => Promise<void>;
  /** Pull a fresh user_profiles row for the current session's user. */
  refreshProfile: () => Promise<void>;
  /** Sign out and redirect logic is handled by the caller. */
  signOut: () => Promise<void>;
}

let initialized = false;

async function fetchProfile(userId: string): Promise<UserProfile | null> {
  // `user_profiles.user_id` is the FK to auth.users(id). The row's own
  // `id` column is an unrelated surrogate PK, so we must NOT filter on it.
  const { data, error } = await supabase
    .from('user_profiles')
    .select('user_id, role, status, display_name, email, has_pin, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    // Don't throw — a missing row is a valid state (pre-migration user).
    // We return null and let the router send them to complete-profile.
    console.warn('[authStore] fetchProfile error:', error.message);
    return null;
  }
  return (data as UserProfile | null) ?? null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  profile: null,
  loading: true,

  init: async () => {
    if (initialized) return;
    initialized = true;

    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const profile = session ? await fetchProfile(session.user.id) : null;
    set({ session, profile, loading: false });

    supabase.auth.onAuthStateChange(async (_event, nextSession) => {
      const nextProfile = nextSession ? await fetchProfile(nextSession.user.id) : null;
      set({ session: nextSession, profile: nextProfile, loading: false });
    });
  },

  refreshProfile: async () => {
    const { session } = get();
    if (!session) {
      set({ profile: null });
      return;
    }
    const profile = await fetchProfile(session.user.id);
    set({ profile });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, profile: null });
  },
}));
