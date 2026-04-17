import { supabase } from "./supabase";

// Admin helpers for platform fee management. Every call goes through the
// Worker /api/admin/fees* routes (which re-check silver_lining + active
// status). We never read platform_settings or stripe_connect_accounts
// directly from the SPA — both tables are service_role-only
// (migration 00006:205, 00006:245).

export const PLATFORM_FEES_QUERY_KEY = ["platform_fees"] as const;

export type TrainerFeeOverride = {
  trainer_id: string;
  trainer_name: string;
  fee_override_bps: number;
  reason: string | null;
  set_by: string | null;
  set_at: string | null;
};

export type FeesResponse = {
  default_fee_bps: number;
  default_updated_at: string | null;
  default_updated_by: string | null;
  overrides: TrainerFeeOverride[];
};

async function authed(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  return fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function parseError(res: Response): Promise<Error> {
  let payload: { error?: string; message?: string; detail?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  const msg =
    payload?.message || payload?.detail || payload?.error || `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error;
  return err;
}

export async function getFees(): Promise<FeesResponse> {
  const res = await authed("GET", "/api/admin/fees");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as FeesResponse;
}

export async function setDefaultFee(bps: number): Promise<{ default_fee_bps: number }> {
  const res = await authed("POST", "/api/admin/fees/default", { default_fee_bps: bps });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { default_fee_bps: number };
}

export type SetTrainerOverrideInput = {
  trainer_id: string;
  /** Pass null to clear the override. */
  fee_override_bps: number | null;
  reason?: string | null;
};

export async function setTrainerOverride(
  input: SetTrainerOverrideInput,
): Promise<{ trainer_id: string; fee_override_bps: number | null; reason: string | null }> {
  const res = await authed("POST", "/api/admin/fees/trainer", input);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as {
    trainer_id: string;
    fee_override_bps: number | null;
    reason: string | null;
  };
}

export function bpsToPercent(bps: number): string {
  // 1000 bps => "10.00%". Truncate trailing zeros in the percent string
  // only when the value is an integer percent (1000 => "10%", 1050 => "10.5%").
  const pct = bps / 100;
  if (Number.isInteger(pct)) return `${pct}%`;
  return `${pct.toFixed(2).replace(/\.?0+$/, "")}%`;
}
