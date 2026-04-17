/**
 * Hand-rolled database types for the Mane Line Supabase schema.
 *
 * Source of truth: supabase/migrations/00002 through 00004. Only the tables
 * the SPA reads or writes are mirrored here — we don't replicate the
 * internal audit/log tables or anything the worker owns (service_role only).
 *
 * Shape follows Supabase's generated-types convention (Database.public.Tables)
 * so `createClient<Database>(...)` in lib/supabase.ts will pick them up
 * without any adapter. Until the full `supabase gen types` pipeline is wired
 * up, update this file by hand whenever a migration lands that touches an
 * SPA-reachable table.
 *
 * TECH_DEBT(phase-1): replace with generated types once the local Supabase
 * CLI is added to the dev loop.
 */

export type UserRole = 'owner' | 'trainer' | 'silver_lining';
export type UserStatus = 'active' | 'pending_review' | 'suspended' | 'archived';
export type AnimalSpecies = 'horse' | 'dog';
export type AnimalSex = 'mare' | 'gelding' | 'stallion' | 'male' | 'female';
export type GrantScope = 'animal' | 'ranch' | 'owner_all';
export type TrainerApplicationStatus =
  | 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'archived';
export type TrainerProfileStatus =
  | 'submitted' | 'approved' | 'rejected' | 'suspended';

type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      user_profiles: {
        Row: {
          id: string;
          user_id: string;
          role: UserRole;
          display_name: string;
          email: string;
          status: UserStatus;
          has_pin: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role: UserRole;
          display_name: string;
          email: string;
          status?: UserStatus;
          has_pin?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['user_profiles']['Insert']>;
        Relationships: [];
      };
      animals: {
        Row: {
          id: string;
          owner_id: string;
          species: AnimalSpecies;
          barn_name: string;
          breed: string | null;
          sex: AnimalSex | null;
          year_born: number | null;
          discipline: string | null;
          archived_at: string | null;   // Phase 1 — 00005 migration
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          species?: AnimalSpecies;
          barn_name: string;
          breed?: string | null;
          sex?: AnimalSex | null;
          year_born?: number | null;
          discipline?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['animals']['Insert']>;
        Relationships: [];
      };
      ranches: {
        Row: {
          id: string;
          owner_id: string;
          name: string;
          address: string | null;
          city: string | null;
          state: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          name: string;
          address?: string | null;
          city?: string | null;
          state?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['ranches']['Insert']>;
        Relationships: [];
      };
      animal_access_grants: {
        Row: {
          id: string;
          owner_id: string;
          trainer_id: string;
          scope: GrantScope;
          animal_id: string | null;
          ranch_id: string | null;
          granted_at: string;
          revoked_at: string | null;
          grace_period_ends_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          trainer_id: string;
          scope: GrantScope;
          animal_id?: string | null;
          ranch_id?: string | null;
          granted_at?: string;
          revoked_at?: string | null;
          grace_period_ends_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['animal_access_grants']['Insert']>;
        Relationships: [];
      };
      trainer_profiles: {
        Row: {
          id: string;
          user_id: string;
          logo_url: string | null;
          brand_hex: string | null;
          bio: string | null;
          certifications: Json;
          stripe_connect_id: string | null;
          application_status: TrainerProfileStatus;
          reviewed_by: string | null;
          reviewed_at: string | null;
          review_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          logo_url?: string | null;
          brand_hex?: string | null;
          bio?: string | null;
          certifications?: Json;
          stripe_connect_id?: string | null;
          application_status?: TrainerProfileStatus;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          review_notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['trainer_profiles']['Insert']>;
        Relationships: [];
      };
      r2_objects: {
        Row: {
          id: string;
          owner_id: string;
          bucket: string;
          object_key: string;
          kind: string;
          content_type: string;
          byte_size: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          bucket?: string;
          object_key: string;
          kind: string;
          content_type: string;
          byte_size: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['r2_objects']['Insert']>;
        Relationships: [];
      };
      vet_records: {
        Row: {
          id: string;
          owner_id: string;
          animal_id: string;
          r2_object_id: string;
          record_type: 'coggins' | 'vaccine' | 'dental' | 'farrier' | 'other';
          issued_on: string | null;
          expires_on: string | null;
          issuing_provider: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          animal_id: string;
          r2_object_id: string;
          record_type: 'coggins' | 'vaccine' | 'dental' | 'farrier' | 'other';
          issued_on?: string | null;
          expires_on?: string | null;
          issuing_provider?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['vet_records']['Insert']>;
        Relationships: [];
      };
      animal_media: {
        Row: {
          id: string;
          owner_id: string;
          animal_id: string;
          r2_object_id: string;
          kind: 'photo' | 'video';
          caption: string | null;
          taken_on: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          animal_id: string;
          r2_object_id: string;
          kind: 'photo' | 'video';
          caption?: string | null;
          taken_on?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['animal_media']['Insert']>;
        Relationships: [];
      };
      trainer_applications: {
        Row: {
          id: string;
          user_id: string;
          submitted_at: string;
          application: Json;
          status: TrainerApplicationStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          submitted_at?: string;
          application?: Json;
          status?: TrainerApplicationStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['trainer_applications']['Insert']>;
        Relationships: [];
      };
    };
    Functions: {
      // NOTE: check_has_pin's EXECUTE grant to anon/authenticated was revoked
      // in 00004 — the SPA goes through /api/has-pin now. The type stays
      // because the worker still uses the RPC via the service role.
      check_has_pin: {
        Args: { p_email: string };
        Returns: boolean;
      };
      set_pin: {
        Args: Record<string, never>;
        Returns: void;
      };
      clear_pin: {
        Args: Record<string, never>;
        Returns: void;
      };
      get_my_role: {
        Args: Record<string, never>;
        Returns: UserRole | null;
      };
      is_silver_lining_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      am_i_owner_of: {
        Args: { animal_id: string };
        Returns: boolean;
      };
      do_i_have_access_to_animal: {
        Args: { animal_id: string };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    Views: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
