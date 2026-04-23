import { supabase } from "./supabase";
import type { Database } from "./database.types";

// horse_messages data layer — reads/writes go straight through
// supabase-js; RLS in migration 00028 enforces access.

export type HorseMessage = Database["public"]["Tables"]["horse_messages"]["Row"];

export const HORSE_MESSAGES_QUERY_KEY = ["horse_messages"] as const;
export const HORSE_MESSAGES_UNREAD_TOTAL_QUERY_KEY =
  ["horse_messages", "unread_total"] as const;

export async function listHorseMessages(animalId: string): Promise<HorseMessage[]> {
  const { data, error } = await supabase
    .from("horse_messages")
    .select("*")
    .eq("animal_id", animalId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendHorseMessage(
  animalId: string,
  body: string,
): Promise<HorseMessage> {
  const trimmed = body.trim();
  if (trimmed.length === 0) throw new Error("Message can't be empty.");
  if (trimmed.length > 4000) throw new Error("Message is too long (max 4000 characters).");

  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("horse_messages")
    .insert({
      animal_id: animalId,
      sender_id: userId,
      body: trimmed,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function markHorseMessagesRead(animalId: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { error } = await supabase
    .from("horse_message_reads")
    .upsert(
      {
        user_id: userId,
        animal_id: animalId,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: "user_id,animal_id" },
    );
  if (error) throw error;
}

export async function getUnreadTotal(): Promise<number> {
  const { data, error } = await supabase.rpc("horse_messages_unread_total");
  if (error) throw error;
  return typeof data === "number" ? data : 0;
}

export async function getUnreadForAnimal(animalId: string): Promise<number> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return 0;

  const { data: readRow } = await supabase
    .from("horse_message_reads")
    .select("last_read_at")
    .eq("user_id", userId)
    .eq("animal_id", animalId)
    .maybeSingle();

  const lastRead = readRow?.last_read_at ?? "1970-01-01T00:00:00Z";

  const { count, error } = await supabase
    .from("horse_messages")
    .select("id", { count: "exact", head: true })
    .eq("animal_id", animalId)
    .is("archived_at", null)
    .neq("sender_id", userId)
    .gt("created_at", lastRead);
  if (error) throw error;
  return count ?? 0;
}
