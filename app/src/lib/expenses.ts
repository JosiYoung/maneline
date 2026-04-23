import { supabase } from "./supabase";

// Expense data layer (Phase 3.7).
//
// Reads are direct supabase-js. RLS enforces scoping per migration 00009:
//   - owner SELECT: owns the animal (expenses_owner_select, 00009:240)
//   - trainer SELECT: has active grant (expenses_trainer_select, 00009:251)
// Writes:
//   - createExpense / updateExpense: direct INSERT/UPDATE; RLS confirms
//     recorder_role + recorder_id = auth.uid() and the ownership /
//     trainer-grant checks on the animal (00009:257-308).
//   - archiveExpense: Worker POST /api/expenses/archive so we can write
//     expense_archive_events atomically (audit table is service_role only).
//     Mirrors the Phase 2.5 session archive pattern.

export const EXPENSE_CATEGORIES = [
  "feed",
  "tack",
  "vet",
  "board",
  "farrier",
  "supplement",
  "travel",
  "show",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const EXPENSE_CATEGORY_OPTIONS: {
  value: ExpenseCategory;
  label: string;
}[] = [
  { value: "feed",       label: "Feed" },
  { value: "tack",       label: "Tack" },
  { value: "vet",        label: "Vet" },
  { value: "board",      label: "Board" },
  { value: "farrier",    label: "Farrier" },
  { value: "supplement", label: "Supplement" },
  { value: "travel",     label: "Travel" },
  { value: "show",       label: "Show" },
  { value: "other",      label: "Other" },
];

export function expenseCategoryLabel(c: ExpenseCategory): string {
  return EXPENSE_CATEGORY_OPTIONS.find((o) => o.value === c)?.label ?? c;
}

export type ExpenseRecorderRole = "owner" | "trainer";

export interface Expense {
  id: string;
  animal_id: string;
  recorder_id: string;
  recorder_role: ExpenseRecorderRole;
  category: ExpenseCategory;
  occurred_on: string; // YYYY-MM-DD
  amount_cents: number;
  currency: string;
  vendor: string | null;
  notes: string | null;
  order_id: string | null;
  product_id: string | null;
  receipt_r2_object_id: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ExpenseWithContext extends Expense {
  animal_barn_name: string | null;
  recorder_display_name: string | null;
}

export const EXPENSES_QUERY_KEY = ["expenses"] as const;

function orderedSelect(
  includeArchived: boolean,
  animalIdFilter?: string,
) {
  let q = supabase
    .from("expenses")
    .select("*")
    .order("occurred_on", { ascending: false });
  if (animalIdFilter) q = q.eq("animal_id", animalIdFilter);
  if (!includeArchived) q = q.is("archived_at", null);
  return q;
}

/** Expenses for a single animal, newest first. RLS scopes by caller role. */
export async function listExpensesForAnimal(
  animalId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<ExpenseWithContext[]> {
  const { data, error } = await orderedSelect(includeArchived, animalId);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  return decorate(data as Expense[]);
}

/**
 * Every expense the caller can see — trainer's "all expenses across
 * my animals" view. RLS does the per-animal filtering for both roles,
 * so no extra `eq` is needed here.
 */
export async function listMyExpenses(
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<ExpenseWithContext[]> {
  const { data, error } = await orderedSelect(includeArchived);
  if (error) throw error;
  if (!data || data.length === 0) return [];
  return decorate(data as Expense[]);
}

export type CreateExpenseInput = {
  animal_id: string;
  category: ExpenseCategory;
  occurred_on: string; // YYYY-MM-DD
  amount_cents: number;
  vendor?: string | null;
  notes?: string | null;
  product_id?: string | null;
  order_id?: string | null;
  receipt_r2_object_id?: string | null;
  session_id?: string | null;
};

/**
 * Insert an expense. Caller's role is derived from their Supabase profile
 * (passed in) so the RLS `recorder_role` check lines up on the first try.
 */
export async function createExpense(
  input: CreateExpenseInput,
  recorderRole: ExpenseRecorderRole,
): Promise<Expense> {
  const { data: sess } = await supabase.auth.getSession();
  const recorderId = sess.session?.user?.id;
  if (!recorderId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("expenses")
    .insert({
      animal_id:     input.animal_id,
      recorder_id:   recorderId,
      recorder_role: recorderRole,
      category:      input.category,
      occurred_on:   input.occurred_on,
      amount_cents:  input.amount_cents,
      vendor:        input.vendor ?? null,
      notes:         input.notes ?? null,
      product_id:    input.product_id ?? null,
      order_id:      input.order_id ?? null,
      receipt_r2_object_id: input.receipt_r2_object_id ?? null,
      session_id:           input.session_id ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Expense;
}

/** Expenses tied to a specific training session, newest first. */
export async function listExpensesForSession(
  sessionId: string,
): Promise<ExpenseWithContext[]> {
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("session_id", sessionId)
    .is("archived_at", null)
    .order("occurred_on", { ascending: false });
  if (error) throw error;
  if (!data || data.length === 0) return [];
  return decorate(data as Expense[]);
}

export type UpdateExpenseInput = {
  id: string;
  category?: ExpenseCategory;
  occurred_on?: string;
  amount_cents?: number;
  vendor?: string | null;
  notes?: string | null;
};

export async function updateExpense(
  input: UpdateExpenseInput,
): Promise<Expense> {
  const patch: Partial<Expense> = {};
  if (input.category !== undefined)     patch.category = input.category;
  if (input.occurred_on !== undefined)  patch.occurred_on = input.occurred_on;
  if (input.amount_cents !== undefined) patch.amount_cents = input.amount_cents;
  if (input.vendor !== undefined)       patch.vendor = input.vendor;
  if (input.notes !== undefined)        patch.notes = input.notes;

  const { data, error } = await supabase
    .from("expenses")
    .update(patch)
    .eq("id", input.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Expense;
}

export type ArchiveExpenseInput = {
  expense_id: string;
  reason: string;
};

export async function archiveExpense(
  input: ArchiveExpenseInput,
): Promise<Expense> {
  const res = await authedPost("/api/expenses/archive", {
    expense_id: input.expense_id,
    reason:     input.reason,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error || `Archive failed (${res.status})`);
    (err as Error & { code?: string }).code = body?.error;
    throw err;
  }
  const body = (await res.json()) as { expense: Expense };
  return body.expense;
}

async function authedPost(path: string, body: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Decorate rows with animal barn_name + recorder display_name. Both are
 * pulled via secondary selects; RLS for animals/user_profiles already
 * allows the caller to see their own counterparties.
 */
async function decorate(rows: Expense[]): Promise<ExpenseWithContext[]> {
  const animalIds  = Array.from(new Set(rows.map((r) => r.animal_id)));
  const recorderIds = Array.from(new Set(rows.map((r) => r.recorder_id)));

  const [animalsRes, usersRes] = await Promise.all([
    animalIds.length
      ? supabase.from("animals").select("id,barn_name").in("id", animalIds)
      : Promise.resolve({
          data: [] as { id: string; barn_name: string }[],
          error: null,
        }),
    recorderIds.length
      ? supabase
          .from("user_profiles")
          .select("user_id,display_name")
          .in("user_id", recorderIds)
      : Promise.resolve({
          data: [] as { user_id: string; display_name: string }[],
          error: null,
        }),
  ]);

  const aMap = new Map<string, string>();
  for (const a of animalsRes.data ?? []) aMap.set(a.id, a.barn_name);
  const uMap = new Map<string, string>();
  for (const u of usersRes.data ?? []) uMap.set(u.user_id, u.display_name);

  return rows.map((r) => ({
    ...r,
    animal_barn_name:      aMap.get(r.animal_id) ?? null,
    recorder_display_name: uMap.get(r.recorder_id) ?? null,
  }));
}

export function formatCentsUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "usd",
  }).format(cents / 100);
}

/** Parse a user-entered "$12.34" / "12.34" / "12" into integer cents. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (cleaned === "") return null;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return null;
  if (num < 0) return null;
  // Round to 2dp in dollars then to integer cents.
  return Math.round(num * 100);
}

export function todayIsoDate(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
