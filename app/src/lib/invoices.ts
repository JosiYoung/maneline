import { supabase } from "./supabase";
import type { Database, InvoiceStatus, InvoiceLineKind } from "./database.types";

// Invoice Builder data layer (Phase 7 PR #5).
//
// Lifecycle owned by RLS + the Worker:
//   • Trainer inserts drafts and edits draft line items directly via
//     Supabase (RLS policy invoices_trainer_insert / invoices_trainer_update_draft).
//   • Finalize/send/void go through /api/invoices/* in the Worker with
//     service_role so Stripe + our row stay in sync.
//
// Line items denormalize description + amount — historical invoices
// don't mutate when the source session/expense/recurring row changes.

export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
export type InvoiceLineItem =
  Database["public"]["Tables"]["invoice_line_items"]["Row"];
export type InvoiceLineInsert =
  Database["public"]["Tables"]["invoice_line_items"]["Insert"];

export const INVOICES_QUERY_KEY = ["trainer_invoices"] as const;
export const INVOICE_DETAIL_QUERY_KEY = (id: string) =>
  ["trainer_invoice", id] as const;
export const BILLABLE_SOURCES_QUERY_KEY = (
  ownerId: string,
  periodStart: string,
  periodEnd: string
) => ["invoice_billable_sources", ownerId, periodStart, periodEnd] as const;

export type InvoiceListFilter = "all" | InvoiceStatus;

