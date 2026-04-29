import { supabase } from "./supabase";
import type { Database } from "./database.types";

// Trainer Business Dashboard data layer (Phase 7 PR #2, read-only).
//
// Pulls the rows the /trainer/business dashboard needs, then aggregates
// client-side for KPI tiles and charts. RLS already scopes everything to
// the caller's trainer_id (session_payments_trainer_select,
// training_sessions_trainer_select, expenses trainer select), so the
// queries here don't re-filter by trainer_id.
//
// Revenue source of truth: session_payments.status = 'succeeded'. That's
// the only row we count as real money collected. "Gross" is
// session_payments.amount_cents; platform fee is platform_fee_cents;
// Stripe processing fee is approximated (see STRIPE_FEE_* constants
// below) because Stripe doesn't write its fee amount back to us.
//
// Expense treatment: every trainer-recorded expense (recorder_role =
// 'trainer') counts against margin in v1, regardless of
// billable_to_owner. Once invoicing ships and reimbursements flow back,
// we'll exclude paid-back expenses here. Called out on the dashboard
// via the expenses tile copy.

type SessionPayment =
  Database["public"]["Tables"]["session_payments"]["Row"];
type TrainingSession =
  Database["public"]["Tables"]["training_sessions"]["Row"];
type Expense = Database["public"]["Tables"]["expenses"]["Row"];
type Animal = Database["public"]["Tables"]["animals"]["Row"];
type UserProfile = Database["public"]["Tables"]["user_profiles"]["Row"];
type Ranch = Database["public"]["Tables"]["ranches"]["Row"];
type Grant = Database["public"]["Tables"]["animal_access_grants"]["Row"];

export type BusinessPeriod = "last_30d" | "last_90d" | "ytd";

export interface BusinessSummary {
  periodStart: Date;
  periodEnd: Date;
  grossCents: number;
  platformFeeCents: number;
  netCents: number;
  expensesCents: number;
  netOfExpensesCents: number;
  marginPct: number | null;   // null when grossCents = 0
  hoursLogged: number;
  effectiveHourlyRateCents: number | null;
  paymentsCount: number;
  sessionsCount: number;
}

export interface MonthlyPoint {
  month: string;              // YYYY-MM
  revenue: number;            // net cents
  expenses: number;           // cents
}

export interface EntityProfit {
  key: string;                // animal_id | barn name | owner_id
  label: string;              // horse name | barn name | client name
  sublabel?: string;          // e.g., barn name under horse
  revenue: number;            // net cents
  expenses: number;           // cents
  net: number;                // revenue - expenses
}

export const BUSINESS_QUERY_KEY = ["trainer_business"] as const;

export function periodLabel(p: BusinessPeriod): string {
  switch (p) {
    case "last_30d": return "Last 30 days";
    case "last_90d": return "Last 90 days";
    case "ytd":      return "Year to date";
  }
}

export function periodRange(p: BusinessPeriod, now: Date = new Date()): {
  start: Date; end: Date;
} {
  const end = now;
  const start = new Date(now);
  switch (p) {
    case "last_30d": start.setDate(start.getDate() - 30); break;
    case "last_90d": start.setDate(start.getDate() - 90); break;
    case "ytd":      start.setMonth(0, 1); start.setHours(0, 0, 0, 0); break;
  }
  return { start, end };
}

export interface RawBusinessData {
  payments: SessionPayment[];
  sessions: TrainingSession[];
  expenses: Expense[];
  animalsById: Map<string, Animal>;
  ownersById: Map<string, UserProfile>;
  barnByAnimalId: Map<string, { name: string; ranchId: string | null }>;
}

/**
 * One fetch pulls everything the dashboard needs. All queries run in
 * parallel; the caller's RLS policies do the trainer_id scoping.
 */
