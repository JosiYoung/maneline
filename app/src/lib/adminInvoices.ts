import { supabase } from "./supabase";
import type { InvoiceStatus } from "./database.types";

// Admin invoices client (Phase 7 PR #8).
//
// Read-only surface into the trainer direct-charge invoices table.
// Unlike subscriptions we don't expose mutation verbs from the admin
// panel — the trainer owns the invoice lifecycle (draft → open → paid
// / void) and mutations should be audited under the trainer's actor
// id, not the admin's. Triage here means visibility + linking out to
// the Stripe hosted page.

export const ADMIN_INVOICES_QUERY_KEY = ["admin", "invoices"] as const;

export type AdminInvoiceTab = InvoiceStatus | "all";

export interface AdminInvoiceRow {
  id: string;
  trainer_id: string;
  trainer_email: string | null;
  trainer_display_name: string | null;
  owner_id: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  adhoc_name: string | null;
  adhoc_email: string | null;
  stripe_invoice_id: string | null;
  stripe_hosted_invoice_url: string | null;
  stripe_invoice_pdf_url: string | null;
  invoice_number: string | null;
  status: InvoiceStatus;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  amount_paid_cents: number;
  platform_fee_cents: number;
  currency: string;
  sent_at: string | null;
  paid_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

async function parseError(res: Response): Promise<Error> {
  let payload: { error?: string; message?: string; code?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  const msg =
    payload?.message ||
    payload?.error ||
    `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error || payload?.code;
  return err;
}

async function authed(method: "GET", path: string): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });
}

export async function listAdminInvoices(
  filter: AdminInvoiceTab = "all"
): Promise<AdminInvoiceRow[]> {
  const suffix = filter && filter !== "all" ? `?status=${encodeURIComponent(filter)}` : "";
  const res = await authed("GET", `/api/admin/invoices${suffix}`);
  if (!res.ok) throw await parseError(res);
  const payload = (await res.json()) as { rows: AdminInvoiceRow[] };
  return payload.rows;
}
