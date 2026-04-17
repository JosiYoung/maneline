import { supabase } from "./supabase";
import type { Database, GrantScope } from "./database.types";

// Access grants data layer — the owner-facing side of §2.2 of the
// feature map ("consent model").
//
// Read path is direct supabase-js (RLS enforces owner_id = auth.uid()).
// Write paths go through the Worker so we can resolve trainer-by-email,
// enforce scope-specific ownership checks, and write audit_log in the
// same request.

export type AccessGrant = Database["public"]["Tables"]["animal_access_grants"]["Row"];

export type AccessGrantWithTrainer = AccessGrant & {
  trainer_display_name: string | null;
  trainer_email: string | null;
  animal_barn_name: string | null;
  ranch_name: string | null;
};

export type GrantStatus = "active" | "grace" | "expired";

export const ACCESS_QUERY_KEY = ["access_grants"] as const;

export async function listGrants(): Promise<AccessGrantWithTrainer[]> {
  const { data: grants, error } = await supabase
    .from("animal_access_grants")
    .select("*")
    .order("granted_at", { ascending: false });
  if (error) throw error;
  if (!grants || grants.length === 0) return [];

  const trainerIds = Array.from(new Set(grants.map((g) => g.trainer_id)));
  const animalIds  = Array.from(new Set(grants.map((g) => g.animal_id).filter(Boolean))) as string[];
  const ranchIds   = Array.from(new Set(grants.map((g) => g.ranch_id).filter(Boolean))) as string[];

  const [trainersRes, animalsRes, ranchesRes] = await Promise.all([
    trainerIds.length
      ? supabase.from("user_profiles").select("user_id,display_name,email").in("user_id", trainerIds)
      : Promise.resolve({ data: [], error: null }),
    animalIds.length
      ? supabase.from("animals").select("id,barn_name").in("id", animalIds)
      : Promise.resolve({ data: [], error: null }),
    ranchIds.length
      ? supabase.from("ranches").select("id,name").in("id", ranchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const tMap = new Map<string, { display_name: string; email: string }>();
  for (const t of trainersRes.data ?? []) tMap.set(t.user_id, { display_name: t.display_name, email: t.email });
  const aMap = new Map<string, string>();
  for (const a of animalsRes.data ?? []) aMap.set(a.id, a.barn_name);
  const rMap = new Map<string, string>();
  for (const r of ranchesRes.data ?? []) rMap.set(r.id, r.name);

  return grants.map((g) => ({
    ...g,
    trainer_display_name: tMap.get(g.trainer_id)?.display_name ?? null,
    trainer_email:        tMap.get(g.trainer_id)?.email ?? null,
    animal_barn_name:     g.animal_id ? aMap.get(g.animal_id) ?? null : null,
    ranch_name:           g.ranch_id  ? rMap.get(g.ranch_id)  ?? null : null,
  }));
}

export function statusFor(grant: Pick<AccessGrant, "revoked_at" | "grace_period_ends_at">, now = new Date()): GrantStatus {
  if (!grant.revoked_at) return "active";
  if (grant.grace_period_ends_at && new Date(grant.grace_period_ends_at) > now) return "grace";
  return "expired";
}

export function daysLeftInGrace(grant: Pick<AccessGrant, "grace_period_ends_at">, now = new Date()): number {
  if (!grant.grace_period_ends_at) return 0;
  const ms = new Date(grant.grace_period_ends_at).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

async function authedFetch(path: string, body: unknown): Promise<Response> {
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

export type GrantInput = {
  trainer_email: string;
  scope: GrantScope;
  animal_id?: string | null;
  ranch_id?: string | null;
  notes?: string | null;
};

export type GrantResult = {
  grant: AccessGrant;
  trainer: { user_id: string; display_name: string | null; email: string };
};

export async function grantAccess(input: GrantInput): Promise<GrantResult> {
  const res = await authedFetch("/api/access/grant", input);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error || `Grant failed (${res.status})`);
    (err as Error & { code?: string }).code = body?.error;
    throw err;
  }
  return (await res.json()) as GrantResult;
}

export type RevokeInput = { grant_id: string; grace_days?: number };

export async function revokeAccess(input: RevokeInput): Promise<{ grant: AccessGrant }> {
  const res = await authedFetch("/api/access/revoke", {
    grant_id:  input.grant_id,
    grace_days: input.grace_days ?? 7,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error || `Revoke failed (${res.status})`);
    (err as Error & { code?: string }).code = body?.error;
    throw err;
  }
  return (await res.json()) as { grant: AccessGrant };
}
