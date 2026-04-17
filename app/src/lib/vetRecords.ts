import { supabase } from "./supabase";
import type { Database } from "./database.types";

// vetRecords data layer. Keep it small: the SPA writes via the Worker's
// /api/uploads/commit path (that owns the r2_objects + vet_records atom),
// so only READ and ARCHIVE helpers live here.

export type VetRecord = Database["public"]["Tables"]["vet_records"]["Row"];
export type VetRecordType = VetRecord["record_type"];

export const VET_RECORDS_QUERY_KEY = ["vet_records"] as const;

export const RECORD_TYPES: ReadonlyArray<VetRecordType> = [
  "coggins",
  "vaccine",
  "dental",
  "farrier",
  "other",
];

export type ListVetRecordsOptions = {
  animalId?: string;
  recordType?: VetRecordType;
  includeArchived?: boolean;
  limit?: number;
};

export async function listVetRecords(
  options: ListVetRecordsOptions = {}
): Promise<VetRecord[]> {
  const { animalId, recordType, includeArchived = false, limit } = options;

  let q = supabase
    .from("vet_records")
    .select("*")
    .order("issued_on", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (!includeArchived) q = q.is("archived_at", null);
  if (animalId) q = q.eq("animal_id", animalId);
  if (recordType) q = q.eq("record_type", recordType);
  if (limit) q = q.limit(limit);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Pairs a vet_records row with its r2_objects.object_key so the caller
// can request a signed GET URL when the user taps "View".
export async function listVetRecordsWithKeys(
  options: ListVetRecordsOptions = {}
): Promise<(VetRecord & { object_key: string | null })[]> {
  const records = await listVetRecords(options);
  if (records.length === 0) return [];

  const ids = Array.from(new Set(records.map((r) => r.r2_object_id)));
  const { data, error } = await supabase
    .from("r2_objects")
    .select("id, object_key")
    .in("id", ids);
  if (error) throw error;

  const keyById = new Map<string, string>();
  for (const row of data ?? []) {
    keyById.set((row as { id: string }).id, (row as { object_key: string }).object_key);
  }
  return records.map((r) => ({ ...r, object_key: keyById.get(r.r2_object_id) ?? null }));
}
