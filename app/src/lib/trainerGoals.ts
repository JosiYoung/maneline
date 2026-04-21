import { supabase } from "./supabase";
import type { Database } from "./database.types";

// Trainer monthly goals (Phase 7 PR #4).
//
// One row per (trainer, month). Month is the first day of the trainer's
// calendar month, resolved server-side via the trainer_month_start RPC
// so the bucket matches what the auto-finalize cron will use later.
// Either target can be null independently (trainer may care about
// hours without a revenue number or vice versa).
//
// Progress is calculated here so the GoalProgressCard stays dumb:
//   • revenue progress  = MTD gross from succeeded session_payments
//   • hours progress    = MTD sum of training_sessions.duration_minutes
//
// Using GROSS (not net-to-you) so the number lines up with what the
// trainer reports to a client — "I billed $X this month". Expenses and
// fees are tracked separately in the KPI tiles and on the main charts.

type TrainerGoal = Database["public"]["Tables"]["trainer_goals"]["Row"];

export interface GoalProgress {
  monthStart: string;           // YYYY-MM-01 in trainer tz
  goal: TrainerGoal | null;
  grossCentsMtd: number;
  hoursLoggedMtd: number;
  paymentsCount: number;
  sessionsCount: number;
}

export const GOALS_QUERY_KEY = ["trainer_goals"] as const;

/**
 * Resolve the trainer's current month-start (YYYY-MM-01) in their own
 * timezone. Delegates to the trainer_month_start() SQL helper so the
 * boundary matches everywhere else we slice by month.
 */
async function resolveCurrentMonthStart(trainerId: string): Promise<string> {
  const { data, error } = await supabase.rpc("trainer_month_start", {
    p_trainer_id: trainerId,
  });
  if (error) throw error;
  if (!data) throw new Error("trainer_month_start returned empty");
  // RPC returns a date; postgrest serializes as "YYYY-MM-DD".
  return String(data);
}

/**
 * Fetch the current month's goal + progress in one round-trip. Goal may
 * be null — the card shows an empty state until the trainer sets one.
 */
export async function fetchCurrentMonthGoalProgress(
  trainerId: string
): Promise<GoalProgress> {
  const monthStart = await resolveCurrentMonthStart(trainerId);

  // The trainer's month runs from monthStart 00:00 in their tz to the
  // first of next month 00:00 in their tz. We don't have the trainer's
  // tz on the client, so we compute a half-open UTC range using the
  // monthStart date as a floor and today (now) as the ceiling — MTD
  // only looks backwards from now, so end=now is always correct, and
  // any sessions that landed "today" in trainer tz are "today or
  // yesterday" in UTC, both of which are >= monthStart.
  const startIso = `${monthStart}T00:00:00Z`;
  const endIso = new Date().toISOString();

  const [goalRes, paymentsRes, sessionsRes] = await Promise.all([
    supabase
      .from("trainer_goals")
      .select("*")
      .eq("trainer_id", trainerId)
      .eq("month", monthStart)
      .maybeSingle(),
    supabase
      .from("session_payments")
      .select("amount_cents,created_at")
      .eq("status", "succeeded")
      .gte("created_at", startIso)
      .lte("created_at", endIso),
    supabase
      .from("training_sessions")
      .select("duration_minutes,started_at")
      .is("archived_at", null)
      .gte("started_at", startIso)
      .lte("started_at", endIso),
  ]);

  if (goalRes.error) throw goalRes.error;
  if (paymentsRes.error) throw paymentsRes.error;
  if (sessionsRes.error) throw sessionsRes.error;

  const payments = paymentsRes.data ?? [];
  const sessions = sessionsRes.data ?? [];
  const grossCentsMtd = payments.reduce((n, p) => n + (p.amount_cents || 0), 0);
  const hoursLoggedMtd = sessions.reduce(
    (n, s) => n + (s.duration_minutes || 0) / 60,
    0
  );

  return {
    monthStart,
    goal: goalRes.data ?? null,
    grossCentsMtd,
    hoursLoggedMtd,
    paymentsCount: payments.length,
    sessionsCount: sessions.length,
  };
}

export interface GoalPatch {
  revenue_target_cents: number | null;
  hours_target: number | null;
}

export async function upsertCurrentMonthGoal(
  trainerId: string,
  patch: GoalPatch
): Promise<TrainerGoal> {
  const monthStart = await resolveCurrentMonthStart(trainerId);

  const { data, error } = await supabase
    .from("trainer_goals")
    .upsert(
      {
        trainer_id: trainerId,
        month: monthStart,
        revenue_target_cents: patch.revenue_target_cents,
        hours_target: patch.hours_target,
      },
      { onConflict: "trainer_id,month" }
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** 0..1, capped at 1.0 for display. Returns null when target is null/0. */
export function progressFraction(
  actual: number,
  target: number | null
): number | null {
  if (!target || target <= 0) return null;
  return Math.max(0, Math.min(1, actual / target));
}

/** Month name + year for card header ("April 2026"). */
export function formatMonthLabel(monthStart: string): string {
  const [y, m] = monthStart.split("-").map(Number);
  const d = new Date(y, (m || 1) - 1, 1);
  return d.toLocaleString(undefined, { month: "long", year: "numeric" });
}