export async function listInvoices(
  trainerId: string,
  filter: InvoiceListFilter = "all"
): Promise<Invoice[]> {
  let q = supabase
    .from("invoices")
    .select("*")
    .eq("trainer_id", trainerId)
    .order("created_at", { ascending: false });
  if (filter !== "all") q = q.eq("status", filter);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchInvoice(id: string): Promise<{
  invoice: Invoice;
  lines: InvoiceLineItem[];
}> {
  const [invRes, linesRes] = await Promise.all([
    supabase.from("invoices").select("*").eq("id", id).single(),
    supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", id)
      .order("sort_order", { ascending: true }),
  ]);
  if (invRes.error) throw invRes.error;
  if (linesRes.error) throw linesRes.error;
  return { invoice: invRes.data, lines: linesRes.data ?? [] };
}

export interface CreateDraftInput {
  trainerId: string;
  ownerId: string | null;
  adhocName: string | null;
  adhocEmail: string | null;
  dueDate: string;            // YYYY-MM-DD
  periodStart: string | null; // YYYY-MM-DD
  periodEnd: string | null;   // YYYY-MM-DD
  notes: string | null;
}

export async function createDraftInvoice(input: CreateDraftInput): Promise<Invoice> {
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      trainer_id: input.trainerId,
      owner_id: input.ownerId,
      adhoc_name: input.adhocName,
      adhoc_email: input.adhocEmail,
      status: "draft",
      due_date: input.dueDate,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      notes: input.notes,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateDraftInvoice(
  id: string,
  patch: Partial<Pick<Invoice, "due_date" | "period_start" | "period_end" | "notes">>
): Promise<Invoice> {
  const { data, error } = await supabase
    .from("invoices")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// Line item helpers ---------------------------------------------------

export function computeLineAmountCents(
  quantity: number,
  unitAmountCents: number,
  taxRateBps: number
): number {
  const subtotal = Math.round(quantity * unitAmountCents);
  const tax = Math.round((subtotal * taxRateBps) / 10000);
  return subtotal + tax;
}

export interface AddLineInput {
  invoiceId: string;
  kind: InvoiceLineKind;
  sourceId: string | null;
  description: string;
  quantity: number;
  unitAmountCents: number;
  taxRateBps: number;
  sortOrder: number;
}

export async function addLineItem(input: AddLineInput): Promise<InvoiceLineItem> {
  const amountCents = computeLineAmountCents(
    input.quantity,
    input.unitAmountCents,
    input.taxRateBps
  );
  const { data, error } = await supabase
    .from("invoice_line_items")
    .insert({
      invoice_id: input.invoiceId,
      kind: input.kind,
      source_id: input.sourceId,
      description: input.description,
      quantity: input.quantity,
      unit_amount_cents: input.unitAmountCents,
      tax_rate_bps: input.taxRateBps,
      amount_cents: amountCents,
      sort_order: input.sortOrder,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function removeLineItem(id: string): Promise<void> {
  const { error } = await supabase
    .from("invoice_line_items")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Recomputes subtotal / tax / total on the draft invoice from its line
// items. Trainer writes are scoped to drafts via RLS, so this is safe
// to run from the SPA — a finalized invoice would be rejected.
export async function recomputeDraftTotals(invoiceId: string): Promise<Invoice> {
  const { data: lines, error } = await supabase
    .from("invoice_line_items")
    .select("quantity,unit_amount_cents,tax_rate_bps")
    .eq("invoice_id", invoiceId);
  if (error) throw error;

  let subtotal = 0;
  let tax = 0;
  for (const line of lines ?? []) {
    const sub = Math.round(Number(line.quantity) * line.unit_amount_cents);
    const t = Math.round((sub * line.tax_rate_bps) / 10000);
    subtotal += sub;
    tax += t;
  }

  const upd = await supabase
    .from("invoices")
    .update({
      subtotal_cents: subtotal,
      tax_cents: tax,
      total_cents: subtotal + tax,
    })
    .eq("id", invoiceId)
    .select("*")
    .single();
  if (upd.error) throw upd.error;
  return upd.data;
}

// Billable sources for the "Import from…" chooser ---------------------

export interface BillableSession {
  id: string;
  started_at: string;
  duration_minutes: number | null;
  trainer_price_cents: number | null;
  title: string | null;
  animal_id: string | null;
  animal_barn_name: string | null;
}

export interface BillableExpense {
  id: string;
  occurred_on: string;
  description: string;
  amount_cents: number;
  markup_bps: number;
  tax_rate_bps: number;
  category: string | null;
}

export interface RecurringTemplate {
  id: string;
  description: string;
  amount_cents: number;
  animal_id: string | null;
}

export interface BillableSources {
  sessions: BillableSession[];
  expenses: BillableExpense[];
  recurring: RecurringTemplate[];
}

export async function fetchBillableSources(
  trainerId: string,
  ownerId: string | null,
  adhocEmail: string | null,
  periodStart: string | null,
  periodEnd: string | null
): Promise<BillableSources> {
  // Only owner-scoped invoices can auto-prefill from sessions/expenses
  // since those rows are tied to owner-held animals. Adhoc invoices
  // start with a blank slate (custom lines only).
  if (!ownerId) {
    const recurringRes = adhocEmail
      ? await supabase
          .from("recurring_line_items")
          .select("id,description,amount_cents,animal_id")
          .eq("trainer_id", trainerId)
          .eq("active", true)
          .ilike("adhoc_email", adhocEmail)
      : { data: [], error: null };
    if (recurringRes.error) throw recurringRes.error;
    return {
      sessions: [],
      expenses: [],
      recurring: recurringRes.data ?? [],
    };
  }

  // Animal IDs the owner actually owns — used to scope sessions/expenses
  // so we don't accidentally bill another owner's work.
  const animalsRes = await supabase
    .from("animals")
    .select("id,barn_name")
    .eq("owner_id", ownerId);
  if (animalsRes.error) throw animalsRes.error;
  const animalIds = (animalsRes.data ?? []).map((a) => a.id);
  const animalNameById = new Map(
    (animalsRes.data ?? []).map((a) => [a.id, a.barn_name as string])
  );

  if (animalIds.length === 0) {
    return { sessions: [], expenses: [], recurring: [] };
  }

  // Already-invoiced source_ids for this trainer — filter out so we
  // don't double-bill. We scope to this trainer's invoices only; a
  // different trainer billing a shared horse is not our concern.
  const priorLinesRes = await supabase
    .from("invoice_line_items")
    .select("source_id,kind,invoice_id,invoices!inner(trainer_id,status)")
    .in("kind", ["session", "expense"])
    .eq("invoices.trainer_id", trainerId)
    .neq("invoices.status", "void");
  if (priorLinesRes.error) throw priorLinesRes.error;
  const alreadyBilled = new Set(
    (priorLinesRes.data ?? [])
      .map((l) => (l as { source_id: string | null }).source_id)
      .filter(Boolean) as string[]
  );

  const sessionsQ = supabase
    .from("training_sessions")
    .select(
      "id,started_at,duration_minutes,trainer_price_cents,title,animal_id"
    )
    .eq("trainer_id", trainerId)
    .eq("billable", true)
    .is("archived_at", null)
    .in("animal_id", animalIds);
  if (periodStart) sessionsQ.gte("started_at", periodStart);
  if (periodEnd)   sessionsQ.lte("started_at", periodEnd + "T23:59:59Z");

  const expensesQ = supabase
    .from("expenses")
    .select(
      "id,occurred_on,notes,vendor,amount_cents,markup_bps,tax_rate_bps,category,animal_id"
    )
    .eq("recorder_id", trainerId)
    .eq("billable_to_owner", true)
    .is("archived_at", null)
    .in("animal_id", animalIds);
  if (periodStart) expensesQ.gte("occurred_on", periodStart);
  if (periodEnd)   expensesQ.lte("occurred_on", periodEnd);

  const [sessionsRes, expensesRes, recurringRes] = await Promise.all([
    sessionsQ,
    expensesQ,
    supabase
      .from("recurring_line_items")
      .select("id,description,amount_cents,animal_id")
      .eq("trainer_id", trainerId)
      .eq("active", true)
      .eq("owner_id", ownerId),
  ]);

  if (sessionsRes.error)  throw sessionsRes.error;
  if (expensesRes.error)  throw expensesRes.error;
  if (recurringRes.error) throw recurringRes.error;

  const sessions: BillableSession[] = (sessionsRes.data ?? [])
    .filter((s) => !alreadyBilled.has(s.id))
    .filter((s) => (s.trainer_price_cents ?? 0) > 0)
    .map((s) => ({
      id: s.id,
      started_at: s.started_at,
      duration_minutes: s.duration_minutes,
      trainer_price_cents: s.trainer_price_cents,
      title: s.title,
      animal_id: s.animal_id,
      animal_barn_name: s.animal_id ? animalNameById.get(s.animal_id) ?? null : null,
    }));

  const expenses: BillableExpense[] = (expensesRes.data ?? [])
    .filter((e) => !alreadyBilled.has(e.id))
    .map((e) => ({
      id: e.id,
      occurred_on: e.occurred_on,
      description: e.notes ?? e.vendor ?? e.category ?? "Expense",
      amount_cents: e.amount_cents,
      markup_bps: e.markup_bps,
      tax_rate_bps: e.tax_rate_bps,
      category: e.category,
    }));

  return {
    sessions,
    expenses,
    recurring: recurringRes.data ?? [],
  };
}

// Worker calls -------------------------------------------------------

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return `Bearer ${token}`;
}

async function postWorker<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: await getAuthHeader(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = (data as { error?: string; message?: string } | null) ?? {};
    const msg = err.message || err.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

export function finalizeInvoice(invoiceId: string) {
  return postWorker<{ ok: true; invoice: Invoice }>(
    "/api/invoices/finalize",
    { invoice_id: invoiceId }
  );
}

export function sendInvoice(invoiceId: string) {
  return postWorker<{ ok: true; invoice: Invoice }>(
    "/api/invoices/send",
    { invoice_id: invoiceId }
  );
}

export function voidInvoice(invoiceId: string) {
  return postWorker<{ ok: true; invoice: Invoice }>(
    "/api/invoices/void",
    { invoice_id: invoiceId }
  );
}

// Display helpers ----------------------------------------------------

export function formatInvoiceStatus(status: InvoiceStatus): string {
  switch (status) {
    case "draft":         return "Draft";
    case "open":          return "Open";
    case "paid":          return "Paid";
    case "void":          return "Void";
    case "uncollectible": return "Uncollectible";
  }
}

export function invoiceStatusTone(
  status: InvoiceStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "paid":          return "default";
    case "open":          return "secondary";
    case "draft":         return "outline";
    case "void":          return "destructive";
    case "uncollectible": return "destructive";
  }
}

export function subjectLabel(invoice: Invoice): string {
  if (invoice.adhoc_name) return invoice.adhoc_name;
  return "Client";
}

// Convenience: tomorrow + netDays, YYYY-MM-DD in trainer's local tz.
export function defaultDueDate(netDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, netDays));
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
