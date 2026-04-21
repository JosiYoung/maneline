/**
 * Supabase types — regenerated via MCP then extended with the hand-rolled
 * string-literal aliases the SPA imports as named types. The underlying
 * database uses CHECK constraints rather than Postgres enums, so the
 * generated types expose those columns as plain 'string'. The aliases
 * below give the TypeScript side the narrow shape it actually relies on.
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
export type SessionType =
  | 'ride' | 'groundwork' | 'bodywork' | 'health_check' | 'lesson' | 'other';
export type SessionStatus = 'logged' | 'approved' | 'paid' | 'disputed';
export type SessionPaymentStatus =
  | 'pending' | 'processing' | 'succeeded' | 'failed'
  | 'refunded' | 'awaiting_trainer_setup';
export type SessionArchiveAction = 'archive' | 'unarchive';
export type InvoiceStatus =
  | 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
export type InvoiceLineKind = 'session' | 'expense' | 'custom' | 'recurring';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      animal_access_grants: {
        Row: {
          animal_id: string | null
          billing_mode: string
          created_at: string
          grace_period_ends_at: string | null
          granted_at: string
          id: string
          notes: string | null
          owner_id: string
          ranch_id: string | null
          revoked_at: string | null
          scope: string
          trainer_id: string
          updated_at: string
        }
        Insert: {
          animal_id?: string | null
          billing_mode?: string
          created_at?: string
          grace_period_ends_at?: string | null
          granted_at?: string
          id?: string
          notes?: string | null
          owner_id: string
          ranch_id?: string | null
          revoked_at?: string | null
          scope: string
          trainer_id: string
          updated_at?: string
        }
        Update: {
          animal_id?: string | null
          billing_mode?: string
          created_at?: string
          grace_period_ends_at?: string | null
          granted_at?: string
          id?: string
          notes?: string | null
          owner_id?: string
          ranch_id?: string | null
          revoked_at?: string | null
          scope?: string
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "animal_access_grants_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "animal_access_grants_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "animal_access_grants_ranch_id_fkey"
            columns: ["ranch_id"]
            isOneToOne: false
            referencedRelation: "ranches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "animal_access_grants_trainer_id_fkey"
            columns: ["trainer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      animal_archive_events: {
        Row: {
          action: string
          actor_id: string
          animal_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_id: string
          animal_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          animal_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "animal_archive_events_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
        ]
      }
      animal_media: {
        Row: {
          animal_id: string
          archived_at: string | null
          caption: string | null
          created_at: string
          id: string
          kind: string
          owner_id: string
          r2_object_id: string
          taken_on: string | null
          updated_at: string
        }
        Insert: {
          animal_id: string
          archived_at?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          kind: string
          owner_id: string
          r2_object_id: string
          taken_on?: string | null
          updated_at?: string
        }
        Update: {
          animal_id?: string
          archived_at?: string | null
          caption?: string | null
          created_at?: string
          id?: string
          kind?: string
          owner_id?: string
          r2_object_id?: string
          taken_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "animal_media_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "animal_media_r2_object_id_fkey"
            columns: ["r2_object_id"]
            isOneToOne: false
            referencedRelation: "r2_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      animal_protocols: {
        Row: {
          animal_id: string
          archived_at: string | null
          created_at: string
          created_by: string
          dose_instructions: string | null
          ended_on: string | null
          id: string
          notes: string | null
          protocol_id: string
          started_on: string
          updated_at: string
        }
        Insert: {
          animal_id: string
          archived_at?: string | null
          created_at?: string
          created_by: string
          dose_instructions?: string | null
          ended_on?: string | null
          id?: string
          notes?: string | null
          protocol_id: string
          started_on: string
          updated_at?: string
        }
        Update: {
          animal_id?: string
          archived_at?: string | null
          created_at?: string
          created_by?: string
          dose_instructions?: string | null
          ended_on?: string | null
          id?: string
          notes?: string | null
          protocol_id?: string
          started_on?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "animal_protocols_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "animal_protocols_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      animals: {
        Row: {
          archived_at: string | null
          barn_name: string
          breed: string | null
          created_at: string
          discipline: string | null
          id: string
          owner_id: string
          sex: AnimalSex | null
          species: AnimalSpecies
          updated_at: string
          vet_phone: string | null
          year_born: number | null
        }
        Insert: {
          archived_at?: string | null
          barn_name: string
          breed?: string | null
          created_at?: string
          discipline?: string | null
          id?: string
          owner_id: string
          sex?: AnimalSex | null
          species?: AnimalSpecies
          updated_at?: string
          vet_phone?: string | null
          year_born?: number | null
        }
        Update: {
          archived_at?: string | null
          barn_name?: string
          breed?: string | null
          created_at?: string
          discipline?: string | null
          id?: string
          owner_id?: string
          sex?: AnimalSex | null
          species?: AnimalSpecies
          updated_at?: string
          vet_phone?: string | null
          year_born?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "animals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          updated_at: string
          value: string
        }
        Insert: {
          key: string
          updated_at?: string
          value: string
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          id: number
          ip: string | null
          metadata: Json
          occurred_at: string
          target_id: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          id?: number
          ip?: string | null
          metadata?: Json
          occurred_at?: string
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          id?: number
          ip?: string | null
          metadata?: Json
          occurred_at?: string
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      chatbot_runs: {
        Row: {
          conversation_id: string
          created_at: string
          emergency_triggered: boolean
          fallback: string
          id: string
          latency_ms: number | null
          model_id: string | null
          rate_limit_remaining: number | null
          response_text: string | null
          retrieved_protocol_ids: string[]
          role: string
          turn_index: number
          user_text: string | null
        }
        Insert: {
          conversation_id: string
          created_at?: string
          emergency_triggered?: boolean
          fallback?: string
          id?: string
          latency_ms?: number | null
          model_id?: string | null
          rate_limit_remaining?: number | null
          response_text?: string | null
          retrieved_protocol_ids?: string[]
          role: string
          turn_index: number
          user_text?: string | null
        }
        Update: {
          conversation_id?: string
          created_at?: string
          emergency_triggered?: boolean
          fallback?: string
          id?: string
          latency_ms?: number | null
          model_id?: string | null
          rate_limit_remaining?: number | null
          response_text?: string | null
          retrieved_protocol_ids?: string[]
          role?: string
          turn_index?: number
          user_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chatbot_runs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          owner_id: string
          title: string | null
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          owner_id: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          owner_id?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      expense_archive_events: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          expense_id: string
          id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          expense_id: string
          id?: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          expense_id?: string
          id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_archive_events_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_cents: number
          animal_id: string
          archived_at: string | null
          billable_to_owner: boolean
          category: string
          created_at: string
          currency: string
          id: string
          markup_bps: number
          notes: string | null
          occurred_on: string
          order_id: string | null
          product_id: string | null
          receipt_r2_object_id: string | null
          recorder_id: string
          recorder_role: string
          tax_rate_bps: number
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount_cents: number
          animal_id: string
          archived_at?: string | null
          billable_to_owner?: boolean
          category: string
          created_at?: string
          currency?: string
          id?: string
          markup_bps?: number
          notes?: string | null
          occurred_on: string
          order_id?: string | null
          product_id?: string | null
          receipt_r2_object_id?: string | null
          recorder_id: string
          recorder_role: string
          tax_rate_bps?: number
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount_cents?: number
          animal_id?: string
          archived_at?: string | null
          billable_to_owner?: boolean
          category?: string
          created_at?: string
          currency?: string
          id?: string
          markup_bps?: number
          notes?: string | null
          occurred_on?: string
          order_id?: string | null
          product_id?: string | null
          receipt_r2_object_id?: string | null
          recorder_id?: string
          recorder_role?: string
          tax_rate_bps?: number
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_receipt_r2_object_id_fkey"
            columns: ["receipt_r2_object_id"]
            isOneToOne: false
            referencedRelation: "r2_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      horses: {
        Row: {
          barn_name: string
          breed: string | null
          created_at: string | null
          discipline: string | null
          id: string
          owner_id: string
          sex: string | null
          updated_at: string | null
          year_born: number | null
        }
        Insert: {
          barn_name: string
          breed?: string | null
          created_at?: string | null
          discipline?: string | null
          id?: string
          owner_id: string
          sex?: string | null
          updated_at?: string | null
          year_born?: number | null
        }
        Update: {
          barn_name?: string
          breed?: string | null
          created_at?: string | null
          discipline?: string | null
          id?: string
          owner_id?: string
          sex?: string | null
          updated_at?: string | null
          year_born?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "horses_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hubspot_sync_log: {
        Row: {
          created_at: string
          event_name: string
          hubspot_contact_id: string | null
          hubspot_deal_id: string | null
          id: string
          latency_ms: number | null
          payload: Json
          response: Json
        }
        Insert: {
          created_at?: string
          event_name: string
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          id?: string
          latency_ms?: number | null
          payload?: Json
          response?: Json
        }
        Update: {
          created_at?: string
          event_name?: string
          hubspot_contact_id?: string | null
          hubspot_deal_id?: string | null
          id?: string
          latency_ms?: number | null
          payload?: Json
          response?: Json
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          accepted_user_id: string | null
          archived_at: string | null
          barn_name: string | null
          batch: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_at: string
          invited_by: string | null
          role: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          archived_at?: string | null
          barn_name?: string | null
          batch?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role: string
          token: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_user_id?: string | null
          archived_at?: string | null
          barn_name?: string | null
          batch?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          role?: string
          token?: string
          updated_at?: string
        }
        Relationships: []
      }
      invoice_line_items: {
        Row: {
          amount_cents: number
          created_at: string
          description: string
          id: string
          invoice_id: string
          kind: InvoiceLineKind
          quantity: number
          sort_order: number
          source_id: string | null
          tax_rate_bps: number
          unit_amount_cents: number
        }
        Insert: {
          amount_cents: number
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          kind: InvoiceLineKind
          quantity?: number
          sort_order?: number
          source_id?: string | null
          tax_rate_bps?: number
          unit_amount_cents: number
        }
        Update: {
          amount_cents?: number
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          kind?: InvoiceLineKind
          quantity?: number
          sort_order?: number
          source_id?: string | null
          tax_rate_bps?: number
          unit_amount_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_line_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          adhoc_email: string | null
          adhoc_name: string | null
          amount_paid_cents: number
          created_at: string
          currency: string
          due_date: string
          id: string
          invoice_number: string | null
          notes: string | null
          owner_id: string | null
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          platform_fee_cents: number
          sent_at: string | null
          status: InvoiceStatus
          stripe_customer_id: string | null
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string | null
          stripe_invoice_pdf_url: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          trainer_id: string
          updated_at: string
          voided_at: string | null
        }
        Insert: {
          adhoc_email?: string | null
          adhoc_name?: string | null
          amount_paid_cents?: number
          created_at?: string
          currency?: string
          due_date: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          owner_id?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_fee_cents?: number
          sent_at?: string | null
          status?: InvoiceStatus
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_pdf_url?: string | null
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          trainer_id: string
          updated_at?: string
          voided_at?: string | null
        }
        Update: {
          adhoc_email?: string | null
          adhoc_name?: string | null
          amount_paid_cents?: number
          created_at?: string
          currency?: string
          due_date?: string
          id?: string
          invoice_number?: string | null
          notes?: string | null
          owner_id?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          platform_fee_cents?: number
          sent_at?: string | null
          status?: InvoiceStatus
          stripe_customer_id?: string | null
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string | null
          stripe_invoice_pdf_url?: string | null
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          trainer_id?: string
          updated_at?: string
          voided_at?: string | null
        }
        Relationships: []
      }
      on_call_schedule: {
        Row: {
          archived_at: string | null
          created_at: string
          ends_at: string
          id: string
          notes: string | null
          phone_e164: string
          starts_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          ends_at: string
          id?: string
          notes?: string | null
          phone_e164: string
          starts_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          ends_at?: string
          id?: string
          notes?: string | null
          phone_e164?: string
          starts_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      order_line_items: {
        Row: {
          created_at: string
          id: string
          line_total_cents: number
          order_id: string
          product_id: string | null
          quantity: number
          shopify_variant_id: string
          sku_snapshot: string
          title_snapshot: string
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          line_total_cents: number
          order_id: string
          product_id?: string | null
          quantity: number
          shopify_variant_id: string
          sku_snapshot: string
          title_snapshot: string
          unit_price_cents: number
        }
        Update: {
          created_at?: string
          id?: string
          line_total_cents?: number
          order_id?: string
          product_id?: string | null
          quantity?: number
          shopify_variant_id?: string
          sku_snapshot?: string
          title_snapshot?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_line_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_line_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      order_refunds: {
        Row: {
          amount_cents: number
          created_at: string
          id: string
          last_error: string | null
          order_id: string
          reason: string | null
          refunded_by: string
          stripe_refund_id: string | null
          stripe_status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          id?: string
          last_error?: string | null
          order_id: string
          reason?: string | null
          refunded_by: string
          stripe_refund_id?: string | null
          stripe_status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          id?: string
          last_error?: string | null
          order_id?: string
          reason?: string | null
          refunded_by?: string
          stripe_refund_id?: string | null
          stripe_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_refunds_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          created_at: string
          currency: string
          failure_code: string | null
          failure_message: string | null
          id: string
          owner_id: string
          shipping_cents: number
          shopify_order_id: string | null
          source: string
          status: string
          stripe_charge_id: string | null
          stripe_checkout_session_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          stripe_receipt_url: string | null
          stripe_subscription_id: string | null
          subtotal_cents: number
          tax_cents: number
          total_cents: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          owner_id: string
          shipping_cents?: number
          shopify_order_id?: string | null
          source?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          subtotal_cents: number
          tax_cents?: number
          total_cents: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          owner_id?: string
          shipping_cents?: number
          shopify_order_id?: string | null
          source?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_receipt_url?: string | null
          stripe_subscription_id?: string | null
          subtotal_cents?: number
          tax_cents?: number
          total_cents?: number
          updated_at?: string
        }
        Relationships: []
      }
      pending_hubspot_syncs: {
        Row: {
          attempts: number
          created_at: string
          event_name: string
          id: string
          last_error: string | null
          next_run_at: string
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_name: string
          id?: string
          last_error?: string | null
          next_run_at?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event_name?: string
          id?: string
          last_error?: string | null
          next_run_at?: string
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          default_fee_bps: number
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_fee_bps?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_fee_bps?: number
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      products: {
        Row: {
          archived_at: string | null
          available: boolean
          category: string | null
          created_at: string
          currency: string
          description: string | null
          handle: string
          id: string
          image_url: string | null
          inventory_qty: number | null
          last_synced_at: string
          price_cents: number
          protocol_mapping: Json | null
          shopify_product_id: string
          shopify_variant_id: string
          sku: string
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          available?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          handle: string
          id?: string
          image_url?: string | null
          inventory_qty?: number | null
          last_synced_at?: string
          price_cents: number
          protocol_mapping?: Json | null
          shopify_product_id: string
          shopify_variant_id: string
          sku: string
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          available?: boolean
          category?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          handle?: string
          id?: string
          image_url?: string | null
          inventory_qty?: number | null
          last_synced_at?: string
          price_cents?: number
          protocol_mapping?: Json | null
          shopify_product_id?: string
          shopify_variant_id?: string
          sku?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          discipline: string | null
          email: string | null
          full_name: string | null
          id: string
          location: string | null
          marketing_opt_in: boolean | null
          phone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          discipline?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          location?: string | null
          marketing_opt_in?: boolean | null
          phone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          discipline?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          location?: string | null
          marketing_opt_in?: boolean | null
          phone?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      protocols: {
        Row: {
          archived_at: string | null
          associated_sku_placeholder: string | null
          body_md: string | null
          category: string | null
          created_at: string
          description: string | null
          embed_status: string
          embed_synced_at: string | null
          id: string
          keywords: string[]
          linked_sku_codes: string[]
          name: string
          number: string | null
          product_id: string | null
          published: boolean
          updated_at: string
          use_case: string | null
        }
        Insert: {
          archived_at?: string | null
          associated_sku_placeholder?: string | null
          body_md?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          embed_status?: string
          embed_synced_at?: string | null
          id?: string
          keywords?: string[]
          linked_sku_codes?: string[]
          name: string
          number?: string | null
          product_id?: string | null
          published?: boolean
          updated_at?: string
          use_case?: string | null
        }
        Update: {
          archived_at?: string | null
          associated_sku_placeholder?: string | null
          body_md?: string | null
          category?: string | null
          created_at?: string
          description?: string | null
          embed_status?: string
          embed_synced_at?: string | null
          id?: string
          keywords?: string[]
          linked_sku_codes?: string[]
          name?: string
          number?: string | null
          product_id?: string | null
          published?: boolean
          updated_at?: string
          use_case?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "protocols_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      r2_objects: {
        Row: {
          bucket: string
          byte_size: number
          content_type: string
          created_at: string
          deleted_at: string | null
          id: string
          kind: string
          object_key: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          bucket?: string
          byte_size: number
          content_type: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: string
          object_key: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          bucket?: string
          byte_size?: number
          content_type?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: string
          object_key?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ranches: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          name: string
          owner_id: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          name: string
          owner_id: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ranches_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_line_items: {
        Row: {
          active: boolean
          adhoc_email: string | null
          amount_cents: number
          animal_id: string | null
          created_at: string
          description: string
          id: string
          owner_id: string | null
          trainer_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          adhoc_email?: string | null
          amount_cents: number
          animal_id?: string | null
          created_at?: string
          description: string
          id?: string
          owner_id?: string | null
          trainer_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          adhoc_email?: string | null
          amount_cents?: number
          animal_id?: string | null
          created_at?: string
          description?: string
          id?: string
          owner_id?: string | null
          trainer_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_line_items_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
        ]
      }
      seed_run_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          protocol_id: string | null
          run_id: string
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          protocol_id?: string | null
          run_id: string
          status: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          protocol_id?: string | null
          run_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "seed_run_log_protocol_id_fkey"
            columns: ["protocol_id"]
            isOneToOne: false
            referencedRelation: "protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      session_archive_events: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          reason: string | null
          session_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          reason?: string | null
          session_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_archive_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      session_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          failure_code: string | null
          failure_message: string | null
          id: string
          payee_id: string
          payer_id: string
          platform_fee_cents: number
          session_id: string
          status: string
          stripe_charge_id: string | null
          stripe_event_last_seen: string | null
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          payee_id: string
          payer_id: string
          platform_fee_cents: number
          session_id: string
          status?: string
          stripe_charge_id?: string | null
          stripe_event_last_seen?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          payee_id?: string
          payer_id?: string
          platform_fee_cents?: number
          session_id?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_event_last_seen?: string | null
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "session_payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: true
            referencedRelation: "training_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      shopify_sync_cursor: {
        Row: {
          id: number
          last_error: string | null
          last_ok_at: string | null
          last_run_at: string | null
          products_archived: number
          products_upserted: number
          updated_at: string
        }
        Insert: {
          id?: number
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          products_archived?: number
          products_upserted?: number
          updated_at?: string
        }
        Update: {
          id?: number
          last_error?: string | null
          last_ok_at?: string | null
          last_run_at?: string | null
          products_archived?: number
          products_upserted?: number
          updated_at?: string
        }
        Relationships: []
      }
      sms_dispatches: {
        Row: {
          body: string
          cost_cents: number | null
          created_at: string
          delivered_at: string | null
          error_code: number | null
          id: string
          on_call_user_id: string | null
          sent_at: string | null
          status: string
          ticket_id: string | null
          to_phone: string
          twilio_message_sid: string | null
        }
        Insert: {
          body: string
          cost_cents?: number | null
          created_at?: string
          delivered_at?: string | null
          error_code?: number | null
          id?: string
          on_call_user_id?: string | null
          sent_at?: string | null
          status?: string
          ticket_id?: string | null
          to_phone: string
          twilio_message_sid?: string | null
        }
        Update: {
          body?: string
          cost_cents?: number | null
          created_at?: string
          delivered_at?: string | null
          error_code?: number | null
          id?: string
          on_call_user_id?: string | null
          sent_at?: string | null
          status?: string
          ticket_id?: string | null
          to_phone?: string
          twilio_message_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_dispatches_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_connect_accounts: {
        Row: {
          charges_enabled: boolean
          created_at: string
          deactivated_at: string | null
          details_submitted: boolean
          disabled_reason: string | null
          fee_override_bps: number | null
          fee_override_reason: string | null
          fee_override_set_at: string | null
          fee_override_set_by: string | null
          id: string
          onboarding_link_last_issued_at: string | null
          payouts_enabled: boolean
          stripe_account_id: string
          trainer_id: string
          updated_at: string
        }
        Insert: {
          charges_enabled?: boolean
          created_at?: string
          deactivated_at?: string | null
          details_submitted?: boolean
          disabled_reason?: string | null
          fee_override_bps?: number | null
          fee_override_reason?: string | null
          fee_override_set_at?: string | null
          fee_override_set_by?: string | null
          id?: string
          onboarding_link_last_issued_at?: string | null
          payouts_enabled?: boolean
          stripe_account_id: string
          trainer_id: string
          updated_at?: string
        }
        Update: {
          charges_enabled?: boolean
          created_at?: string
          deactivated_at?: string | null
          details_submitted?: boolean
          disabled_reason?: string | null
          fee_override_bps?: number | null
          fee_override_reason?: string | null
          fee_override_set_at?: string | null
          fee_override_set_by?: string | null
          id?: string
          onboarding_link_last_issued_at?: string | null
          payouts_enabled?: boolean
          stripe_account_id?: string
          trainer_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_subscriptions: {
        Row: {
          archived_at: string | null
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          customer_id: string
          id: string
          items: Json
          last_synced_at: string
          owner_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id: string
          id: string
          items?: Json
          last_synced_at?: string
          owner_id?: string | null
          status: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id?: string
          id?: string
          items?: Json
          last_synced_at?: string
          owner_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      stripe_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          id: string
          last_error: string | null
          payload: Json
          processed_at: string | null
          processing_attempts: number
          received_at: string
          source: string
        }
        Insert: {
          event_id: string
          event_type: string
          id?: string
          last_error?: string | null
          payload: Json
          processed_at?: string | null
          processing_attempts?: number
          received_at?: string
          source?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          id?: string
          last_error?: string | null
          payload?: Json
          processed_at?: string | null
          processing_attempts?: number
          received_at?: string
          source?: string
        }
        Relationships: []
      }
      supplement_doses: {
        Row: {
          animal_id: string
          animal_protocol_id: string
          confirmed_by: string
          confirmed_role: string
          created_at: string
          dosed_at_time: string | null
          dosed_on: string
          id: string
          notes: string | null
        }
        Insert: {
          animal_id: string
          animal_protocol_id: string
          confirmed_by: string
          confirmed_role: string
          created_at?: string
          dosed_at_time?: string | null
          dosed_on?: string
          id?: string
          notes?: string | null
        }
        Update: {
          animal_id?: string
          animal_protocol_id?: string
          confirmed_by?: string
          confirmed_role?: string
          created_at?: string
          dosed_at_time?: string | null
          dosed_on?: string
          id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supplement_doses_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplement_doses_animal_protocol_id_fkey"
            columns: ["animal_protocol_id"]
            isOneToOne: false
            referencedRelation: "animal_protocols"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          archived_at: string | null
          assignee_id: string | null
          body: string
          category: string
          contact_email: string | null
          created_at: string
          first_response_at: string | null
          id: string
          owner_id: string | null
          resolved_at: string | null
          source_ip: string | null
          status: string
          subject: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          archived_at?: string | null
          assignee_id?: string | null
          body: string
          category: string
          contact_email?: string | null
          created_at?: string
          first_response_at?: string | null
          id?: string
          owner_id?: string | null
          resolved_at?: string | null
          source_ip?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          archived_at?: string | null
          assignee_id?: string | null
          body?: string
          category?: string
          contact_email?: string | null
          created_at?: string
          first_response_at?: string | null
          id?: string
          owner_id?: string | null
          resolved_at?: string | null
          source_ip?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      trainer_applications: {
        Row: {
          application: Json
          created_at: string
          id: string
          status: string
          submitted_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          application?: Json
          created_at?: string
          id?: string
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          application?: Json
          created_at?: string
          id?: string
          status?: string
          submitted_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      trainer_customer_map: {
        Row: {
          adhoc_email: string | null
          created_at: string
          id: string
          owner_id: string | null
          stripe_customer_id: string
          trainer_id: string
          updated_at: string
        }
        Insert: {
          adhoc_email?: string | null
          created_at?: string
          id?: string
          owner_id?: string | null
          stripe_customer_id: string
          trainer_id: string
          updated_at?: string
        }
        Update: {
          adhoc_email?: string | null
          created_at?: string
          id?: string
          owner_id?: string | null
          stripe_customer_id?: string
          trainer_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      trainer_goals: {
        Row: {
          created_at: string
          hours_target: number | null
          id: string
          month: string
          revenue_target_cents: number | null
          trainer_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          hours_target?: number | null
          id?: string
          month: string
          revenue_target_cents?: number | null
          trainer_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          hours_target?: number | null
          id?: string
          month?: string
          revenue_target_cents?: number | null
          trainer_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      trainer_invoice_settings: {
        Row: {
          auto_finalize_day: number
          brand_hex: string | null
          created_at: string
          default_due_net_days: number
          footer_memo: string | null
          trainer_id: string
          updated_at: string
        }
        Insert: {
          auto_finalize_day?: number
          brand_hex?: string | null
          created_at?: string
          default_due_net_days?: number
          footer_memo?: string | null
          trainer_id: string
          updated_at?: string
        }
        Update: {
          auto_finalize_day?: number
          brand_hex?: string | null
          created_at?: string
          default_due_net_days?: number
          footer_memo?: string | null
          trainer_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      trainer_profiles: {
        Row: {
          application_status: string
          bio: string | null
          brand_hex: string | null
          branding_synced_at: string | null
          certifications: Json
          created_at: string
          id: string
          invoice_logo_r2_key: string | null
          invoice_logo_stripe_file_id: string | null
          invoice_logo_stripe_file_key: string | null
          invoice_timezone: string
          logo_url: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          stripe_connect_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          application_status?: string
          bio?: string | null
          brand_hex?: string | null
          branding_synced_at?: string | null
          certifications?: Json
          created_at?: string
          id?: string
          invoice_logo_r2_key?: string | null
          invoice_logo_stripe_file_id?: string | null
          invoice_logo_stripe_file_key?: string | null
          invoice_timezone?: string
          logo_url?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stripe_connect_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          application_status?: string
          bio?: string | null
          brand_hex?: string | null
          branding_synced_at?: string | null
          certifications?: Json
          created_at?: string
          id?: string
          invoice_logo_r2_key?: string | null
          invoice_logo_stripe_file_id?: string | null
          invoice_logo_stripe_file_key?: string | null
          invoice_timezone?: string
          logo_url?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          stripe_connect_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      training_sessions: {
        Row: {
          animal_id: string
          archived_at: string | null
          billable: boolean
          created_at: string
          currency: string
          duration_minutes: number
          id: string
          notes: string | null
          owner_id: string
          session_type: SessionType
          started_at: string
          status: SessionStatus
          title: string
          trainer_id: string
          trainer_price_cents: number | null
          updated_at: string
        }
        Insert: {
          animal_id: string
          archived_at?: string | null
          billable?: boolean
          created_at?: string
          currency?: string
          duration_minutes: number
          id?: string
          notes?: string | null
          owner_id: string
          session_type: SessionType
          started_at: string
          status?: SessionStatus
          title: string
          trainer_id: string
          trainer_price_cents?: number | null
          updated_at?: string
        }
        Update: {
          animal_id?: string
          archived_at?: string | null
          billable?: boolean
          created_at?: string
          currency?: string
          duration_minutes?: number
          id?: string
          notes?: string | null
          owner_id?: string
          session_type?: SessionType
          started_at?: string
          status?: SessionStatus
          title?: string
          trainer_id?: string
          trainer_price_cents?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "training_sessions_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          display_name: string
          email: string
          has_pin: boolean
          id: string
          role: UserRole
          status: UserStatus
          updated_at: string
          user_id: string
          welcome_tour_seen_at: string | null
        }
        Insert: {
          created_at?: string
          display_name: string
          email: string
          has_pin?: boolean
          id?: string
          role: UserRole
          status?: UserStatus
          updated_at?: string
          user_id: string
          welcome_tour_seen_at?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string
          email?: string
          has_pin?: boolean
          id?: string
          role?: UserRole
          status?: UserStatus
          updated_at?: string
          user_id?: string
          welcome_tour_seen_at?: string | null
        }
        Relationships: []
      }
      vet_records: {
        Row: {
          animal_id: string
          archived_at: string | null
          created_at: string
          expires_on: string | null
          id: string
          issued_on: string | null
          issuing_provider: string | null
          notes: string | null
          owner_id: string
          r2_object_id: string
          record_type: 'coggins' | 'vaccine' | 'dental' | 'farrier' | 'other'
          updated_at: string
        }
        Insert: {
          animal_id: string
          archived_at?: string | null
          created_at?: string
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuing_provider?: string | null
          notes?: string | null
          owner_id: string
          r2_object_id: string
          record_type: 'coggins' | 'vaccine' | 'dental' | 'farrier' | 'other'
          updated_at?: string
        }
        Update: {
          animal_id?: string
          archived_at?: string | null
          created_at?: string
          expires_on?: string | null
          id?: string
          issued_on?: string | null
          issuing_provider?: string | null
          notes?: string | null
          owner_id?: string
          r2_object_id?: string
          record_type?: 'coggins' | 'vaccine' | 'dental' | 'farrier' | 'other'
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "vet_records_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vet_records_r2_object_id_fkey"
            columns: ["r2_object_id"]
            isOneToOne: false
            referencedRelation: "r2_objects"
            referencedColumns: ["id"]
          },
        ]
      }
      vet_share_tokens: {
        Row: {
          animal_id: string
          archived_at: string | null
          created_at: string
          expires_at: string
          id: string
          owner_id: string
          revoked_at: string | null
          revoked_reason: string | null
          scope: Json
          token: string
          updated_at: string
          view_count: number
          viewed_at: string | null
        }
        Insert: {
          animal_id: string
          archived_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          owner_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          scope?: Json
          token: string
          updated_at?: string
          view_count?: number
          viewed_at?: string | null
        }
        Update: {
          animal_id?: string
          archived_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          owner_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          scope?: Json
          token?: string
          updated_at?: string
          view_count?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vet_share_tokens_animal_id_fkey"
            columns: ["animal_id"]
            isOneToOne: false
            referencedRelation: "animals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_my_connect_account: {
        Row: {
          charges_enabled: boolean | null
          created_at: string | null
          deactivated_at: string | null
          details_submitted: boolean | null
          disabled_reason: string | null
          id: string | null
          onboarding_link_last_issued_at: string | null
          payouts_enabled: boolean | null
          stripe_account_id: string | null
          trainer_id: string | null
          updated_at: string | null
        }
        Insert: {
          charges_enabled?: boolean | null
          created_at?: string | null
          deactivated_at?: string | null
          details_submitted?: boolean | null
          disabled_reason?: string | null
          id?: string | null
          onboarding_link_last_issued_at?: string | null
          payouts_enabled?: boolean | null
          stripe_account_id?: string | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Update: {
          charges_enabled?: boolean | null
          created_at?: string | null
          deactivated_at?: string | null
          details_submitted?: boolean | null
          disabled_reason?: string | null
          id?: string | null
          onboarding_link_last_issued_at?: string | null
          payouts_enabled?: boolean | null
          stripe_account_id?: string | null
          trainer_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_decide_trainer: {
        Args: {
          app_id: string
          decision: string
          p_review_notes?: string
          reviewer: string
        }
        Returns: Json
      }
      admin_kpi_snapshot: { Args: never; Returns: Json }
      am_i_owner_of: { Args: { animal_id: string }; Returns: boolean }
      check_has_pin: { Args: { p_email: string }; Returns: boolean }
      clear_pin: { Args: never; Returns: undefined }
      do_i_have_access_to_animal: {
        Args: { animal_id: string }
        Returns: boolean
      }
      drain_hubspot_syncs: { Args: never; Returns: number }
      effective_fee_bps: { Args: { p_trainer_id: string }; Returns: number }
      enqueue_hubspot_sync: {
        Args: { p_event_name: string; p_payload: Json }
        Returns: undefined
      }
      get_my_role: { Args: never; Returns: string }
      invoice_is_overdue: { Args: { p_invoice_id: string }; Returns: boolean }
      is_expense_owner_or_granted_trainer: {
        Args: { p_expense_id: string }
        Returns: boolean
      }
      is_silver_lining_admin: { Args: never; Returns: boolean }
      latest_connect_for: {
        Args: { p_trainer_id: string }
        Returns: {
          charges_enabled: boolean
          created_at: string
          deactivated_at: string | null
          details_submitted: boolean
          disabled_reason: string | null
          fee_override_bps: number | null
          fee_override_reason: string | null
          fee_override_set_at: string | null
          fee_override_set_by: string | null
          id: string
          onboarding_link_last_issued_at: string | null
          payouts_enabled: boolean
          stripe_account_id: string
          trainer_id: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "stripe_connect_accounts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      owner_record_count: { Args: { p_owner_id: string }; Returns: number }
      products_public_count: { Args: never; Returns: number }
      session_is_payable: { Args: { p_session_id: string }; Returns: boolean }
      set_pin: { Args: never; Returns: undefined }
      signed_url_ttl_seconds: { Args: never; Returns: number }
      trainer_month_start: {
        Args: { p_at?: string; p_trainer_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
