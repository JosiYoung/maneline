import { supabase } from "./supabase";

// Admin helpers for Phase 5 surfaces. Every call goes through the Worker
// /api/admin/* routes which re-check silver_lining + active status
// server-side and write an audit_log row per read.

export const ADMIN_KPIS_QUERY_KEY = ["admin", "kpis"] as const;
export const ADMIN_USERS_QUERY_KEY = ["admin", "users"] as const;

export type AdminKpis = {
  wau: number;
  mau: number;
  gmv_30d_cents: number;
  attach_rate_30d: number;
  as_of: string;
};

export type AdminUserRow = {
  user_id: string;
  role: "owner" | "trainer" | "silver_lining";
  status: "active" | "pending_review" | "suspended" | "archived";
  display_name: string;
  email: string;
  created_at: string;
};

export type AdminUsersResponse = {
  rows: AdminUserRow[];
  total: number;
  page: number;
  limit: number;
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

export async function getAdminKpis(): Promise<AdminKpis> {
  const res = await authed("GET", "/api/admin/kpis");
  if (!res.ok) throw await parseError(res);
  const body = (await res.json()) as { kpis: AdminKpis };
  return body.kpis;
}

export type AdminUsersQuery = {
  q?: string;
  role?: "owner" | "trainer" | "silver_lining" | "";
  page?: number;
};

export async function searchAdminUsers(
  query: AdminUsersQuery = {},
): Promise<AdminUsersResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.role) params.set("role", query.role);
  if (typeof query.page === "number") params.set("page", String(query.page));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const res = await authed("GET", `/api/admin/users${suffix}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as AdminUsersResponse;
}

// Streams the CSV, triggers a browser download. Returns the row count so
// callers can toast it.
export async function downloadAdminUsersCsv(): Promise<void> {
  const res = await authed("GET", "/api/admin/users.csv");
  if (!res.ok) throw await parseError(res);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = "users.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(dollars);
}

export function formatPercent(fraction: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(fraction);
}
