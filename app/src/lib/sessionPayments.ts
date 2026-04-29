import { supabase } from "./supabase";
import type { Database } from "./database.types";
import type { TrainingSession } from "./sessions";

// Owner-side session payment helpers. All mutating calls route through
// the Worker; the browser never talks to Stripe's REST API directly.
// Reads of session_payments go through supabase-js and are RLS-scoped
// to payer_id = auth.uid().

export type SessionPayment =
  Database["public"]["Tables"]["session_payments"]["Row"];

export const SESSION_PAYMENTS_QUERY_KEY = ["session_payments"] as const;

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

async function parseError(res: Response): Promise<Error> {
  let payload: { error?: string; message?: string } | null = null;
  try { payload = await res.json(); } catch { /* ignore */ }
  const msg = payload?.message || payload?.error || `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error;
  return err;
}

export async function approveSession(
  sessionId: string,
): Promise<{ session: TrainingSession }> {
  const res = await authedPost("/api/sessions/approve", { session_id: sessionId });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { session: TrainingSession };
}

export type StartPaymentResult =
  | {
      status: "pending";
      client_secret: string;
      payment_intent_id: string;
      amount_cents?: number;
      platform_fee_cents?: number;
      gross_amount_cents?: number;
      owner_surcharge_cents?: number;
      trainer_cut_cents?: number;
    }
  | {
      status: "processing" | "succeeded";
      payment_intent_id: string | null;
      amount_cents?: number;
      platform_fee_cents?: number;
      gross_amount_cents?: number;
      owner_surcharge_cents?: number;
      trainer_cut_cents?: number;
    }
  | {
      status: "awaiting_trainer_setup";
      amount_cents: number;
      platform_fee_cents: number;
      gross_amount_cents?: number;
      owner_surcharge_cents?: number;
      trainer_cut_cents?: number;
    };

export async function startPayment(sessionId: string): Promise<StartPaymentResult> {
  const res = await authedPost("/api/stripe/sessions/pay", {
    session_id: sessionId,
  });
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as StartPaymentResult;
}

/** Owner reads the session_payments row for their session (RLS-scoped). */
export async function getPaymentForSession(
  sessionId: string,
): Promise<SessionPayment | null> {
  const { data, error } = await supabase
    .from("session_payments")
    .select("*")
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}