export async function fetchBusinessData(
  period: BusinessPeriod
): Promise<RawBusinessData> {
  const { start, end } = periodRange(period);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const startDate = start.toISOString().slice(0, 10); // YYYY-MM-DD for date cols

  const [paymentsRes, sessionsRes, expensesRes] = await Promise.all([
    supabase
      .from("session_payments")
      .select("*")
      .eq("status", "succeeded")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabase
      .from("training_sessions")
      .select("*")
      .is("archived_at", null)
      .gte("started_at", startIso)
      .lte("started_at", endIso),
    supabase
      .from("expenses")
      .select("*")
      .is("archived_at", null)
      .eq("recorder_role", "trainer")
      .gte("occurred_on", startDate),
  ]);

  if (paymentsRes.error) throw paymentsRes.error;
  if (sessionsRes.error) throw sessionsRes.error;
  if (expensesRes.error) throw expensesRes.error;

  const payments = paymentsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];
  const expenses = expensesRes.data ?? [];

  // Resolve animals referenced by payments (via session lookup) + sessions
  // + expenses.
  const sessionIds = Array.from(new Set(payments.map((p) => p.session_id)));
  let paymentSessions: TrainingSession[] = [];
  if (sessionIds.length > 0) {
    const res = await supabase
      .from("training_sessions")
      .select("*")
      .in("id", sessionIds);
    if (res.error) throw res.error;
    paymentSessions = res.data ?? [];
  }

  const sessionById = new Map<string, TrainingSession>();
  for (const s of [...sessions, ...paymentSessions]) sessionById.set(s.id, s);

  const animalIds = new Set<string>();
  const ownerIds = new Set<string>();
  for (const s of sessionById.values()) {
    animalIds.add(s.animal_id);
    ownerIds.add(s.owner_id);
  }
  for (const e of expenses) animalIds.add(e.animal_id);

  const [animalsRes, ownersRes, grantsRes] = await Promise.all([
    animalIds.size > 0
      ? supabase
          .from("animals")
          .select("*")
          .in("id", Array.from(animalIds))
      : Promise.resolve({ data: [] as Animal[], error: null as null }),
    ownerIds.size > 0
      ? supabase
          .from("user_profiles")
          .select("*")
          .in("user_id", Array.from(ownerIds))
      : Promise.resolve({ data: [] as UserProfile[], error: null as null }),
    supabase
      .from("animal_access_grants")
      .select("*"),
  ]);

  if (animalsRes.error) throw animalsRes.error;
  if (ownersRes.error) throw ownersRes.error;
  if (grantsRes.error) throw grantsRes.error;

  const animalsById = new Map<string, Animal>();
  for (const a of animalsRes.data ?? []) animalsById.set(a.id, a);

  const ownersById = new Map<string, UserProfile>();
  for (const o of ownersRes.data ?? []) ownersById.set(o.user_id, o);

  // Barn attribution: animals don't carry ranch_id yet (tech-debt
  // flagged in migration 00004). Best-effort mapping — if the trainer
  // has a ranch-scoped grant touching this animal's owner, attribute to
  // that ranch. Fallback: "Unassigned".
  const ranchIds = new Set<string>();
  for (const g of grantsRes.data ?? []) {
    if (g.ranch_id) ranchIds.add(g.ranch_id);
  }
  let ranchesById = new Map<string, Ranch>();
  if (ranchIds.size > 0) {
    const res = await supabase
      .from("ranches")
      .select("*")
      .in("id", Array.from(ranchIds));
    if (res.error) throw res.error;
    for (const r of res.data ?? []) ranchesById.set(r.id, r);
  }

  const barnByAnimalId = new Map<string, { name: string; ranchId: string | null }>();
  const ranchByOwner = new Map<string, string>();
  for (const g of (grantsRes.data ?? []) as Grant[]) {
    if (g.scope === "ranch" && g.ranch_id && !ranchByOwner.has(g.owner_id)) {
      ranchByOwner.set(g.owner_id, g.ranch_id);
    }
  }
  for (const animal of animalsById.values()) {
    const rid = ranchByOwner.get(animal.owner_id);
    const ranch = rid ? ranchesById.get(rid) : null;
    barnByAnimalId.set(animal.id, {
      name: ranch?.name ?? "Unassigned",
      ranchId: rid ?? null,
    });
  }

  return { payments, sessions, expenses, animalsById, ownersById, barnByAnimalId };
}

// ─── KPI aggregation ─────────────────────────────────────────────

export function computeSummary(
  raw: RawBusinessData,
  period: BusinessPeriod
): BusinessSummary {
  const { start, end } = periodRange(period);

  const grossCents = raw.payments.reduce((s, p) => s + p.amount_cents, 0);
  // trainer_cut_cents is the platform fee deducted from the trainer's earnings.
  // platform_fee_cents is the full Stripe application_fee_amount (includes the
  // owner-side surcharge that covers Stripe processing) — do NOT use it here.
  const platformFeeCents = raw.payments.reduce((s, p) => s + (p.trainer_cut_cents ?? 0), 0);
  const netCents = grossCents - platformFeeCents;

  const expensesCents = raw.expenses.reduce((s, e) => s + e.amount_cents, 0);
  const netOfExpensesCents = netCents - expensesCents;

  const marginPct = grossCents === 0
    ? null
    : (netOfExpensesCents / grossCents) * 100;

  const hoursLogged = raw.sessions.reduce((s, ts) => s + ts.duration_minutes / 60, 0);
  const effectiveHourlyRateCents = hoursLogged > 0
    ? Math.round(netCents / hoursLogged)
    : null;

  return {
    periodStart: start,
    periodEnd: end,
    grossCents,
    platformFeeCents,
    netCents,
    expensesCents,
    netOfExpensesCents,
    marginPct,
    hoursLogged,
    effectiveHourlyRateCents,
    paymentsCount: raw.payments.length,
    sessionsCount: raw.sessions.length,
  };
}

