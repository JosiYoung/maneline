import { supabase } from "./supabase";

// Protocol tracker data layer (Phase 3.5).
//
// Reads are direct supabase-js; RLS (migration 00011) scopes:
//   - protocols: any authenticated user SELECTs active rows.
//   - animal_protocols: owner (owns animal) OR trainer (has grant).
//   - supplement_doses: same scoping + append-only.
//
// Writes are direct:
//   - assignProtocol / endAnimalProtocol: owner-only (RLS enforces).
//   - confirmDose: owner OR trainer, stamps role + uid.

export const PROTOCOLS_QUERY_KEY = ["protocols"] as const;
export const ANIMAL_PROTOCOLS_QUERY_KEY = ["animal_protocols"] as const;
export const SUPPLEMENT_DOSES_QUERY_KEY = ["supplement_doses"] as const;

export interface Protocol {
  id: string;
  number: string | null;
  name: string;
  description: string | null;
  use_case: string | null;
  associated_sku_placeholder: string | null;
  product_id: string | null;
}

export interface AnimalProtocol {
  id: string;
  animal_id: string;
  protocol_id: string;
  started_on: string;
  ended_on: string | null;
  dose_instructions: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  protocol: Protocol;
}

export interface SupplementDose {
  id: string;
  animal_protocol_id: string;
  animal_id: string;
  dosed_on: string;
  dosed_at_time: string | null;
  confirmed_by: string;
  confirmed_role: "owner" | "trainer";
  notes: string | null;
  created_at: string;
}

export async function listProtocols(): Promise<Protocol[]> {
  const { data, error } = await supabase
    .from("protocols")
    .select("id, number, name, description, use_case, associated_sku_placeholder, product_id")
    .is("archived_at", null)
    .order("number", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Protocol[];
}

// Active = archived_at null AND ended_on null-or-future.
export async function listActiveAnimalProtocols(animalId: string): Promise<AnimalProtocol[]> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("animal_protocols")
    .select(`
      id, animal_id, protocol_id, started_on, ended_on,
      dose_instructions, notes, created_by, created_at,
      updated_at, archived_at,
      protocol:protocols (
        id, number, name, description, use_case,
        associated_sku_placeholder, product_id
      )
    `)
    .eq("animal_id", animalId)
    .is("archived_at", null)
    .or(`ended_on.is.null,ended_on.gte.${today}`)
    .order("started_on", { ascending: false });
  if (error) throw error;
  return (data ?? []) as unknown as AnimalProtocol[];
}

export async function assignProtocol(params: {
  animalId: string;
  protocolId: string;
  startedOn: string;
  doseInstructions?: string | null;
  notes?: string | null;
}): Promise<AnimalProtocol> {
  const { data: me } = await supabase.auth.getUser();
  const uid = me.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("animal_protocols")
    .insert({
      animal_id: params.animalId,
      protocol_id: params.protocolId,
      started_on: params.startedOn,
      dose_instructions: params.doseInstructions ?? null,
      notes: params.notes ?? null,
      created_by: uid,
    })
    .select(`
      id, animal_id, protocol_id, started_on, ended_on,
      dose_instructions, notes, created_by, created_at,
      updated_at, archived_at,
      protocol:protocols (
        id, number, name, description, use_case,
        associated_sku_placeholder, product_id
      )
    `)
    .single();
  if (error) throw error;
  return data as unknown as AnimalProtocol;
}

export async function endAnimalProtocol(
  animalProtocolId: string,
  endedOn: string,
): Promise<void> {
  const { error } = await supabase
    .from("animal_protocols")
    .update({ ended_on: endedOn })
    .eq("id", animalProtocolId);
  if (error) throw error;
}

// Returns doses for an animal in the last N days. Used by
// AnimalDetail Protocols card + Today-view "doses given today"
// chip.
export async function listRecentDoses(
  animalId: string,
  days = 30,
): Promise<SupplementDose[]> {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - days);
  const fromIso = from.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("supplement_doses")
    .select("id, animal_protocol_id, animal_id, dosed_on, dosed_at_time, confirmed_by, confirmed_role, notes, created_at")
    .eq("animal_id", animalId)
    .gte("dosed_on", fromIso)
    .order("dosed_on", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SupplementDose[];
}

export async function confirmDoseToday(params: {
  animalProtocolId: string;
  animalId: string;
  role: "owner" | "trainer";
  notes?: string | null;
}): Promise<SupplementDose> {
  const { data: me } = await supabase.auth.getUser();
  const uid = me.user?.id;
  if (!uid) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("supplement_doses")
    .insert({
      animal_protocol_id: params.animalProtocolId,
      animal_id: params.animalId,
      confirmed_by: uid,
      confirmed_role: params.role,
      notes: params.notes ?? null,
    })
    .select("id, animal_protocol_id, animal_id, dosed_on, dosed_at_time, confirmed_by, confirmed_role, notes, created_at")
    .single();
  if (error) throw error;
  return data as SupplementDose;
}

// Returns a map of animal_protocol_id -> true if already dosed today.
export async function dosesGivenToday(animalId: string): Promise<Record<string, boolean>> {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("supplement_doses")
    .select("animal_protocol_id")
    .eq("animal_id", animalId)
    .eq("dosed_on", today);
  if (error) throw error;
  const out: Record<string, boolean> = {};
  for (const r of data ?? []) out[(r as { animal_protocol_id: string }).animal_protocol_id] = true;
  return out;
}

// Aggregate: for a list of animalIds, return how many active protocols
// have NOT yet been dose-confirmed today. Used by Today view per-card
// "X due" chip.
export async function countDosesDueToday(
  animalIds: string[],
): Promise<Record<string, number>> {
  if (animalIds.length === 0) return {};
  const today = new Date().toISOString().slice(0, 10);

  const [activeRes, dosedRes] = await Promise.all([
    supabase
      .from("animal_protocols")
      .select("id, animal_id")
      .in("animal_id", animalIds)
      .is("archived_at", null)
      .or(`ended_on.is.null,ended_on.gte.${today}`),
    supabase
      .from("supplement_doses")
      .select("animal_protocol_id, animal_id")
      .in("animal_id", animalIds)
      .eq("dosed_on", today),
  ]);
  if (activeRes.error) throw activeRes.error;
  if (dosedRes.error) throw dosedRes.error;

  const dosedKey = new Set<string>();
  for (const d of dosedRes.data ?? []) {
    const row = d as { animal_protocol_id: string; animal_id: string };
    dosedKey.add(`${row.animal_id}:${row.animal_protocol_id}`);
  }

  const out: Record<string, number> = Object.fromEntries(animalIds.map((id) => [id, 0]));
  for (const a of activeRes.data ?? []) {
    const row = a as { id: string; animal_id: string };
    if (!dosedKey.has(`${row.animal_id}:${row.id}`)) {
      out[row.animal_id] = (out[row.animal_id] ?? 0) + 1;
    }
  }
  return out;
}
