import { supabase } from "./supabase";
import type { Database, AnimalSpecies, AnimalSex } from "./database.types";

// Animals data layer — every owner-portal animal query goes through here.
//
// Why a tiny wrapper over supabase-js:
//   - One place to enforce the archived_at default filter. Callers that
//     want to see archived animals must opt in via `includeArchived: true`
//     (OAG_ARCHITECTURE_LAWS §8: soft-delete, never hide by default).
//   - One place to invalidate the 'animals' query cache after writes.
//   - Archive/unarchive go through the Worker so we get an atomic write
//     of animals.archived_at + a row in animal_archive_events (service
//     role). Direct SPA UPDATEs would leave the audit trail incomplete.

export type Animal = Database["public"]["Tables"]["animals"]["Row"];
export type AnimalInsert = Database["public"]["Tables"]["animals"]["Insert"];
export type AnimalUpdate = Database["public"]["Tables"]["animals"]["Update"];

export type AnimalInput = {
  barn_name: string;
  species: AnimalSpecies;
  breed?: string | null;
  sex?: AnimalSex | null;
  year_born?: number | null;
  discipline?: string | null;
};

export const ANIMALS_QUERY_KEY = ["animals"] as const;

export async function listAnimals(options: { includeArchived?: boolean } = {}): Promise<Animal[]> {
  const { includeArchived = false } = options;

  let query = supabase
    .from("animals")
    .select("*")
    .order("barn_name", { ascending: true });

  if (!includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getAnimal(id: string): Promise<Animal> {
  const { data, error } = await supabase
    .from("animals")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createAnimal(input: AnimalInput): Promise<Animal> {
  const { data: auth } = await supabase.auth.getUser();
  const ownerId = auth?.user?.id;
  if (!ownerId) throw new Error("Not signed in.");

  const row: AnimalInsert = {
    owner_id:   ownerId,
    barn_name:  input.barn_name,
    species:    input.species,
    breed:      input.breed ?? null,
    sex:        input.sex ?? null,
    year_born:  input.year_born ?? null,
    discipline: input.discipline ?? null,
  };

  const { data, error } = await supabase
    .from("animals")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateAnimal(id: string, patch: Partial<AnimalInput>): Promise<Animal> {
  const update: AnimalUpdate = {
    ...(patch.barn_name  !== undefined ? { barn_name:  patch.barn_name }  : {}),
    ...(patch.species    !== undefined ? { species:    patch.species }    : {}),
    ...(patch.breed      !== undefined ? { breed:      patch.breed }      : {}),
    ...(patch.sex        !== undefined ? { sex:        patch.sex }        : {}),
    ...(patch.year_born  !== undefined ? { year_born:  patch.year_born }  : {}),
    ...(patch.discipline !== undefined ? { discipline: patch.discipline } : {}),
  };

  const { data, error } = await supabase
    .from("animals")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

async function archiveEventWorkerCall(
  path: "archive" | "unarchive",
  animalId: string,
  reason?: string
): Promise<Animal> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const res = await fetch(`/api/animals/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ animal_id: animalId, reason: reason ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Worker ${path} failed (${res.status})`);
  }
  const json = await res.json();
  return json.animal as Animal;
}

export function archiveAnimal(id: string, reason: string): Promise<Animal> {
  return archiveEventWorkerCall("archive", id, reason);
}

export function unarchiveAnimal(id: string): Promise<Animal> {
  return archiveEventWorkerCall("unarchive", id);
}

// attentionAnimalIds — animals with at least one active vet_record whose
// expires_on falls within the next `withinDays` days (default 30).
// Drives the Today view "N need attention" badge and the AnimalCard flag.
export const ATTENTION_QUERY_KEY = ["animals", "attention"] as const;

export async function attentionAnimalIds(withinDays = 30): Promise<Set<string>> {
  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + withinDays);
  const toISODate = (d: Date) => d.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("vet_records")
    .select("animal_id")
    .is("archived_at", null)
    .not("expires_on", "is", null)
    .lte("expires_on", toISODate(cutoff));
  if (error) throw error;
  return new Set((data ?? []).map((r) => r.animal_id));
}

// Dev-only smoke-test helper. Wired into window.__manelineDebug by
// src/pages/app/AnimalsIndex.tsx when import.meta.env.DEV is true.
export async function createTestAnimal(): Promise<Animal> {
  return createAnimal({
    barn_name: `TestHorse-${Math.floor(Math.random() * 10_000)}`,
    species:   "horse",
    breed:     "Quarter Horse",
    sex:       "mare",
    year_born: 2018,
    discipline: "Western",
  });
}
