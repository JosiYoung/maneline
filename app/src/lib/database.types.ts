/**
 * Hand-rolled database types for the Mane Line Supabase schema.
 *
 * Source of truth: supabase/migrations/00002 through 00006. Only the tables
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

// Phase 2 — training sessions + payments
export type SessionType =
  | 'ride' | 'groundwork' | 'bodywork' | 'health_check' | 'lesson' | 'other';
export type SessionStatus = 'logged' | 'approved' | 'paid' | 'disputed';
export type SessionPaymentStatus =
  | 'pending' | 'processing' | 'succeeded' | 'failed'
  | 'refunded' | 'awaiting_trainer_setup';
export type SessionArchiveAction = 'archive' | 'unarchive';

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
          welcome_tour_seen_at: string | null;  // Phase 6 — 00016 migration
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
          welcome_tour_seen_at?: string | null;
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
          vet_phone: string | null;      // Phase 4 — 00012 migration
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
          vet_phone?: string | null;
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

      // ── Phase 2 — 00006_phase2_trainer_sessions ────────────────
      training_sessions: {
        Row: {
          id: string;
          trainer_id: string;
          owner_id: string;
          animal_id: string;
          session_type: SessionType;
          started_at: string;
          duration_minutes: number;
          title: string;
          notes: string | null;
          trainer_price_cents: number | null;
          currency: string;
          status: SessionStatus;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          trainer_id: string;
          owner_id: string;
          animal_id: string;
          session_type: SessionType;
          started_at: string;
          duration_minutes: number;
          title: string;
          notes?: string | null;
          trainer_price_cents?: number | null;
          currency?: string;
          status?: SessionStatus;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['training_sessions']['Insert']>;
        Relationships: [];
      };
      session_payments: {
        // Client-readable (owner sees payer_id match, trainer sees payee_id
        // match). All writes go through the Worker service_role.
        Row: {
          id: string;
          session_id: string;
          payer_id: string;
          payee_id: string;
          stripe_payment_intent_id: string | null;
          stripe_charge_id: string | null;
          stripe_event_last_seen: string | null;
          amount_cents: number;
          platform_fee_cents: number;
          currency: string;
          status: SessionPaymentStatus;
          failure_code: string | null;
          failure_message: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          payer_id: string;
          payee_id: string;
          stripe_payment_intent_id?: string | null;
          stripe_charge_id?: string | null;
          stripe_event_last_seen?: string | null;
          amount_cents: number;
          platform_fee_cents: number;
          currency?: string;
          status?: SessionPaymentStatus;
          failure_code?: string | null;
          failure_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['session_payments']['Insert']>;
        Relationships: [];
      };
      stripe_connect_accounts: {
        // Trainers read their own row via the v_my_connect_account view so
        // the fee_override_* columns stay hidden. This Row type mirrors the
        // full table because the Worker (service_role) reads/writes it
        // directly. SPA code should prefer `v_my_connect_account`.
        Row: {
          id: string;
          trainer_id: string;
          stripe_account_id: string;
          charges_enabled: boolean;
          payouts_enabled: boolean;
          details_submitted: boolean;
          disabled_reason: string | null;
          onboarding_link_last_issued_at: string | null;
          fee_override_bps: number | null;
          fee_override_reason: string | null;
          fee_override_set_by: string | null;
          fee_override_set_at: string | null;
          created_at: string;
          updated_at: string;
          deactivated_at: string | null;
        };
        Insert: {
          id?: string;
          trainer_id: string;
          stripe_account_id: string;
          charges_enabled?: boolean;
          payouts_enabled?: boolean;
          details_submitted?: boolean;
          disabled_reason?: string | null;
          onboarding_link_last_issued_at?: string | null;
          fee_override_bps?: number | null;
          fee_override_reason?: string | null;
          fee_override_set_by?: string | null;
          fee_override_set_at?: string | null;
          created_at?: string;
          updated_at?: string;
          deactivated_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['stripe_connect_accounts']['Insert']>;
        Relationships: [];
      };
      session_archive_events: {
        Row: {
          id: string;
          session_id: string;
          actor_id: string;
          action: SessionArchiveAction;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          actor_id: string;
          action: SessionArchiveAction;
          reason?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['session_archive_events']['Insert']>;
        Relationships: [];
      };
      // NOTE: platform_settings and stripe_webhook_events are deliberately
      // omitted — both are service_role-only (no client policy grants
      // select to authenticated). Adding Row types would invite the SPA
      // to query tables it cannot read.

      // =====================================================
      // Phase 3 — marketplace + expenses (00009, 00010)
      // =====================================================
      products: {
        Row: {
          id: string;
          shopify_product_id: string;
          shopify_variant_id: string;
          handle: string;
          sku: string;
          title: string;
          description: string | null;
          image_url: string | null;
          price_cents: number;
          currency: string;
          category: string | null;
          inventory_qty: number | null;
          available: boolean;
          protocol_mapping: Json | null;
          last_synced_at: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          shopify_product_id: string;
          shopify_variant_id: string;
          handle: string;
          sku: string;
          title: string;
          description?: string | null;
          image_url?: string | null;
          price_cents: number;
          currency?: string;
          category?: string | null;
          inventory_qty?: number | null;
          available?: boolean;
          protocol_mapping?: Json | null;
          last_synced_at?: string;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['products']['Insert']>;
        Relationships: [];
      };
      orders: {
        Row: {
          id: string;
          owner_id: string;
          stripe_checkout_session_id: string | null;
          stripe_payment_intent_id: string | null;
          stripe_charge_id: string | null;
          stripe_receipt_url: string | null;
          shopify_order_id: string | null;
          subtotal_cents: number;
          tax_cents: number;
          shipping_cents: number;
          total_cents: number;
          currency: string;
          status:
            | 'pending_payment'
            | 'paid'
            | 'failed'
            | 'refunded'
            | 'awaiting_merchant_setup';
          failure_code: string | null;
          failure_message: string | null;
          source: 'shop' | 'in_expense' | 'chat';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          owner_id: string;
          stripe_checkout_session_id?: string | null;
          stripe_payment_intent_id?: string | null;
          stripe_charge_id?: string | null;
          stripe_receipt_url?: string | null;
          shopify_order_id?: string | null;
          subtotal_cents: number;
          tax_cents?: number;
          shipping_cents?: number;
          total_cents: number;
          currency?: string;
          status?:
            | 'pending_payment'
            | 'paid'
            | 'failed'
            | 'refunded'
            | 'awaiting_merchant_setup';
          failure_code?: string | null;
          failure_message?: string | null;
          source?: 'shop' | 'in_expense' | 'chat';
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['orders']['Insert']>;
        Relationships: [];
      };
      order_line_items: {
        Row: {
          id: string;
          order_id: string;
          product_id: string | null;
          shopify_variant_id: string;
          sku_snapshot: string;
          title_snapshot: string;
          unit_price_cents: number;
          quantity: number;
          line_total_cents: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id?: string | null;
          shopify_variant_id: string;
          sku_snapshot: string;
          title_snapshot: string;
          unit_price_cents: number;
          quantity: number;
          line_total_cents: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['order_line_items']['Insert']>;
        Relationships: [];
      };
      expenses: {
        Row: {
          id: string;
          animal_id: string;
          recorder_id: string;
          recorder_role: 'owner' | 'trainer';
          category:
            | 'feed' | 'tack' | 'vet' | 'board' | 'farrier'
            | 'supplement' | 'travel' | 'show' | 'other';
          occurred_on: string;
          amount_cents: number;
          currency: string;
          vendor: string | null;
          notes: string | null;
          order_id: string | null;
          product_id: string | null;
          receipt_r2_object_id: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          animal_id: string;
          recorder_id: string;
          recorder_role: 'owner' | 'trainer';
          category:
            | 'feed' | 'tack' | 'vet' | 'board' | 'farrier'
            | 'supplement' | 'travel' | 'show' | 'other';
          occurred_on: string;
          amount_cents: number;
          currency?: string;
          vendor?: string | null;
          notes?: string | null;
          order_id?: string | null;
          product_id?: string | null;
          receipt_r2_object_id?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['expenses']['Insert']>;
        Relationships: [];
      };

      // =====================================================
      // Phase 3.5 + Phase 4 — protocols + chat (00012)
      // =====================================================
      protocols: {
        Row: {
          id: string;
          number: string | null;
          name: string;
          description: string | null;
          use_case: string | null;
          body_md: string | null;
          associated_sku_placeholder: string | null;
          product_id: string | null;
          category: string | null;
          keywords: string[];
          linked_sku_codes: string[];
          published: boolean;
          embed_status: 'pending' | 'synced' | 'failed';
          embed_synced_at: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          number?: string | null;
          name: string;
          description?: string | null;
          use_case?: string | null;
          body_md?: string | null;
          associated_sku_placeholder?: string | null;
          product_id?: string | null;
          category?: string | null;
          keywords?: string[];
          linked_sku_codes?: string[];
          published?: boolean;
          embed_status?: 'pending' | 'synced' | 'failed';
          embed_synced_at?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['protocols']['Insert']>;
        Relationships: [];
      };
      animal_protocols: {
        Row: {
          id: string;
          animal_id: string;
          protocol_id: string;
          started_on: string;
          ended_on: string | null;
          dose_instructions: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          animal_id: string;
          protocol_id: string;
          started_on: string;
          ended_on?: string | null;
          dose_instructions?: string | null;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['animal_protocols']['Insert']>;
        Relationships: [];
      };
      supplement_doses: {
        Row: {
          id: string;
          animal_protocol_id: string;
          animal_id: string;
          dosed_on: string;
          dosed_at_time: string | null;
          confirmed_by: string;
          confirmed_role: 'owner' | 'trainer';
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          animal_protocol_id: string;
          animal_id: string;
          dosed_on?: string;
          dosed_at_time?: string | null;
          confirmed_by: string;
          confirmed_role: 'owner' | 'trainer';
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['supplement_doses']['Insert']>;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string;
          owner_id: string;
          title: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          owner_id: string;
          title?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database['public']['Tables']['conversations']['Insert']>;
        Relationships: [];
      };
      chatbot_runs: {
        Row: {
          id: string;
          conversation_id: string;
          turn_index: number;
          role: 'user' | 'assistant' | 'system';
          user_text: string | null;
          response_text: string | null;
          retrieved_protocol_ids: string[];
          model_id: string | null;
          latency_ms: number | null;
          fallback: 'none' | 'kv_keyword' | 'emergency';
          emergency_triggered: boolean;
          rate_limit_remaining: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          turn_index: number;
          role: 'user' | 'assistant' | 'system';
          user_text?: string | null;
          response_text?: string | null;
          retrieved_protocol_ids?: string[];
          model_id?: string | null;
          latency_ms?: number | null;
          fallback?: 'none' | 'kv_keyword' | 'emergency';
          emergency_triggered?: boolean;
          rate_limit_remaining?: number | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['chatbot_runs']['Insert']>;
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
      // Phase 2 — 00006
      // effective_fee_bps + latest_connect_for are revoked from
      // anon/authenticated; only the Worker service_role may invoke them.
      // The types are kept so the Worker's Supabase client stays strict.
      effective_fee_bps: {
        Args: { p_trainer_id: string };
        Returns: number;
      };
      session_is_payable: {
        Args: { p_session_id: string };
        Returns: boolean;
      };
    };
    Views: {
      // Trainer-facing read of their own Connect status. Service_invoker=true
      // so the trainer's RLS policy on stripe_connect_accounts still governs
      // access; this view only hides the fee_override_* columns.
      v_my_connect_account: {
        Row: {
          id: string;
          trainer_id: string;
          stripe_account_id: string;
          charges_enabled: boolean;
          payouts_enabled: boolean;
          details_submitted: boolean;
          disabled_reason: string | null;
          onboarding_link_last_issued_at: string | null;
          created_at: string;
          updated_at: string;
          deactivated_at: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