// ─── Chart aggregations ──────────────────────────────────────────

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function computeMonthly(raw: RawBusinessData): MonthlyPoint[] {
  const rev = new Map<string, number>();
  const exp = new Map<string, number>();

  for (const p of raw.payments) {
    const k = monthKey(new Date(p.created_at));
    const net = p.amount_cents - (p.trainer_cut_cents ?? 0);
    rev.set(k, (rev.get(k) ?? 0) + net);
  }
  for (const e of raw.expenses) {
    const k = monthKey(new Date(e.occurred_on));
    exp.set(k, (exp.get(k) ?? 0) + e.amount_cents);
  }

  const keys = new Set<string>([...rev.keys(), ...exp.keys()]);
  return Array.from(keys)
    .sort()
    .map((k) => ({
      month: k,
      revenue: rev.get(k) ?? 0,
      expenses: exp.get(k) ?? 0,
    }));
}

/** Net revenue and expenses attributed per animal via session_id → animal_id. */
export function computeByHorse(raw: RawBusinessData, limit = 10): EntityProfit[] {
  // Build session_id → session for payment attribution
  const sessionById = new Map<string, TrainingSession>();
  for (const s of raw.sessions) sessionById.set(s.id, s);

  const revByAnimal = new Map<string, number>();
  for (const p of raw.payments) {
    const s = sessionById.get(p.session_id);
    if (!s) continue;
    const net = p.amount_cents - (p.trainer_cut_cents ?? 0);
    revByAnimal.set(s.animal_id, (revByAnimal.get(s.animal_id) ?? 0) + net);
  }

  const expByAnimal = new Map<string, number>();
  for (const e of raw.expenses) {
    expByAnimal.set(e.animal_id, (expByAnimal.get(e.animal_id) ?? 0) + e.amount_cents);
  }

  const allAnimalIds = new Set<string>([
    ...revByAnimal.keys(),
    ...expByAnimal.keys(),
  ]);

  const rows: EntityProfit[] = Array.from(allAnimalIds).map((id) => {
    const animal = raw.animalsById.get(id);
    const barn = raw.barnByAnimalId.get(id);
    const revenue = revByAnimal.get(id) ?? 0;
    const expenses = expByAnimal.get(id) ?? 0;
    return {
      key: id,
      label: animal?.barn_name ?? "Unknown horse",
      sublabel: barn?.name,
      revenue,
      expenses,
      net: revenue - expenses,
    };
  });

  rows.sort((a, b) => b.net - a.net);
  return rows.slice(0, limit);
}

export function computeByBarn(raw: RawBusinessData): EntityProfit[] {
  const sessionById = new Map<string, TrainingSession>();
  for (const s of raw.sessions) sessionById.set(s.id, s);

  const rev = new Map<string, number>();
  for (const p of raw.payments) {
    const s = sessionById.get(p.session_id);
    if (!s) continue;
    const barn = raw.barnByAnimalId.get(s.animal_id)?.name ?? "Unassigned";
    const net = p.amount_cents - (p.trainer_cut_cents ?? 0);
    rev.set(barn, (rev.get(barn) ?? 0) + net);
  }

  const exp = new Map<string, number>();
  for (const e of raw.expenses) {
    const barn = raw.barnByAnimalId.get(e.animal_id)?.name ?? "Unassigned";
    exp.set(barn, (exp.get(barn) ?? 0) + e.amount_cents);
  }

  const keys = new Set<string>([...rev.keys(), ...exp.keys()]);
  return Array.from(keys).map((barn) => {
    const revenue = rev.get(barn) ?? 0;
    const expenses = exp.get(barn) ?? 0;
    return { key: barn, label: barn, revenue, expenses, net: revenue - expenses };
  }).sort((a, b) => b.net - a.net);
}

export function computeByClient(raw: RawBusinessData, limit = 10): EntityProfit[] {
  const sessionById = new Map<string, TrainingSession>();
  for (const s of raw.sessions) sessionById.set(s.id, s);

  const rev = new Map<string, number>();
  const exp = new Map<string, number>();

  for (const p of raw.payments) {
    const s = sessionById.get(p.session_id);
    if (!s) continue;
    const net = p.amount_cents - (p.trainer_cut_cents ?? 0);
    rev.set(s.owner_id, (rev.get(s.owner_id) ?? 0) + net);
  }

  // Trainer-recorded expenses for an animal get attributed to that animal's owner.
  for (const e of raw.expenses) {
    const animal = raw.animalsById.get(e.animal_id);
    if (!animal) continue;
    exp.set(animal.owner_id, (exp.get(animal.owner_id) ?? 0) + e.amount_cents);
  }

  const ownerIds = new Set<string>([...rev.keys(), ...exp.keys()]);
  const rows: EntityProfit[] = Array.from(ownerIds).map((ownerId) => {
    const profile = raw.ownersById.get(ownerId);
    const revenue = rev.get(ownerId) ?? 0;
    const expenses = exp.get(ownerId) ?? 0;
    return {
      key: ownerId,
      label: profile?.display_name ?? profile?.email ?? "Unknown client",
      revenue,
      expenses,
      net: revenue - expenses,
    };
  });

  rows.sort((a, b) => b.net - a.net);
  return rows.slice(0, limit);
}

export function formatHours(h: number): string {
  if (h === 0) return "0 h";
  if (h < 1) return `${Math.round(h * 60)} min`;
  return `${h.toFixed(1)} h`;
}
