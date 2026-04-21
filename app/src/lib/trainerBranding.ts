import { supabase } from "./supabase";
import type { Database } from "./database.types";

// Trainer Branding + Invoice-Defaults data layer (Phase 7 PR #3).
//
// trainer_invoice_settings holds the "business in a box" defaults the
// invoice auto-finalize cron and the PDF renderer consume:
//   • default_due_net_days  — net N days added to invoice_date
//   • auto_finalize_day     — day-of-month (1..28) the monthly draft flips to open
//   • footer_memo           — appears on the PDF and Stripe-hosted page
//   • brand_hex             — header accent color (validated server-side)
//
// trainer_profiles.invoice_logo_r2_key points at the R2 object for the
// logo. Upload happens through /api/uploads/{sign,commit} with
// kind='trainer_logo' — the Worker writes the key back on commit, so
// this module only reads it here.
//
// Row is created lazily: the first upsert populates it with the
// trainer's chosen values. Until then, callers see null fields and
// must coalesce to defaults (see DEFAULT_SETTINGS below).

export type TrainerInvoiceSettings =
  Database["public"]["Tables"]["trainer_invoice_settings"]["Row"];

export interface BrandingProfile {
  invoice_logo_r2_key: string | null;
  invoice_timezone: string;
  branding_synced_at: string | null;
}

export interface BrandingSyncResult {
  ok: true;
  synced_at: string;
  logo_file_id: string | null;
  has_logo: boolean;
  has_color: boolean;
  has_name: boolean;
}

export const DEFAULT_SETTINGS = {
  default_due_net_days: 15,
  auto_finalize_day: 1,
  footer_memo: null as string | null,
  brand_hex: null as string | null,
};

export const TRAINER_BRANDING_QUERY_KEY = ["trainer", "branding"] as const;

export async function fetchTrainerBranding(trainerId: string): Promise<{
  settings: TrainerInvoiceSettings | null;
  profile: BrandingProfile | null;
}> {
  const [settingsRes, profileRes] = await Promise.all([
    supabase
      .from("trainer_invoice_settings")
      .select("*")
      .eq("trainer_id", trainerId)
      .maybeSingle(),
    supabase
      .from("trainer_profiles")
      .select("invoice_logo_r2_key, invoice_timezone, branding_synced_at")
      .eq("user_id", trainerId)
      .maybeSingle(),
  ]);

  if (settingsRes.error) throw settingsRes.error;
  if (profileRes.error) throw profileRes.error;

  return {
    settings: settingsRes.data ?? null,
    profile: profileRes.data ?? null,
  };
}

export interface InvoiceSettingsPatch {
  default_due_net_days: number;
  auto_finalize_day: number;
  footer_memo: string | null;
  brand_hex: string | null;
}

export async function upsertInvoiceSettings(
  trainerId: string,
  patch: InvoiceSettingsPatch
): Promise<TrainerInvoiceSettings> {
  const { data, error } = await supabase
    .from("trainer_invoice_settings")
    .upsert(
      {
        trainer_id: trainerId,
        default_due_net_days: patch.default_due_net_days,
        auto_finalize_day: patch.auto_finalize_day,
        footer_memo: patch.footer_memo,
        brand_hex: patch.brand_hex,
      },
      { onConflict: "trainer_id" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function syncBrandingToStripe(): Promise<BrandingSyncResult> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const res = await fetch("/api/trainer/branding/sync", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  const body = await res.json().catch(() => ({} as Record<string, unknown>));
  if (!res.ok) {
    const err = new Error(
      (body as { message?: string; error?: string }).message ||
        (body as { error?: string }).error ||
        `Sync failed (${res.status})`
    ) as Error & { code?: string };
    err.code = (body as { error?: string }).error;
    throw err;
  }
  return body as BrandingSyncResult;
}

// Brand hex comes straight from a native <input type="color"> which
// always emits lowercase "#rrggbb" — the DB check mirrors this exactly.
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!HEX_COLOR_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}
