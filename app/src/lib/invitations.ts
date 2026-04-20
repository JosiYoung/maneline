import { supabase } from "./supabase";

// Invitations + welcome-tour client. All calls route through the Worker.
// The admin endpoints are silver_lining-gated; the claim + dismiss
// endpoints require a normal authed session.

export const INVITATIONS_QUERY_KEY = ["admin", "invitations"] as const;

export type InvitationStatus = "invited" | "activated" | "expired" | "archived";
export type InvitationRole = "owner" | "trainer";

export type InvitationRow = {
  id: string;
  email: string;
  role: InvitationRole;
  barn_name: string | null;
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
  expires_at: string;
  archived_at: string | null;
  batch: string | null;
  created_at: string;
  status: InvitationStatus;
  first_session_logged_at: string | null;
};

export type InvitationLookup = {
  email: string;
  role: InvitationRole;
  barn_name: string | null;
  expires_at: string;
};

async function authedFetch(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Response> {
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
  let payload: { error?: string; message?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  const msg = payload?.message || payload?.error || `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error;
  return err;
}

export async function listInvitations(
  statusFilter?: InvitationStatus | "",
): Promise<InvitationRow[]> {
  const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  const res = await authedFetch("GET", `/api/admin/invitations${qs}`);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { rows: InvitationRow[] };
  return body.rows ?? [];
}

export type CreateInvitationInput = {
  email: string;
  role: InvitationRole;
  barn_name?: string;
  batch?: string;
};

export async function createInvitation(input: CreateInvitationInput): Promise<InvitationRow> {
  const res = await authedFetch("POST", "/api/admin/invitations", input);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { invitation: InvitationRow };
  return body.invitation;
}

export type BulkInvitationResult = {
  batch: string;
  results: Array<{
    email: string | null;
    role?: InvitationRole;
    ok: boolean;
    id?: string;
    error?: string;
    email_sent?: boolean;
    email_skipped?: boolean;
  }>;
};

export async function createInvitationsBulk(
  rows: CreateInvitationInput[],
  batch?: string,
): Promise<BulkInvitationResult> {
  const res = await authedFetch("POST", "/api/admin/invitations/bulk", { rows, batch });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as BulkInvitationResult;
}

export async function resendInvitation(id: string): Promise<void> {
  const res = await authedFetch("POST", `/api/admin/invitations/${id}/resend`);
  if (!res.ok) throw await parseError(res);
}

export async function archiveInvitation(id: string): Promise<void> {
  const res = await authedFetch("POST", `/api/admin/invitations/${id}/archive`);
  if (!res.ok) throw await parseError(res);
}

export async function lookupInvitation(token: string): Promise<InvitationLookup> {
  const res = await fetch(`/api/invitations/lookup?token=${encodeURIComponent(token)}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as InvitationLookup;
}

export async function claimInvitation(
  token: string,
): Promise<{ ok: true; role: InvitationRole; auto_approved: boolean }> {
  const res = await authedFetch("POST", "/api/auth/claim-invite", { token });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { ok: true; role: InvitationRole; auto_approved: boolean };
}

export async function dismissWelcomeTour(): Promise<void> {
  const res = await authedFetch("POST", "/api/profiles/dismiss-welcome-tour");
  if (!res.ok) throw await parseError(res);
}

// ---------- CSV parsing for bulk upload ---------------------------------
// Accepts headers: email,role,barn_name (optional). Returns parsed rows +
// per-row errors for display in the admin UI.

export type CsvParseResult = {
  valid: CreateInvitationInput[];
  errors: Array<{ line: number; raw: string; error: string }>;
};

export function parseInvitationsCsv(text: string): CsvParseResult {
  const out: CsvParseResult = { valid: [], errors: [] };
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return out;
  const header = lines[0].toLowerCase().split(",").map((c) => c.trim());
  const emailIdx = header.indexOf("email");
  const roleIdx = header.indexOf("role");
  const barnIdx = header.indexOf("barn_name");
  if (emailIdx < 0 || roleIdx < 0) {
    out.errors.push({ line: 1, raw: lines[0], error: "missing_email_or_role_header" });
    return out;
  }
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const cols = raw.split(",").map((c) => c.trim());
    const email = (cols[emailIdx] || "").toLowerCase();
    const role = (cols[roleIdx] || "").toLowerCase();
    const barn_name = barnIdx >= 0 ? (cols[barnIdx] || "") : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      out.errors.push({ line: i + 1, raw, error: "bad_email" });
      continue;
    }
    if (role !== "owner" && role !== "trainer") {
      out.errors.push({ line: i + 1, raw, error: "bad_role" });
      continue;
    }
    out.valid.push({ email, role, barn_name: barn_name || undefined });
  }
  return out;
}
