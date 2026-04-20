import { supabase } from "./supabase";

// Admin Stripe subscriptions client (Phase 6.5).
//
// Admin-only surface — every read/write routes through the Worker,
// which re-checks silver_lining + audit-logs the request (OAG §2/§3).
// Stripe-mutating endpoints return 501 stripe_not_configured until
// Cedric lands the live keys; the UI surfaces that as a banner.

export const ADMIN_SUBSCRIPTIONS_QUERY_KEY = ["admin", "subscriptions"] as const;
export const ADMIN_SUBSCRIPTION_DETAIL_QUERY_KEY = ["admin", "subscription"] as const;

export type SubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export type SubscriptionTab = SubscriptionStatus | "all";

export type SubscriptionItem = {
  id: string | null;
  price_id: string | null;
  product_id: string | null;
  sku: string | null;
  quantity: number;
  unit_amount_cents: number | null;
  currency: string | null;
  interval: string | null;
};

export type SubscriptionRow = {
  id: string;
  owner_id: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  customer_id: string;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  items: SubscriptionItem[];
  last_synced_at: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SubscriptionInvoice = {
  id: string;
  number: string | null;
  status: string | null;
  amount_due: number | null;
  amount_paid: number | null;
  currency: string;
  created: string | null;
  period_start: string | null;
  period_end: string | null;
  hosted_url: string | null;
  pdf_url: string | null;
};

export type SubscriptionDetail = {
  subscription: SubscriptionRow;
  invoices: SubscriptionInvoice[] | null;
  invoices_error: string | null;
};

async function parseError(res: Response): Promise<Error> {
  let payload: { error?: string; message?: string; detail?: string; code?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  const msg =
    payload?.message ||
    payload?.detail ||
    payload?.error ||
    `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error || payload?.code;
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

export async function listAdminSubscriptions(filter: SubscriptionTab = "all"): Promise<SubscriptionRow[]> {
  const suffix = filter && filter !== "all" ? `?status=${encodeURIComponent(filter)}` : "";
  const res = await authed("GET", `/api/admin/subscriptions${suffix}`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { rows: SubscriptionRow[] };
  return payload.rows;
}

export async function getAdminSubscription(id: string): Promise<SubscriptionDetail> {
  const res = await authed("GET", `/api/admin/subscriptions/${encodeURIComponent(id)}`);
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as SubscriptionDetail;
}

export async function cancelAdminSubscription(id: string): Promise<SubscriptionRow> {
  const res = await authed("POST", `/api/admin/subscriptions/${encodeURIComponent(id)}/cancel`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { subscription: SubscriptionRow };
  return payload.subscription;
}

export async function pauseAdminSubscription(id: string, resumes_at?: string): Promise<SubscriptionRow> {
  const res = await authed(
    "POST",
    `/api/admin/subscriptions/${encodeURIComponent(id)}/pause`,
    resumes_at ? { resumes_at } : {},
  );
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { subscription: SubscriptionRow };
  return payload.subscription;
}

export async function resumeAdminSubscription(id: string): Promise<SubscriptionRow> {
  const res = await authed("POST", `/api/admin/subscriptions/${encodeURIComponent(id)}/resume`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { subscription: SubscriptionRow };
  return payload.subscription;
}
