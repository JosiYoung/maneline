// Shared types that mirror the shapes introduced in
// supabase/migrations/00002_phase0_multirole_foundation.sql.
// Keep this file narrow — only types the SPA actually reads.

export type UserRole = 'owner' | 'trainer' | 'silver_lining';

export type UserStatus = 'active' | 'pending_review' | 'suspended' | 'archived';

export interface UserProfile {
  // Matches public.user_profiles.user_id — the FK into auth.users(id),
  // NOT the user_profiles row PK (that column is `id` and we ignore it).
  user_id: string;
  role: UserRole;
  status: UserStatus;
  display_name: string | null;
  email: string | null;
  has_pin: boolean;
  created_at: string;
  updated_at: string;
}
