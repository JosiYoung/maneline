// Re-exports for the SPA — all schema shapes live in database.types.ts
// (the hand-rolled mirror of the Supabase schema). Keeping this file thin
// so there's one canonical `UserProfile` type instead of two that can drift.

import type { Database, UserRole, UserStatus } from './database.types';

export type { UserRole, UserStatus };

// Row shape straight out of the DB types, re-exported with the historical
// name the rest of the SPA already imports.
export type UserProfile = Database['public']['Tables']['user_profiles']['Row'];
