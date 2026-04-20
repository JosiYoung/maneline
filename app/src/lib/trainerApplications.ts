import { supabase } from "./supabase";

// Trainer vetting client. All calls route through the Worker
// /api/admin/trainer-applications* endpoints, which re-check
// silver_lining + active server-side and write audit rows.

export const TRAINER_APPLICATIONS_QUERY_KEY = ["admin", "trainer-applications"] as const;

export type TrainerApplicationStatus =
  | "submitted"
  | "approved"
  | "rejected"
  | "withdrawn"
  | "archived";

export type TrainerApplicationRow = {
  id: string;
  user_id: string;
  submitted_at: string;
  status: TrainerApplicationStatus;
  application: Record<string, unknown>;
  email: string | null;
  display_name: string | null;
  user_status: string | null;
  application_status: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
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
  let payload: { error?: string; message?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  const msg = payload?.message || payload?.error || `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error;
  return err;
}

export async function listTrainerApplications(
  statusFilter?: TrainerApplicationStatus | "",
): Promise<TrainerApplicationRow[]> {
  const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  const res = await authed("GET", `/api/admin/trainer-applications${qs}`);
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { rows: TrainerApplicationRow[] };
  return body.rows ?? [];
}

export type DecisionResult = {
  application_id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  decision: "approved" | "rejected";
  user_status: string;
  review_notes: string | null;
};

export async function decideTrainerApplication(
  id: string,
  decision: "approve" | "reject",
  reviewNotes?: string,
): Promise<DecisionResult> {
  const res = await authed("POST", `/api/admin/trainer-applications/${id}/${decision}`, {
    review_notes: reviewNotes || null,
  });
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { application: DecisionResult };
  return body.application;
}
