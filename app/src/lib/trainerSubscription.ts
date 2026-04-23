import { supabase } from "./supabase";

// Phase 9 — Trainer Pro subscription client.
//
// Trainers with 1-5 distinct client horses run on the free part-time
// plan (no row in subscriptions). At 6+ horses the DB trigger blocks
// new grants with `trainer_pro_required`; the trainer must upgrade
// here to lift the cap.

export const TRAINER_SUBSCRIPTION_QUERY_KEY = ["trainer_subscription"] as const;

export interface TrainerSubscriptionRow {
  id: string;
  owner_id: string;
  role_scope: "trainer";
  tier: "free" | "trainer_pro";
  status: "active" | "trialing" | "past_due" | "cancelled" | "paused";
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface TrainerSubscriptionSnapshot {
  subscription: TrainerSubscriptionRow | null;
  horse_count: number;
  horse_limit_free: number;
  on_trainer_pro: boolean;
  stripe_configured: boolean;
}

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return `Bearer ${token}`;
}

async function workerFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: await authHeader(),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = (data as { error?: string; message?: string } | null) ?? {};
    throw new Error(err.message || err.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function getTrainerSubscription(): Promise<TrainerSubscriptionSnapshot> {
  return workerFetch<TrainerSubscriptionSnapshot>("/api/trainer/subscription", { method: "GET" });
}

export async function startTrainerProCheckout(): Promise<{ checkout_url: string; session_id: string }> {
  return workerFetch<{ checkout_url: string; session_id: string }>(
    "/api/trainer/subscription/checkout",
    { method: "POST", body: JSON.stringify({}) }
  );
}

export async function openTrainerBillingPortal(): Promise<{ portal_url: string }> {
  return workerFetch<{ portal_url: string }>(
    "/api/trainer/subscription/portal",
    { method: "POST", body: JSON.stringify({}) }
  );
}
