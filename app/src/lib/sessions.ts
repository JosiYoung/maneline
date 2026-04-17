import { supabase } from "./supabase";
import type {
  Database,
  SessionType,
  SessionStatus,
} from "./database.types";

// Training-session data layer.
//
// Reads are direct supabase-js. RLS enforces scoping:
//   - owner sees rows where owner_id = auth.uid()
//     (training_sessions_owner_select, migration 00006:77)
//   - trainer sees rows where trainer_id = auth.uid() AND the
//     do_i_have_access_to_animal helper returns true
//     (training_sessions_trainer_select, migration 00006:82)
//
// Writes:
//   - createSession: direct INSERT (RLS policy
//     training_sessions_trainer_insert allows trainer_id = auth.uid()
//     with an active animal grant, status='logged', archived_at=null)
//   - archiveSession: Worker POST /api/sessions/archive so we can
//     write session_archive_events atomically (audit table is
//     service_role only). Mirrors the animals archive pattern.

export type TrainingSession =
  Database["public"]["Tables"]["training_sessions"]["Row"];

export type TrainingSessionWithAnimal = TrainingSession & {
  animal_barn_name: string | null;
  trainer_display_name: string | null;
};

export const SESSIONS_QUERY_KEY = ["training_sessions"] as const;

export const SESSION_TYPE_OPTIONS: { value: SessionType; label: string }[] = [
  { value: "ride",         label: "Ride" },
  { value: "groundwork",   label: "Groundwork" },
  { value: "bodywork",     label: "Bodywork" },
  { value: "health_check", label: "Health check" },
  { value: "lesson",       label: "Lesson" },
  { value: "other",        label: "Other" },
];

export function sessionTypeLabel(t: SessionType): string {
  return SESSION_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;
}

export function sessionStatusLabel(s: SessionStatus): string {
  switch (s) {
    case "logged":   return "Logged";
    case "approved": return "Approved";
    case "paid":     return "Paid";
    case "disputed": return "Disputed";
  }
}

/** Sessions for a single animal, newest first. RLS scopes by caller role. */
export async function listSessionsForAnimal(
  animalId: string,
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<TrainingSessionWithAnimal[]> {
  let q = supabase
    .from("training_sessions")
    .select("*")
    .eq("animal_id", animalId)
    .order("started_at", { ascending: false });
  if (!includeArchived) q = q.is("archived_at", null);

  const { data: rows, error } = await q;
  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  return decorate(rows);
}

/** Every session the caller is part of — trainer's "my sessions" view. */
export async function listMySessions(
  { includeArchived = false }: { includeArchived?: boolean } = {}
): Promise<TrainingSessionWithAnimal[]> {
  let q = supabase
    .from("training_sessions")
    .select("*")
    .order("started_at", { ascending: false });
  if (!includeArchived) q = q.is("archived_at", null);

  const { data: rows, error } = await q;
  if (error) throw error;
  if (!rows || rows.length === 0) return [];

  return decorate(rows);
}

/** Single session by id. RLS drops the row if caller can't see it. */
export async function getSession(id: string): Promise<TrainingSessionWithAnimal> {
  const { data, error } = await supabase
    .from("training_sessions")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Session not found or access has been revoked.");
  const [decorated] = await decorate([data]);
  return decorated;
}

export type CreateSessionInput = {
  animal_id: string;
  session_type: SessionType;
  started_at: string;           // ISO timestamp
  duration_minutes: number;
  title: string;
  notes?: string | null;
  trainer_price_cents?: number | null;
};

/**
 * Trainer creates a session. We need trainer_id + owner_id on the row;
 * RLS confirms the trainer has access to the animal. owner_id is looked
 * up via the animal row (which the trainer can read by the same RLS
 * policy that will be re-checked on INSERT).
 */
export async function createSession(
  input: CreateSessionInput
): Promise<TrainingSession> {
  const { data: sess } = await supabase.auth.getSession();
  const trainerId = sess.session?.user?.id;
  if (!trainerId) throw new Error("Not signed in.");

  const { data: animal, error: animalErr } = await supabase
    .from("animals")
    .select("id,owner_id")
    .eq("id", input.animal_id)
    .maybeSingle();
  if (animalErr) throw animalErr;
  if (!animal) throw new Error("Animal not found or access revoked.");

  const { data, error } = await supabase
    .from("training_sessions")
    .insert({
      trainer_id:          trainerId,
      owner_id:            animal.owner_id,
      animal_id:           input.animal_id,
      session_type:        input.session_type,
      started_at:          input.started_at,
      duration_minutes:    input.duration_minutes,
      title:               input.title,
      notes:               input.notes ?? null,
      trainer_price_cents: input.trainer_price_cents ?? null,
      status:              "logged",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export type ArchiveSessionInput = {
  session_id: string;
  reason: string;
};

export async function archiveSession(
  input: ArchiveSessionInput
): Promise<TrainingSession> {
  const res = await authedPost("/api/sessions/archive", {
    session_id: input.session_id,
    reason:     input.reason,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body?.error || `Archive failed (${res.status})`);
    (err as Error & { code?: string }).code = body?.error;
    throw err;
  }
  const body = (await res.json()) as { session: TrainingSession };
  return body.session;
}

async function authedPost(path: string, body: unknown): Promise<Response> {
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

/**
 * Decorate rows with animal barn_name + trainer display_name. Both are
 * pulled via secondary selects; RLS for animals/user_profiles already
 * allows the caller to see their own counterparties (owner sees the
 * trainers who logged; trainer sees the animals they have access to).
 */
async function decorate(
  rows: TrainingSession[]
): Promise<TrainingSessionWithAnimal[]> {
  const animalIds = Array.from(new Set(rows.map((r) => r.animal_id)));
  const trainerIds = Array.from(new Set(rows.map((r) => r.trainer_id)));

  const [animalsRes, trainersRes] = await Promise.all([
    animalIds.length
      ? supabase.from("animals").select("id,barn_name").in("id", animalIds)
      : Promise.resolve({ data: [] as { id: string; barn_name: string }[], error: null }),
    trainerIds.length
      ? supabase
          .from("user_profiles")
          .select("user_id,display_name")
          .in("user_id", trainerIds)
      : Promise.resolve({ data: [] as { user_id: string; display_name: string }[], error: null }),
  ]);

  const aMap = new Map<string, string>();
  for (const a of animalsRes.data ?? []) aMap.set(a.id, a.barn_name);
  const tMap = new Map<string, string>();
  for (const t of trainersRes.data ?? []) tMap.set(t.user_id, t.display_name);

  return rows.map((r) => ({
    ...r,
    animal_barn_name:     aMap.get(r.animal_id) ?? null,
    trainer_display_name: tMap.get(r.trainer_id) ?? null,
  }));
}

export function formatCents(cents: number | null): string | null {
  if (cents == null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "usd",
  }).format(cents / 100);
}

export function formatDurationMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function formatStartedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
