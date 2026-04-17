import { supabase } from "./supabase";
import type { Database } from "./database.types";

// Trainer-scoped animal reads. RLS does the access enforcement:
//   - animals.animals_access_select (migration 00002) — SELECT allowed
//     iff public.do_i_have_access_to_animal(id) returns true (owner,
//     admin, or trainer with active-or-grace grant).
//   - vet_records.vet_records_trainer_select (migration 00005:179) —
//     SELECT gated by the same helper.
//   - animal_media.animal_media_trainer_select (migration 00005:215) —
//     SELECT gated by the same helper.
//
// We deliberately don't short-circuit on the grant row before the query:
// RLS is authoritative. A missing animal (no row returned) is rendered
// as a 404 in the UI layer so trainers can't probe for existence.

export type Animal = Database["public"]["Tables"]["animals"]["Row"];
export type VetRecord = Database["public"]["Tables"]["vet_records"]["Row"];
export type AnimalMedia = Database["public"]["Tables"]["animal_media"]["Row"];

export type TrainerVetRecord = VetRecord & { object_key: string | null };
export type TrainerAnimalMedia = AnimalMedia & { object_key: string | null };

export const TRAINER_ANIMAL_QUERY_KEY = ["trainer_animal"] as const;
export const TRAINER_ANIMAL_RECORDS_QUERY_KEY = ["trainer_animal_records"] as const;
export const TRAINER_ANIMAL_MEDIA_QUERY_KEY = ["trainer_animal_media"] as const;

/**
 * Fetch a single animal the trainer has access to. Throws with a 404-ish
 * message if RLS drops the row — callers render this as "not found".
 */
export async function getAnimalForTrainer(id: string): Promise<Animal> {
  const { data, error } = await supabase
    .from("animals")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Animal not found or access has been revoked.");
  return data;
}

/** Active vet records for a trainer-accessible animal, joined with object_key. */
export async function listVetRecordsForTrainer(
  animalId: string
): Promise<TrainerVetRecord[]> {
  const { data: records, error } = await supabase
    .from("vet_records")
    .select("*")
    .eq("animal_id", animalId)
    .is("archived_at", null)
    .order("issued_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!records || records.length === 0) return [];

  const ids = Array.from(new Set(records.map((r) => r.r2_object_id)));
  const { data: objs, error: objErr } = await supabase
    .from("r2_objects")
    .select("id,object_key")
    .in("id", ids);
  if (objErr) throw objErr;

  const keyById = new Map<string, string>();
  for (const o of objs ?? []) keyById.set(o.id, o.object_key);
  return records.map((r) => ({ ...r, object_key: keyById.get(r.r2_object_id) ?? null }));
}

/** Active media for a trainer-accessible animal, joined with object_key. */
export async function listMediaForTrainer(
  animalId: string
): Promise<TrainerAnimalMedia[]> {
  const { data: media, error } = await supabase
    .from("animal_media")
    .select("*")
    .eq("animal_id", animalId)
    .is("archived_at", null)
    .order("taken_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  if (!media || media.length === 0) return [];

  const ids = Array.from(new Set(media.map((m) => m.r2_object_id)));
  const { data: objs, error: objErr } = await supabase
    .from("r2_objects")
    .select("id,object_key")
    .in("id", ids);
  if (objErr) throw objErr;

  const keyById = new Map<string, string>();
  for (const o of objs ?? []) keyById.set(o.id, o.object_key);
  return media.map((m) => ({ ...m, object_key: keyById.get(m.r2_object_id) ?? null }));
}

/** Coggins (or any dated record) is expired when expires_on < today. */
export function isExpired(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return d < today;
}

/** 30-day window matches the owner-side attention surface. */
export function isExpiringSoon(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 30);
  return d >= today && d <= cutoff;
}
