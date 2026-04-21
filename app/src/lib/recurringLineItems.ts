import { supabase } from "./supabase";
import type { Database } from "./database.types";

// Recurring line items — trainer-configured standing charges that the
// hourly cron (worker.js materializeRecurringItems) stamps onto each
// monthly draft invoice for the matching (trainer, subject) pair.
//
// Retire via active=false rather than delete, so the historical line
// items keep their source_id -> recurring_line_items pointer intact.

export type RecurringLineItem =
  Database["public"]["Tables"]["recurring_line_items"]["Row"];

export const RECURRING_QUERY_KEY = ["trainer_recurring_items"] as const;

export async function listRecurringItems(
  trainerId: string,
  { includeInactive = false }: { includeInactive?: boolean } = {}
): Promise<RecurringLineItem[]> {
  let q = supabase
    .from("recurring_line_items")
    .select("*")
    .eq("trainer_id", trainerId)
    .order("created_at", { ascending: false });
  if (!includeInactive) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export interface CreateRecurringInput {
  trainerId:   string;
  ownerId:     string | null;
  adhocEmail:  string | null;
  description: string;
  amountCents: number;
  animalId?:   string | null;
}

export async function createRecurringItem(
  input: CreateRecurringInput
): Promise<RecurringLineItem> {
  const payload = {
    trainer_id:   input.trainerId,
    owner_id:     input.ownerId,
    adhoc_email:  input.adhocEmail ? input.adhocEmail.toLowerCase() : null,
    description:  input.description,
    amount_cents: input.amountCents,
    animal_id:    input.animalId ?? null,
    active:       true,
  };
  const { data, error } = await supabase
    .from("recurring_line_items")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function setRecurringActive(
  id: string,
  active: boolean
): Promise<RecurringLineItem> {
  const { data, error } = await supabase
    .from("recurring_line_items")
    .update({ active })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function updateRecurringItem(
  id: string,
  patch: { description?: string; amount_cents?: number; animal_id?: string | null }
): Promise<RecurringLineItem> {
  const { data, error } = await supabase
    .from("recurring_line_items")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
