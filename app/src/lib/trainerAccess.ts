import { supabase } from "./supabase";
import type { AccessGrant, GrantStatus } from "./access";
import { statusFor } from "./access";

// Trainer-facing inverse of lib/access.ts:listGrants.
//
// RLS does the filtering — grants_trainer_select (migration 00002:394)
// restricts SELECTs to trainer_id = auth.uid(). Owner-name resolution
// goes through user_profiles_select_granted_owner (migration 00007),
// which only exposes owners the trainer holds an active-or-grace grant
// on. `animals_access_select` + `ranches_trainer_select` gate the other
// joined rows the same way.

export type ClientGrant = AccessGrant & {
  owner_display_name: string | null;
  owner_email: string | null;
  animal_barn_name: string | null;
  animal_species: string | null;
  ranch_name: string | null;
};

export const TRAINER_CLIENTS_QUERY_KEY = ["trainer_clients"] as const;

/**
 * All active-or-grace grants where the current user is the trainer.
 * Expired rows (revoked + past-grace) are filtered out in the UI layer
 * rather than the DB so a future "Expired history" tab can reuse this
 * query without duplicating the join work.
 */
export async function listClientGrants(): Promise<ClientGrant[]> {
  const { data: grants, error } = await supabase
    .from("animal_access_grants")
    .select("*")
    .order("granted_at", { ascending: false });
  if (error) throw error;
  if (!grants || grants.length === 0) return [];

  const ownerIds  = Array.from(new Set(grants.map((g) => g.owner_id)));
  const animalIds = Array.from(
    new Set(grants.map((g) => g.animal_id).filter(Boolean))
  ) as string[];
  const ranchIds = Array.from(
    new Set(grants.map((g) => g.ranch_id).filter(Boolean))
  ) as string[];

  const [ownersRes, animalsRes, ranchesRes] = await Promise.all([
    ownerIds.length
      ? supabase
          .from("user_profiles")
          .select("user_id,display_name,email")
          .in("user_id", ownerIds)
      : Promise.resolve({ data: [], error: null }),
    animalIds.length
      ? supabase
          .from("animals")
          .select("id,barn_name,species")
          .in("id", animalIds)
      : Promise.resolve({ data: [], error: null }),
    ranchIds.length
      ? supabase.from("ranches").select("id,name").in("id", ranchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const oMap = new Map<string, { display_name: string; email: string }>();
  for (const o of ownersRes.data ?? []) {
    oMap.set(o.user_id, { display_name: o.display_name, email: o.email });
  }
  const aMap = new Map<string, { barn_name: string; species: string }>();
  for (const a of animalsRes.data ?? []) {
    aMap.set(a.id, { barn_name: a.barn_name, species: a.species });
  }
  const rMap = new Map<string, string>();
  for (const r of ranchesRes.data ?? []) rMap.set(r.id, r.name);

  return grants.map((g) => ({
    ...g,
    owner_display_name: oMap.get(g.owner_id)?.display_name ?? null,
    owner_email:        oMap.get(g.owner_id)?.email ?? null,
    animal_barn_name:   g.animal_id ? aMap.get(g.animal_id)?.barn_name ?? null : null,
    animal_species:     g.animal_id ? aMap.get(g.animal_id)?.species ?? null : null,
    ranch_name:         g.ranch_id  ? rMap.get(g.ranch_id)  ?? null : null,
  }));
}

/** Drop expired grants so the roster only shows actionable clients. */
export function activeOrGrace(
  rows: ClientGrant[],
  now = new Date()
): ClientGrant[] {
  return rows.filter((g) => statusFor(g, now) !== "expired");
}

export type { GrantStatus };
