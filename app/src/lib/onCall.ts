import { supabase } from "./supabase";

// On-call schedule + SMS dispatch helpers (Phase 6.4).
//
// Admin-only surface. All reads/writes route through the Worker, which
// re-checks silver_lining server-side and writes an audit_log row per
// request (OAG Law 2 + §3).

export const ADMIN_ON_CALL_QUERY_KEY = ["admin", "on_call_schedule"] as const;
export const ADMIN_SMS_DISPATCHES_QUERY_KEY = ["admin", "sms_dispatches"] as const;

export type OnCallScopeFilter = "active" | "all";

export type OnCallRow = {
  id: string;
  user_id: string;
  phone_e164: string;
  starts_at: string;
  ends_at: string;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  user_display_name: string | null;
  is_current: boolean;
};

export type SmsDispatchStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered";

export type SmsDispatchRow = {
  id: string;
  ticket_id: string | null;
  to_phone: string;
  on_call_user_id: string | null;
  twilio_message_sid: string | null;
  body: string;
  status: SmsDispatchStatus;
  error_code: number | null;
  cost_cents: number | null;
  sent_at: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type CreateOnCallInput = {
  user_id: string;
  phone_e164: string;
  starts_at: string;
  ends_at: string;
  notes?: string | null;
};

async function parseError(res: Response): Promise<Error> {
  let payload: { error?: string; message?: string; detail?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  const msg =
    payload?.message || payload?.detail || payload?.error || `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error;
  return err;
}

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

export async function listOnCallSchedule(scope: OnCallScopeFilter = "active"): Promise<OnCallRow[]> {
  const res = await authed("GET", `/api/admin/on-call?scope=${encodeURIComponent(scope)}`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { rows: OnCallRow[] };
  return payload.rows;
}

export async function createOnCallEntry(input: CreateOnCallInput): Promise<OnCallRow> {
  const res = await authed("POST", "/api/admin/on-call", input);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { row: OnCallRow };
  return payload.row;
}

export async function archiveOnCallEntry(id: string): Promise<void> {
  const res = await authed("POST", `/api/admin/on-call/${encodeURIComponent(id)}/archive`);
  if (!res.ok) throw await parseError(res);
}

export async function listSmsDispatches(
  opts: { ticket_id?: string; status?: SmsDispatchStatus | "all" } = {},
): Promise<SmsDispatchRow[]> {
  const params = new URLSearchParams();
  if (opts.ticket_id) params.set("ticket_id", opts.ticket_id);
  if (opts.status && opts.status !== "all") params.set("status", opts.status);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await authed("GET", `/api/admin/sms-dispatches${suffix}`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { rows: SmsDispatchRow[] };
  return payload.rows;
}
