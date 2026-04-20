import { supabase } from "./supabase";

// Support-ticket helpers for Phase 5.4. The public submit path goes to
// /api/support-tickets (auth optional; anon limited to bug +
// feature_request categories). Admin list/claim/resolve all go through
// /api/admin/support-tickets which re-checks silver_lining server-side
// and writes an audit_log row per read/write.

export const ADMIN_SUPPORT_TICKETS_QUERY_KEY = ["admin", "support_tickets"] as const;

export type SupportCategory =
  | "account"
  | "billing"
  | "bug"
  | "feature_request"
  | "emergency_followup";

export type SupportStatus = "open" | "claimed" | "resolved" | "archived";

export const SUPPORT_CATEGORY_LABEL: Record<SupportCategory, string> = {
  account: "Account",
  billing: "Billing",
  bug: "Bug report",
  feature_request: "Feature request",
  emergency_followup: "Emergency follow-up",
};

export type SubmitSupportTicketInput = {
  category: SupportCategory;
  subject: string;
  body: string;
  contact_email?: string | null;
};

export type SupportTicketCreated = {
  id: string;
  status: SupportStatus;
  created_at: string;
};

export type AdminSupportTicketRow = {
  id: string;
  owner_id: string | null;
  contact_email: string | null;
  category: SupportCategory;
  subject: string;
  body: string;
  status: SupportStatus;
  assignee_id: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  owner_email: string | null;
  owner_display_name: string | null;
  assignee_email: string | null;
  assignee_display_name: string | null;
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

// Public submit — attaches the session JWT when signed in. Anon posts
// go through with no Authorization header.
export async function submitSupportTicket(
  input: SubmitSupportTicketInput,
): Promise<SupportTicketCreated> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch("/api/support-tickets", {
    method: "POST",
    headers,
    body: JSON.stringify({
      category: input.category,
      subject: input.subject,
      body: input.body,
      contact_email: input.contact_email || null,
    }),
  });
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { ticket: SupportTicketCreated };
  return payload.ticket;
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

export async function listAdminSupportTickets(
  status?: SupportStatus | "all",
): Promise<AdminSupportTicketRow[]> {
  const suffix = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  const res = await authed("GET", `/api/admin/support-tickets${suffix}`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { rows: AdminSupportTicketRow[] };
  return payload.rows;
}

export async function claimSupportTicket(id: string): Promise<AdminSupportTicketRow> {
  const res = await authed("POST", `/api/admin/support-tickets/${encodeURIComponent(id)}/claim`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { ticket: AdminSupportTicketRow };
  return payload.ticket;
}

export async function resolveSupportTicket(id: string): Promise<AdminSupportTicketRow> {
  const res = await authed("POST", `/api/admin/support-tickets/${encodeURIComponent(id)}/resolve`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { ticket: AdminSupportTicketRow };
  return payload.ticket;
}
