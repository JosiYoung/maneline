import { supabase } from "./supabase";
import type { Database } from "./database.types";

// Trainer-facing Stripe Connect helpers — mirror of the access.ts
// authedFetch pattern (app/src/lib/access.ts:77). All writes go through
// the Worker so we can hit Stripe + update stripe_connect_accounts under
// service_role. Reads go straight through the v_my_connect_account view
// (migration 00006:210, security_invoker=true — RLS narrows to the
// trainer's own row and hides fee_override_* columns).

export type ConnectAccountView =
  Database["public"]["Views"]["v_my_connect_account"]["Row"];

export type ConnectStatus = "not_started" | "in_review" | "ready" | "disabled";

export const CONNECT_QUERY_KEY = ["v_my_connect_account"] as const;

export async function getMyConnectAccount(): Promise<ConnectAccountView | null> {
  const { data, error } = await supabase
    .from("v_my_connect_account")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** Translate Stripe's boolean flags into a single UI state. */
export function connectStatusFor(
  row: Pick<
    ConnectAccountView,
    "charges_enabled" | "payouts_enabled" | "details_submitted" | "disabled_reason"
  > | null,
): ConnectStatus {
  if (!row) return "not_started";
  if (row.disabled_reason) return "disabled";
  if (row.charges_enabled && row.payouts_enabled) return "ready";
  if (row.details_submitted) return "in_review";
  return "not_started";
}

async function authedPost(path: string, body?: unknown): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  return fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export class StripeNotConfiguredError extends Error {
  constructor() {
    super(
      "Stripe isn't connected yet — Mane Line is verifying its payment processor. You can still log sessions; payouts will activate automatically when the integration goes live.",
    );
    this.name = "StripeNotConfiguredError";
  }
}

async function parseError(res: Response): Promise<Error> {
  let payload: { error?: string; message?: string } | null = null;
  try {
    payload = (await res.json()) as { error?: string; message?: string };
  } catch {
    /* fall through */
  }
  if (res.status === 501 || payload?.error === "stripe_not_configured") {
    return new StripeNotConfiguredError();
  }
  const msg = payload?.message || payload?.error || `Request failed (${res.status})`;
  const err = new Error(msg);
  (err as Error & { code?: string }).code = payload?.error;
  return err;
}

export async function startOnboarding(): Promise<{ onboarding_url: string }> {
  const res = await authedPost("/api/stripe/connect/onboard");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { onboarding_url: string };
}

export async function refreshConnectAccount(): Promise<{ account: ConnectAccountView }> {
  const res = await authedPost("/api/stripe/connect/refresh");
  if (!res.ok) throw await parseError(res);
  return (await res.json()) as { account: ConnectAccountView };
}
