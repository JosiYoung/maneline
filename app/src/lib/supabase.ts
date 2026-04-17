import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isConfigured = typeof url === 'string' && url.length > 0
  && typeof anonKey === 'string' && anonKey.length > 0;

/**
 * Whether the bundle was built with Supabase env vars. Call this at
 * app mount to decide whether to render the real tree or a friendly
 * config-missing screen. We intentionally do NOT throw at module load
 * anymore — a blank white page is worse than a small inline error.
 */
export function isSupabaseConfigured(): boolean {
  return isConfigured;
}

// When not configured we still export a client so that imports don't
// explode at the call site. Calls against it will fail; the app is
// expected to have rendered the <ConfigMissing> screen instead.
export const supabase: SupabaseClient<Database> = createClient<Database>(
  url ?? 'http://invalid.local',
  anonKey ?? 'invalid',
  {
    auth: {
      persistSession: isConfigured,
      autoRefreshToken: isConfigured,
      detectSessionInUrl: isConfigured,
      flowType: 'pkce',
    },
  }
);
