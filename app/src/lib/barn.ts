import { supabase } from "./supabase";

// Barn Mode data layer (Phase 8 Module 01).
//
// All writes route through the Worker (service_role) for atomic
// multi-table fanout + audit + rate limit. Reads go through the Worker
// too so we get one surface for scope (owner / trainer / silver_lining)
// rather than duplicating caller-JWT RLS logic client-side.

// ---------- Types ----------

export type ProContactRole =
  | "farrier"
  | "vet"
  | "nutritionist"
  | "bodyworker"
  | "trainer"
  | "boarding"
  | "hauler"
  | "other";

export interface ProContact {
  id: string;
  owner_id: string;
  display_name: string;
  role: ProContactRole;
  email: string | null;
  phone_e164: string | null;
  linked_user_id: string | null;
  response_count_confirmed: number;
  claim_email_sent_at: string | null;
  archived_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type BarnEventStatus = "scheduled" | "cancelled" | "completed";

export type AttendeeStatus =
  | "pending"
  | "confirmed"
  | "declined"
  | "countered"
  | "no_response";

export type DeliveryChannel = "in_app" | "email" | "email_sms";

export interface BarnEvent {
  id: string;
  owner_id: string;
  ranch_id: string | null;
  title: string;
  description: string | null;
  start_at: string;
  duration_minutes: number;
  location_text: string | null;
  animal_ids: string[];
  notes: string | null;
  status: BarnEventStatus;
  recurrence_rule_id: string | null;
  parent_event_id: string | null;
  cancelled_at: string | null;
  cancelled_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BarnEventAttendee {
  id: string;
  event_id: string;
  pro_contact_id: string | null;
  linked_user_id: string | null;
  email: string | null;
  phone_e164: string | null;
  delivery_channel: DeliveryChannel;
  public_token: string | null;
  token_expires_at: string | null;
  current_status: AttendeeStatus;
  countered_start_at: string | null;
  countered_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface BarnEventResponse {
  id: string;
  event_id: string;
  attendee_id: string;
  actor_user_id: string | null;
  response: "confirmed" | "declined" | "countered";
  countered_start_at: string | null;
  countered_note: string | null;
  ip_hash: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface RecurrenceRule {
  id: string;
  rrule_text: string;
  last_materialized_through: string | null;
}

export interface EventDetail {
  event: BarnEvent;
  attendees: BarnEventAttendee[];
  responses: BarnEventResponse[];
  recurrence_rule: RecurrenceRule | null;
}

export interface EventListItem {
  event: BarnEvent;
  attendee_count: number;
  confirmed_count: number;
}

export interface AttendeeInput {
  pro_contact_id?: string;
  email?: string;
  phone_e164?: string;
  delivery_channel: DeliveryChannel;
}

export interface CreateEventInput {
  title: string;
  description?: string | null;
  start_at: string;
  duration_minutes: number;
  location_text?: string | null;
  ranch_id?: string | null;
  animal_ids?: string[];
  notes?: string | null;
  attendees?: AttendeeInput[];
  rrule_text?: string | null;
}

export interface CreateEventResult {
  event: BarnEvent;
  attendees: BarnEventAttendee[];
  recurrence_rule_id: string | null;
  materialized_count: number;
  public_token_count: number;
}

// ---------- Query keys ----------

export const PRO_CONTACTS_QUERY_KEY = ["barn_pro_contacts"] as const;
export const BARN_EVENTS_QUERY_KEY = ["barn_events"] as const;
export const BARN_EVENT_DETAIL_QUERY_KEY = (id: string) =>
  ["barn_event_detail", id] as const;
export const TRAINER_SCHEDULE_QUERY_KEY = ["trainer_my_schedule"] as const;

// ---------- Color palette (Phase 8.1 §B.10, 16 Tailwind-500) ----------

export const BARN_SWATCHES: { name: string; hex: string }[] = [
  { name: "amber",   hex: "#f59e0b" },
  { name: "rose",    hex: "#f43f5e" },
  { name: "emerald", hex: "#10b981" },
  { name: "sky",     hex: "#0ea5e9" },
  { name: "violet",  hex: "#8b5cf6" },
  { name: "fuchsia", hex: "#d946ef" },
  { name: "orange",  hex: "#f97316" },
  { name: "teal",    hex: "#14b8a6" },
  { name: "indigo",  hex: "#6366f1" },
  { name: "lime",    hex: "#84cc16" },
  { name: "cyan",    hex: "#06b6d4" },
  { name: "pink",    hex: "#ec4899" },
  { name: "red",     hex: "#ef4444" },
  { name: "yellow",  hex: "#eab308" },
  { name: "green",   hex: "#22c55e" },
  { name: "blue",    hex: "#3b82f6" },
];

// ---------- Auth helper ----------

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return `Bearer ${token}`;
}

async function workerFetch<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    Authorization: await authHeader(),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = (data as { error?: string; message?: string } | null) ?? {};
    const msg = err.message || err.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

// ---------- Pro Contacts ----------

export async function listProContacts(params: {
  role?: ProContactRole;
  includeArchived?: boolean;
} = {}): Promise<ProContact[]> {
  const qp = new URLSearchParams();
  if (params.role) qp.set("role", params.role);
  if (params.includeArchived) qp.set("include_archived", "1");
  const suffix = qp.toString() ? `?${qp}` : "";
  const r = await workerFetch<{ contacts: ProContact[] }>(
    `/api/barn/pro-contacts${suffix}`
  );
  return r.contacts;
}

export interface CreateProContactInput {
  display_name: string;
  role: ProContactRole;
  email?: string | null;
  phone_e164?: string | null;
  notes?: string | null;
}

export async function createProContact(
  input: CreateProContactInput
): Promise<ProContact> {
  const r = await workerFetch<{ contact: ProContact }>(
    "/api/barn/pro-contacts",
    { method: "POST", body: JSON.stringify(input) }
  );
  return r.contact;
}

export async function updateProContact(
  id: string,
  patch: Partial<CreateProContactInput>
): Promise<ProContact> {
  const r = await workerFetch<{ contact: ProContact }>(
    `/api/barn/pro-contacts/${id}`,
    { method: "PATCH", body: JSON.stringify(patch) }
  );
  return r.contact;
}

export async function archiveProContact(id: string): Promise<ProContact> {
  const r = await workerFetch<{ contact: ProContact }>(
    `/api/barn/pro-contacts/${id}/archive`,
    { method: "POST", body: JSON.stringify({}) }
  );
  return r.contact;
}

// ---------- Events ----------

export async function listEvents(params: {
  start?: string;
  end?: string;
  includeArchived?: boolean;
} = {}): Promise<EventListItem[]> {
  const qp = new URLSearchParams();
  if (params.start) qp.set("start", params.start);
  if (params.end) qp.set("end", params.end);
  if (params.includeArchived) qp.set("include_archived", "1");
  const suffix = qp.toString() ? `?${qp}` : "";
  const r = await workerFetch<{ events: EventListItem[] }>(
    `/api/barn/events${suffix}`
  );
  return r.events;
}

export async function getEvent(id: string): Promise<EventDetail> {
  return workerFetch<EventDetail>(`/api/barn/events/${id}`);
}

export async function createEvent(
  input: CreateEventInput
): Promise<CreateEventResult> {
  return workerFetch<CreateEventResult>("/api/barn/events", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateEvent(
  id: string,
  patch: Partial<Pick<
    CreateEventInput,
    | "title"
    | "description"
    | "start_at"
    | "duration_minutes"
    | "location_text"
    | "ranch_id"
    | "animal_ids"
    | "notes"
  >>
): Promise<{ event: BarnEvent }> {
  return workerFetch<{ event: BarnEvent }>(`/api/barn/events/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function cancelEvent(
  id: string,
  reason?: string | null
): Promise<{ event: BarnEvent }> {
  return workerFetch<{ event: BarnEvent }>(
    `/api/barn/events/${id}/cancel`,
    { method: "POST", body: JSON.stringify({ reason: reason ?? null }) }
  );
}

export async function archiveEvent(id: string): Promise<{ event: BarnEvent }> {
  return workerFetch<{ event: BarnEvent }>(
    `/api/barn/events/${id}/archive`,
    { method: "POST", body: JSON.stringify({}) }
  );
}

export interface RespondInput {
  attendee_id: string;
  response: "confirmed" | "declined" | "countered";
  countered_start_at?: string | null;
  countered_note?: string | null;
}

export async function respondToEvent(
  eventId: string,
  input: RespondInput
): Promise<{ attendee: BarnEventAttendee }> {
  return workerFetch<{ attendee: BarnEventAttendee }>(
    `/api/barn/events/${eventId}/respond`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

// ---------- Public token endpoints (no auth) ----------

export interface PublicEventView {
  event: Pick<
    BarnEvent,
    | "id"
    | "title"
    | "start_at"
    | "duration_minutes"
    | "location_text"
    | "notes"
    | "status"
  >;
  attendee: Pick<
    BarnEventAttendee,
    "id" | "email" | "delivery_channel" | "current_status" | "token_expires_at"
  >;
  owner_display_name: string | null;
}

export async function publicGetEvent(token: string): Promise<PublicEventView> {
  const res = await fetch(`/api/public/events/${encodeURIComponent(token)}`);
  const text = await res.text();
  let data: unknown = null;
  let parsed = false;
  try { data = text ? JSON.parse(text) : null; parsed = true; } catch { data = null; }
  if (!res.ok) {
    const err = (data as { error?: string; message?: string } | null) ?? {};
    throw new Error(err.message || err.error || `Request failed (${res.status})`);
  }
  if (!parsed || !data || typeof data !== "object") {
    throw new Error("Invitation service unavailable.");
  }
  return data as PublicEventView;
}

export async function publicRespond(
  token: string,
  input: {
    response: "confirmed" | "declined" | "countered";
    countered_start_at?: string | null;
    countered_note?: string | null;
  }
): Promise<{ ok: true; current_status: AttendeeStatus }> {
  const res = await fetch(
    `/api/public/events/${encodeURIComponent(token)}/respond`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const err = (data as { error?: string; message?: string } | null) ?? {};
    throw new Error(err.message || err.error || `Request failed (${res.status})`);
  }
  return data as { ok: true; current_status: AttendeeStatus };
}

// ---------- Display helpers ----------

export function formatEventWhen(startIso: string, durationMinutes: number): string {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timeFmt = (d: Date) =>
    d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${dateStr} · ${timeFmt(start)}–${timeFmt(end)}`;
}

export function formatProRole(role: ProContactRole): string {
  switch (role) {
    case "farrier":      return "Farrier";
    case "vet":          return "Vet";
    case "nutritionist": return "Nutritionist";
    case "bodyworker":   return "Bodyworker";
    case "trainer":      return "Trainer";
    case "boarding":     return "Boarding";
    case "hauler":       return "Hauler";
    case "other":        return "Other";
  }
}

export function formatAttendeeStatus(s: AttendeeStatus): string {
  switch (s) {
    case "pending":      return "Pending";
    case "confirmed":    return "Confirmed";
    case "declined":     return "Declined";
    case "countered":    return "Counter-proposed";
    case "no_response":  return "No response";
  }
}

export function attendeeStatusTone(
  s: AttendeeStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "confirmed":    return "default";
    case "pending":      return "secondary";
    case "countered":    return "outline";
    case "declined":     return "destructive";
    case "no_response":  return "outline";
  }
}

// ---------- Herd Health (Module 02) ----------

export type HerdHealthRecordType =
  | "coggins"
  | "core_vaccines"
  | "risk_vaccines"
  | "dental"
  | "farrier"
  | "fec"
  | "deworming";

export type HerdHealthStatus =
  | "ok"
  | "warn"
  | "overdue"
  | "dismissed"
  | "no_record"
  | "disabled";

export interface HerdHealthThreshold {
  id: string;
  record_type: HerdHealthRecordType;
  interval_days: number;
  enabled: boolean;
  updated_at?: string;
}

export interface HerdHealthAnimalRow {
  id: string;
  name: string;
  color_hex: string | null;
  archived_at: string | null;
}

export interface HerdHealthCell {
  animal_id: string;
  record_type: HerdHealthRecordType;
  last_record_at: string | null;
  next_due_at: string | null;
  interval_days: number;
  enabled: boolean;
  dismissed_until: string | null;
  status: HerdHealthStatus;
}

export interface HerdHealthDashboard {
  record_types: HerdHealthRecordType[];
  thresholds: HerdHealthThreshold[];
  animals: HerdHealthAnimalRow[];
  cells: HerdHealthCell[];
}

export interface HerdHealthVetRecord {
  id: string;
  record_type: string;
  issued_on: string | null;
  expires_on: string | null;
  issuing_provider: string | null;
  notes: string | null;
  created_at: string;
}

export interface HerdHealthAnimalDetail {
  animal: HerdHealthAnimalRow;
  records: HerdHealthVetRecord[];
  thresholds: HerdHealthThreshold[];
  cells: HerdHealthCell[];
  record_types: HerdHealthRecordType[];
}

export interface HerdHealthAcknowledgement {
  id: string;
  owner_id: string;
  animal_id: string;
  record_type: HerdHealthRecordType;
  dismissed_until: string;
  reason: string | null;
  created_at: string;
  archived_at: string | null;
}

export const HERD_HEALTH_RECORD_TYPES: HerdHealthRecordType[] = [
  "coggins",
  "core_vaccines",
  "risk_vaccines",
  "dental",
  "farrier",
  "fec",
  "deworming",
];

export const HERD_HEALTH_QUERY_KEY = ["herd_health"] as const;
export const HERD_HEALTH_ANIMAL_QUERY_KEY = (animalId: string) =>
  ["herd_health_animal", animalId] as const;

export async function getHerdHealth(): Promise<HerdHealthDashboard> {
  return workerFetch<HerdHealthDashboard>("/api/barn/herd-health");
}

export async function getHerdHealthAnimal(
  animalId: string
): Promise<HerdHealthAnimalDetail> {
  return workerFetch<HerdHealthAnimalDetail>(
    `/api/barn/herd-health/animals/${encodeURIComponent(animalId)}`
  );
}

export async function updateHerdHealthThresholds(
  thresholds: Array<Pick<HerdHealthThreshold, "record_type" | "interval_days" | "enabled">>
): Promise<HerdHealthThreshold[]> {
  const r = await workerFetch<{ thresholds: HerdHealthThreshold[] }>(
    "/api/barn/herd-health/thresholds",
    { method: "PATCH", body: JSON.stringify({ thresholds }) }
  );
  return r.thresholds;
}

export async function resetHerdHealthThresholds(): Promise<HerdHealthThreshold[]> {
  const r = await workerFetch<{ thresholds: HerdHealthThreshold[] }>(
    "/api/barn/herd-health/thresholds/reset",
    { method: "POST" }
  );
  return r.thresholds;
}

export async function acknowledgeHerdHealthCell(input: {
  animal_id: string;
  record_type: HerdHealthRecordType;
  dismissed_until: string;
  reason?: string | null;
}): Promise<HerdHealthAcknowledgement> {
  const r = await workerFetch<{ acknowledgement: HerdHealthAcknowledgement }>(
    "/api/barn/herd-health/acknowledge",
    { method: "POST", body: JSON.stringify(input) }
  );
  return r.acknowledgement;
}

export function formatHerdHealthRecordType(t: HerdHealthRecordType): string {
  switch (t) {
    case "coggins":       return "Coggins";
    case "core_vaccines": return "Core vaccines";
    case "risk_vaccines": return "Risk vaccines";
    case "dental":        return "Dental";
    case "farrier":       return "Farrier";
    case "fec":           return "FEC";
    case "deworming":     return "Deworming";
  }
}

export const HERD_HEALTH_CELL_CLASSES: Record<HerdHealthStatus, string> = {
  ok:        "bg-emerald-50 text-emerald-700 border-emerald-200",
  warn:      "bg-amber-50 text-amber-700 border-amber-200",
  overdue:   "bg-rose-100 text-rose-700 border-rose-300",
  dismissed: "bg-slate-200 text-slate-600 border border-dashed border-slate-400",
  no_record: "bg-slate-100 text-slate-500 border-slate-200",
  disabled:  "bg-slate-50 text-slate-400 border-slate-200",
};

export function formatHerdHealthStatus(s: HerdHealthStatus): string {
  switch (s) {
    case "ok":        return "On track";
    case "warn":      return "Due soon";
    case "overdue":   return "Overdue";
    case "dismissed": return "Snoozed";
    case "no_record": return "No record";
    case "disabled":  return "Off";
  }
}

export function formatCellLabel(cell: HerdHealthCell): string {
  if (!cell.enabled) return "Off";
  if (cell.status === "dismissed" && cell.dismissed_until) {
    return `Snoozed → ${new Date(cell.dismissed_until).toLocaleDateString()}`;
  }
  if (cell.status === "no_record") return "No record";
  if (cell.next_due_at) {
    const due = new Date(cell.next_due_at);
    return due.toLocaleDateString();
  }
  return "—";
}

// ---------- Phase 8 Module 03 — Facility Map + Care Matrix ----------

export type CareMatrixColumn =
  | "feed_am"
  | "feed_pm"
  | "hay"
  | "turnout"
  | "blanket"
  | "supplements_given"
  | "meds_given";

export const CARE_MATRIX_COLUMNS: CareMatrixColumn[] = [
  "feed_am",
  "feed_pm",
  "hay",
  "turnout",
  "blanket",
  "supplements_given",
  "meds_given",
];

export function formatCareMatrixColumn(col: CareMatrixColumn): string {
  switch (col) {
    case "feed_am":           return "Feed AM";
    case "feed_pm":           return "Feed PM";
    case "hay":               return "Hay";
    case "turnout":           return "Turnout";
    case "blanket":           return "Blanket";
    case "supplements_given": return "Supplements";
    case "meds_given":        return "Meds";
  }
}

export interface FacilityRanch {
  id: string;
  name: string;
  color_hex: string | null;
}

export interface Stall {
  id: string;
  ranch_id: string;
  label: string;
  position_row: number | null;
  position_col: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface StallAssignment {
  id: string;
  stall_id: string;
  animal_id: string;
  assigned_at: string;
  unassigned_at: string | null;
  assigned_by: string | null;
  notes: string | null;
}

export interface TurnoutGroup {
  id: string;
  ranch_id: string;
  name: string;
  color_hex: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface TurnoutGroupMember {
  id: string;
  group_id: string;
  animal_id: string;
  joined_at: string;
  left_at: string | null;
  added_by: string | null;
}

export interface CareMatrixEntry {
  id: string;
  animal_id: string;
  entry_date: string;
  feed_am: boolean;
  feed_pm: boolean;
  hay: boolean;
  turnout: boolean;
  blanket: boolean;
  supplements_given: boolean;
  meds_given: boolean;
  notes: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface FacilityMapResponse {
  ranch: FacilityRanch & {
    address_line1: string | null;
    city: string | null;
    state: string | null;
  };
  stalls: Stall[];
  assignments: StallAssignment[];
  groups: TurnoutGroup[];
  members: TurnoutGroupMember[];
}

export interface CareMatrixResponse {
  ranch_id: string;
  date: string;
  columns: CareMatrixColumn[];
  animal_ids: string[];
  entries: CareMatrixEntry[];
}

export const FACILITY_RANCHES_QUERY_KEY = ["facility", "ranches"] as const;
export const FACILITY_MAP_QUERY_KEY = (ranchId: string) =>
  ["facility", "map", ranchId] as const;
export const CARE_MATRIX_QUERY_KEY = (ranchId: string, dateYmd: string) =>
  ["facility", "care_matrix", ranchId, dateYmd] as const;

export async function listFacilityRanches(): Promise<FacilityRanch[]> {
  const r = await workerFetch<{ ranches: FacilityRanch[] }>(
    "/api/barn/facility/ranches"
  );
  return r.ranches;
}

export async function getFacilityMap(ranchId: string): Promise<FacilityMapResponse> {
  return workerFetch<FacilityMapResponse>(
    `/api/barn/facility/map?ranch_id=${encodeURIComponent(ranchId)}`
  );
}

export interface CreateRanchInput {
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  color_hex?: string | null;
}

export async function createRanch(input: CreateRanchInput): Promise<FacilityRanch> {
  const r = await workerFetch<{ ranch: FacilityRanch }>(
    "/api/barn/facility/ranches",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return r.ranch;
}

export interface CreateStallInput {
  ranch_id: string;
  label: string;
  notes?: string | null;
  position_row?: number | null;
  position_col?: number | null;
}

export async function createStall(input: CreateStallInput): Promise<Stall> {
  const r = await workerFetch<{ stall: Stall }>("/api/barn/facility/stalls", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return r.stall;
}

export interface PatchStallInput {
  label?: string;
  notes?: string | null;
  position_row?: number | null;
  position_col?: number | null;
}

export async function patchStall(stallId: string, input: PatchStallInput): Promise<Stall> {
  const r = await workerFetch<{ stall: Stall }>(
    `/api/barn/facility/stalls/${encodeURIComponent(stallId)}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return r.stall;
}

export async function archiveStall(stallId: string): Promise<Stall> {
  const r = await workerFetch<{ stall: Stall }>(
    `/api/barn/facility/stalls/${encodeURIComponent(stallId)}/archive`,
    { method: "POST", body: JSON.stringify({}) }
  );
  return r.stall;
}

export async function assignStall(
  stallId: string,
  animalId: string | null
): Promise<StallAssignment | null> {
  const r = await workerFetch<{ assignment: StallAssignment | null }>(
    `/api/barn/facility/stalls/${encodeURIComponent(stallId)}/assign`,
    { method: "POST", body: JSON.stringify({ animal_id: animalId }) }
  );
  return r.assignment;
}

export interface CreateTurnoutGroupInput {
  ranch_id: string;
  name: string;
  color_hex?: string | null;
  notes?: string | null;
}

export async function createTurnoutGroup(
  input: CreateTurnoutGroupInput
): Promise<TurnoutGroup> {
  const r = await workerFetch<{ group: TurnoutGroup }>(
    "/api/barn/facility/turnout-groups",
    { method: "POST", body: JSON.stringify(input) }
  );
  return r.group;
}

export interface PatchTurnoutGroupInput {
  name?: string;
  color_hex?: string | null;
  notes?: string | null;
}

export async function patchTurnoutGroup(
  groupId: string,
  input: PatchTurnoutGroupInput
): Promise<TurnoutGroup> {
  const r = await workerFetch<{ group: TurnoutGroup }>(
    `/api/barn/facility/turnout-groups/${encodeURIComponent(groupId)}`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return r.group;
}

export async function archiveTurnoutGroup(groupId: string): Promise<TurnoutGroup> {
  const r = await workerFetch<{ group: TurnoutGroup }>(
    `/api/barn/facility/turnout-groups/${encodeURIComponent(groupId)}/archive`,
    { method: "POST", body: JSON.stringify({}) }
  );
  return r.group;
}

export async function addTurnoutMembers(
  groupId: string,
  animalIds: string[]
): Promise<TurnoutGroupMember[]> {
  const r = await workerFetch<{ members: TurnoutGroupMember[] }>(
    `/api/barn/facility/turnout-groups/${encodeURIComponent(groupId)}/members`,
    { method: "POST", body: JSON.stringify({ animal_ids: animalIds }) }
  );
  return r.members;
}

export async function removeTurnoutMember(
  groupId: string,
  animalId: string
): Promise<TurnoutGroupMember> {
  const r = await workerFetch<{ member: TurnoutGroupMember }>(
    `/api/barn/facility/turnout-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(animalId)}`,
    { method: "DELETE" }
  );
  return r.member;
}

export async function getCareMatrix(
  ranchId: string,
  dateYmd: string
): Promise<CareMatrixResponse> {
  return workerFetch<CareMatrixResponse>(
    `/api/barn/facility/care-matrix?ranch_id=${encodeURIComponent(ranchId)}&date=${encodeURIComponent(dateYmd)}`
  );
}

export interface CareMatrixUpsertEntry {
  animal_id: string;
  feed_am?: boolean;
  feed_pm?: boolean;
  hay?: boolean;
  turnout?: boolean;
  blanket?: boolean;
  supplements_given?: boolean;
  meds_given?: boolean;
  notes?: string | null;
}

export async function upsertCareMatrix(
  ranchId: string,
  dateYmd: string,
  entries: CareMatrixUpsertEntry[]
): Promise<CareMatrixEntry[]> {
  const r = await workerFetch<{ entries: CareMatrixEntry[] }>(
    "/api/barn/facility/care-matrix",
    {
      method: "POST",
      body: JSON.stringify({ ranch_id: ranchId, date: dateYmd, entries }),
    }
  );
  return r.entries;
}

// ---------- Phase 8 Module 04 — Barn Spending ----------

export type ExpenseCategory =
  | "feed"
  | "tack"
  | "vet"
  | "board"
  | "farrier"
  | "supplement"
  | "travel"
  | "show"
  | "other";

export type Disposition =
  | "sold"
  | "deceased"
  | "leased_out"
  | "retired"
  | "still_owned";

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  sold:         "Sold",
  deceased:     "Deceased",
  leased_out:   "Leased out",
  retired:      "Retired",
  still_owned:  "Still owned",
};

export type SpendingGroupBy = "category" | "animal" | "ranch";

export interface SpendingTotal {
  key: string;
  label: string;
  total_cents: number;
  entry_count: number;
}

export interface SpendingMonthPoint {
  month: string;
  total_cents: number;
}

export interface SpendingResponse {
  year: number;
  group_by: SpendingGroupBy;
  grand_total_cents: number;
  totals: SpendingTotal[];
  monthly_timeline: SpendingMonthPoint[];
  categories: ExpenseCategory[];
}

export interface AnimalCostBasis {
  animal: {
    id: string;
    barn_name: string;
    color_hex: string | null;
    acquired_at: string | null;
    acquired_price_cents: number | null;
    disposition: Disposition | null;
    disposition_at: string | null;
    disposition_amount_cents: number | null;
    created_at: string;
  };
  cumulative_spend_cents: number;
  annualized_spend_cents: number | null;
}

export interface PatchCostBasisInput {
  acquired_at?: string | null;
  acquired_price_cents?: number | null;
  disposition?: Disposition | null;
  disposition_at?: string | null;
  disposition_amount_cents?: number | null;
}

export const SPENDING_QUERY_KEY = (year: number, groupBy: SpendingGroupBy) =>
  ["spending", year, groupBy] as const;
export const COST_BASIS_QUERY_KEY = (animalId: string) =>
  ["cost_basis", animalId] as const;

export async function getSpending(
  year: number,
  groupBy: SpendingGroupBy
): Promise<SpendingResponse> {
  return workerFetch<SpendingResponse>(
    `/api/barn/spending?year=${year}&group_by=${groupBy}`
  );
}

export async function getAnimalCostBasis(animalId: string): Promise<AnimalCostBasis> {
  return workerFetch<AnimalCostBasis>(
    `/api/barn/spending/animals/${encodeURIComponent(animalId)}/cost-basis`
  );
}

export async function patchAnimalCostBasis(
  animalId: string,
  input: PatchCostBasisInput
): Promise<AnimalCostBasis["animal"]> {
  const r = await workerFetch<{ animal: AnimalCostBasis["animal"] }>(
    `/api/barn/spending/animals/${encodeURIComponent(animalId)}/cost-basis`,
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return r.animal;
}

export function spendingCsvUrl(year: number): string {
  return `/api/barn/spending/export.csv?year=${year}`;
}

export function formatUsdCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function formatCategoryLabel(cat: ExpenseCategory): string {
  switch (cat) {
    case "feed":       return "Feed";
    case "tack":       return "Tack";
    case "vet":        return "Vet";
    case "board":      return "Board";
    case "farrier":    return "Farrier";
    case "supplement": return "Supplement";
    case "travel":     return "Travel";
    case "show":       return "Show";
    case "other":      return "Other";
  }
}

// ---------- Subscription / Barn Mode entitlement (Module 05) ----------

export type SubscriptionTier = "free" | "barn_mode";
export type SubscriptionStatus =
  | "active" | "trialing" | "past_due" | "cancelled" | "paused";
export type CompSource = "silver_lining_sns" | "promo_code" | "manual_grant";

export interface SubscriptionRow {
  id: string;
  owner_id: string;
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  comp_source: CompSource | null;
  comp_campaign: string | null;
  comp_expires_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface SilverLiningLinkRow {
  id: string;
  owner_id: string;
  silver_lining_customer_id: string;
  linked_at: string;
  last_verified_at: string | null;
  last_verification_status:
    | "active" | "cancelled" | "paused" | "not_found" | "error" | null;
  sticky_until: string;
  stripe_payment_method_id: string | null;
}

export type EntitlementEventType =
  | "granted" | "revoked" | "converted" | "cancelled"
  | "comp_attached" | "comp_detached" | "grace_started" | "grace_expired";

export interface EntitlementEvent {
  event: EntitlementEventType;
  reason: string | null;
  source: string;
  prev_tier: string | null;
  next_tier: string | null;
  prev_comp_source: string | null;
  next_comp_source: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SubscriptionSnapshot {
  subscription: SubscriptionRow | null;
  horse_count: number;
  on_barn_mode: boolean;
  silver_lining: SilverLiningLinkRow | null;
  entitlement_events: EntitlementEvent[];
  stripe_configured: boolean;
}

export async function getSubscription(): Promise<SubscriptionSnapshot> {
  return workerFetch<SubscriptionSnapshot>("/api/barn/subscription", { method: "GET" });
}

export async function startBarnModeCheckout(input: {
  success_url: string;
  cancel_url: string;
}): Promise<{ checkout_url: string; session_id: string }> {
  return workerFetch<{ checkout_url: string; session_id: string }>(
    "/api/barn/subscription/checkout",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function openBillingPortal(input: {
  return_url: string;
}): Promise<{ portal_url: string }> {
  return workerFetch<{ portal_url: string }>(
    "/api/barn/subscription/portal",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function redeemPromoCode(code: string): Promise<{
  ok: true;
  comp_expires_at: string;
  months_granted: number;
}> {
  return workerFetch<{ ok: true; comp_expires_at: string; months_granted: number }>(
    "/api/barn/subscription/promo-redeem",
    { method: "POST", body: JSON.stringify({ code }) }
  );
}

export async function silverLiningStatus(): Promise<{ link: SilverLiningLinkRow | null }> {
  return workerFetch<{ link: SilverLiningLinkRow | null }>(
    "/api/barn/silver-lining/status",
    { method: "GET" }
  );
}

export async function silverLiningUnlink(): Promise<{ ok: true }> {
  return workerFetch<{ ok: true }>(
    "/api/barn/silver-lining/unlink",
    { method: "POST", body: "{}" }
  );
}

// ---------- Admin promo codes (Module 05.07) ----------

export interface AdminPromoCode {
  id: string;
  code: string;
  campaign: string;
  grants_barn_mode_months: number;
  single_use: boolean;
  expires_at: string | null;
  redeemed_at: string | null;
  redeemed_by: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export async function listAdminPromoCodes(
  campaign?: string
): Promise<AdminPromoCode[]> {
  const qp = campaign ? `?campaign=${encodeURIComponent(campaign)}` : "";
  const r = await workerFetch<{ codes: AdminPromoCode[] }>(
    `/api/admin/promo-codes${qp}`
  );
  return r.codes;
}

export interface CreateAdminPromoCodesInput {
  campaign: string;
  grants_barn_mode_months: number;
  count: number;
  single_use?: boolean;
  notes?: string | null;
  expires_at?: string | null;
}

export async function createAdminPromoCodes(
  input: CreateAdminPromoCodesInput
): Promise<AdminPromoCode[]> {
  const r = await workerFetch<{ codes: AdminPromoCode[] }>(
    "/api/admin/promo-codes",
    { method: "POST", body: JSON.stringify(input) }
  );
  return r.codes;
}
