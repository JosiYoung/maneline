import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Loader2, Plus, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ANIMALS_QUERY_KEY, listAnimals, type Animal } from "@/lib/animals";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  BARN_EVENTS_QUERY_KEY,
  BARN_EVENT_DETAIL_QUERY_KEY,
  PRO_CONTACTS_QUERY_KEY,
  attendeeStatusTone,
  cancelEvent,
  createEvent,
  formatAttendeeStatus,
  formatEventWhen,
  formatHerdHealthRecordType,
  getEvent,
  listEvents,
  listProContacts,
  respondToEvent,
  type AttendeeInput,
  type BarnEventAttendee,
  type EventListItem,
  type HerdHealthRecordType,
  type ProContact,
} from "@/lib/barn";
import { BarnSubNav } from "@/components/owner/BarnSubNav";

// BarnCalendar — /app/barn/calendar.
//
// Phase 8 Module 01 owner surface. Lists upcoming + past barn events in
// three views (upcoming / past / all), opens a create dialog and a
// per-event detail dialog with attendee chips + counter-respond flow.
//
// Writes fan out through /api/barn/events (Worker) so we get atomic
// attendee inserts + reminder log writes + audit.

const RANGE_START_ISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
};
const RANGE_END_ISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 365);
  return d.toISOString();
};

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(v: string): string {
  // `new Date("2026-05-01T09:00")` parses as local time, which is what
  // the user meant. toISOString then converts to UTC for the DB.
  return new Date(v).toISOString();
}

export type CreateEventPrefill = {
  title?: string;
  animalIds?: string[];
  source?: string;
};

export default function BarnCalendar() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [openCreate, setOpenCreate] = useState(false);
  const [openDetailId, setOpenDetailId] = useState<string | null>(null);
  const [prefill, setPrefill] = useState<CreateEventPrefill | null>(null);

  const eventsQuery = useQuery({
    queryKey: [...BARN_EVENTS_QUERY_KEY, "range"] as const,
    queryFn: () =>
      listEvents({ start: RANGE_START_ISO(), end: RANGE_END_ISO() }),
  });

  const animalsQuery = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }] as const,
    queryFn: () => listAnimals({ includeArchived: false }),
  });

  const contactsQuery = useQuery({
    queryKey: PRO_CONTACTS_QUERY_KEY,
    queryFn: () => listProContacts({}),
  });

  // Read `?prefill=health&animal=<id>&type=<record_type>` from Herd Health's
  // Schedule button and auto-open the create dialog with sensible defaults.
  useEffect(() => {
    if (searchParams.get("prefill") !== "health") return;
    const animalId = searchParams.get("animal");
    const recordType = searchParams.get("type") as HerdHealthRecordType | null;
    const title = recordType
      ? `${formatHerdHealthRecordType(recordType)} — scheduled`
      : undefined;
    setPrefill({
      title,
      animalIds: animalId ? [animalId] : [],
      source: "herd_health_dashboard",
    });
    setOpenCreate(true);
    const next = new URLSearchParams(searchParams);
    next.delete("prefill");
    next.delete("animal");
    next.delete("type");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const events = (eventsQuery.data ?? []).filter(
    (e): e is EventListItem => Boolean(e?.event?.start_at),
  );
  const now = Date.now();
  const upcoming = useMemo(
    () =>
      events
        .filter((e) => new Date(e.event.start_at).getTime() >= now)
        .sort(
          (a, b) =>
            new Date(a.event.start_at).getTime() -
            new Date(b.event.start_at).getTime()
        ),
    [events, now]
  );
  const past = useMemo(
    () =>
      events
        .filter((e) => new Date(e.event.start_at).getTime() < now)
        .sort(
          (a, b) =>
            new Date(b.event.start_at).getTime() -
            new Date(a.event.start_at).getTime()
        ),
    [events, now]
  );

  return (
    <div className="space-y-6">
      <BarnSubNav />
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-primary">Barn calendar</h1>
          <p className="text-sm text-muted-foreground">
            Schedule farriers, vets, and other visits. Invitees respond in one
            click — confirmations stamp to the horse's record.
          </p>
          <Link
            to="/app/barn/contacts"
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Users className="h-3 w-3" aria-hidden="true" />
            Manage professional contacts
          </Link>
        </div>
        <Button
          size="sm"
          onClick={() => setOpenCreate(true)}
          className="shrink-0"
        >
          <Plus className="mr-1 h-4 w-4" /> New event
        </Button>
      </header>

      <Tabs defaultValue="upcoming">
        <TabsList>
          <TabsTrigger value="upcoming">
            Upcoming
            {upcoming.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {upcoming.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="past">Past</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="mt-4">
          <EventList
            loading={eventsQuery.isLoading}
            items={upcoming}
            empty="No upcoming events. Create one to invite a farrier or vet."
            onOpen={setOpenDetailId}
          />
        </TabsContent>
        <TabsContent value="past" className="mt-4">
          <EventList
            loading={eventsQuery.isLoading}
            items={past}
            empty="No past events yet."
            onOpen={setOpenDetailId}
          />
        </TabsContent>
      </Tabs>

      <CreateEventDialog
        open={openCreate}
        onOpenChange={(v) => {
          setOpenCreate(v);
          if (!v) setPrefill(null);
        }}
        animals={animalsQuery.data ?? []}
        contacts={contactsQuery.data ?? []}
        prefill={prefill}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: BARN_EVENTS_QUERY_KEY });
        }}
      />

      <EventDetailDialog
        eventId={openDetailId}
        onClose={() => setOpenDetailId(null)}
        onMutated={() => {
          qc.invalidateQueries({ queryKey: BARN_EVENTS_QUERY_KEY });
        }}
      />
    </div>
  );
}

function EventList({
  loading,
  items,
  empty,
  onOpen,
}: {
  loading: boolean;
  items: EventListItem[];
  empty: string;
  onOpen: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {empty}
        </CardContent>
      </Card>
    );
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.event.id}>
          <button
            type="button"
            onClick={() => onOpen(item.event.id)}
            className="w-full text-left"
          >
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{item.event.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {formatEventWhen(
                      item.event.start_at,
                      item.event.duration_minutes
                    )}
                  </div>
                  {item.event.location_text && (
                    <div className="text-xs text-muted-foreground">
                      {item.event.location_text}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {item.event.status === "cancelled" && (
                    <Badge variant="destructive">Cancelled</Badge>
                  )}
                  {item.attendee_count > 0 && (
                    <Badge variant="outline">
                      {item.confirmed_count}/{item.attendee_count} confirmed
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------- Create dialog ----------

function CreateEventDialog({
  open,
  onOpenChange,
  animals,
  contacts,
  prefill,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  animals: Animal[];
  contacts: ProContact[];
  prefill: CreateEventPrefill | null;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [startLocal, setStartLocal] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() + 24, 0, 0, 0);
    return toLocalInputValue(d.toISOString());
  });
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [animalIds, setAnimalIds] = useState<string[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [adhocEmail, setAdhocEmail] = useState("");
  const [rrule, setRrule] = useState<string>("");

  useEffect(() => {
    if (!open || !prefill) return;
    if (prefill.title) setTitle(prefill.title);
    if (prefill.animalIds && prefill.animalIds.length > 0) {
      setAnimalIds(prefill.animalIds);
    }
  }, [open, prefill]);

  const reset = () => {
    setTitle("");
    setLocation("");
    setNotes("");
    setAnimalIds([]);
    setSelectedContactIds([]);
    setAdhocEmail("");
    setRrule("");
    setDuration(60);
  };

  const create = useMutation({
    mutationFn: async () => {
      const attendees: AttendeeInput[] = selectedContactIds.map((id) => ({
        pro_contact_id: id,
        delivery_channel: "email",
      }));
      if (adhocEmail.trim()) {
        attendees.push({
          email: adhocEmail.trim().toLowerCase(),
          delivery_channel: "email",
        });
      }
      return createEvent({
        title: title.trim(),
        start_at: fromLocalInputValue(startLocal),
        duration_minutes: duration,
        location_text: location.trim() || null,
        notes: notes.trim() || null,
        animal_ids: animalIds,
        attendees,
        rrule_text: rrule.trim() || null,
      });
    },
    onSuccess: () => {
      notify.success("Event created");
      onCreated();
      onOpenChange(false);
      reset();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      notify.error("Title is required.");
      return;
    }
    if (duration < 5 || duration > 720) {
      notify.error("Duration must be between 5 and 720 minutes.");
      return;
    }
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New barn event</DialogTitle>
          <DialogDescription>
            Schedule a farrier, vet, or other visit. Invitees receive an email
            with a one-click confirm / decline / counter-propose link.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="evt-title">Title</Label>
            <Input
              id="evt-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Farrier visit — trim + reset"
              required
              maxLength={200}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="evt-start">Start</Label>
              <Input
                id="evt-start"
                type="datetime-local"
                value={startLocal}
                onChange={(e) => setStartLocal(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="evt-duration">Duration (min)</Label>
              <Input
                id="evt-duration"
                type="number"
                min={5}
                max={720}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                required
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="evt-location">Location</Label>
            <Input
              id="evt-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Main barn / wash stall"
              maxLength={200}
            />
          </div>

          {animals.length > 0 && (
            <div className="space-y-1">
              <Label>Horses</Label>
              <div className="flex flex-wrap gap-2">
                {animals.map((a) => {
                  const on = animalIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() =>
                        setAnimalIds((prev) =>
                          on ? prev.filter((x) => x !== a.id) : [...prev, a.id]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      {a.barn_name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label>Invitees</Label>
            {contacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No saved contacts yet.{" "}
                <Link
                  to="/app/barn/contacts"
                  className="underline hover:text-foreground"
                >
                  Add one
                </Link>{" "}
                or enter an email below.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {contacts.map((c) => {
                  const on = selectedContactIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() =>
                        setSelectedContactIds((prev) =>
                          on ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                        )
                      }
                      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      {c.name}
                    </button>
                  );
                })}
              </div>
            )}
            <Input
              className="mt-2"
              type="email"
              value={adhocEmail}
              onChange={(e) => setAdhocEmail(e.target.value)}
              placeholder="Or add an ad-hoc email…"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="evt-rrule">Repeats (optional)</Label>
            <select
              id="evt-rrule"
              value={rrule}
              onChange={(e) => setRrule(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Does not repeat</option>
              <option value="FREQ=WEEKLY;INTERVAL=1">Weekly</option>
              <option value="FREQ=WEEKLY;INTERVAL=2">Every 2 weeks</option>
              <option value="FREQ=WEEKLY;INTERVAL=6">Every 6 weeks (farrier)</option>
              <option value="FREQ=MONTHLY;INTERVAL=1">Monthly</option>
              <option value="FREQ=YEARLY;INTERVAL=1">Yearly</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="evt-notes">Notes</Label>
            <Textarea
              id="evt-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Access code, gate instructions, special requests…"
              maxLength={2000}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={create.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              Create event
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Detail dialog ----------

function EventDetailDialog({
  eventId,
  onClose,
  onMutated,
}: {
  eventId: string | null;
  onClose: () => void;
  onMutated: () => void;
}) {
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: eventId ? BARN_EVENT_DETAIL_QUERY_KEY(eventId) : ["barn_event_detail", "none"],
    queryFn: () => getEvent(eventId!),
    enabled: Boolean(eventId),
  });

  const invalidate = () => {
    if (eventId) {
      qc.invalidateQueries({ queryKey: BARN_EVENT_DETAIL_QUERY_KEY(eventId) });
    }
    onMutated();
  };

  const cancel = useMutation({
    mutationFn: (reason?: string) =>
      eventId ? cancelEvent(eventId, reason ?? null) : Promise.reject(),
    onSuccess: () => {
      notify.success("Event cancelled");
      invalidate();
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const respond = useMutation({
    mutationFn: (input: {
      attendeeId: string;
      response: "confirmed" | "declined";
    }) =>
      eventId
        ? respondToEvent(eventId, {
            attendee_id: input.attendeeId,
            status: input.response,
          })
        : Promise.reject(),
    onSuccess: () => {
      notify.success("Response recorded");
      invalidate();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const data = detailQ.data;

  return (
    <Dialog open={Boolean(eventId)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.event.title ?? "Event"}</DialogTitle>
          <DialogDescription>
            {data
              ? formatEventWhen(data.event.start_at, data.event.duration_minutes)
              : "Loading…"}
          </DialogDescription>
        </DialogHeader>

        {detailQ.isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading details…
          </div>
        )}

        {data && (
          <div className="space-y-4">
            {data.event.status === "cancelled" && (
              <Badge variant="destructive">Cancelled</Badge>
            )}
            {data.event.location_text && (
              <p className="text-sm">
                <span className="text-muted-foreground">Location: </span>
                {data.event.location_text}
              </p>
            )}
            {data.event.notes && (
              <p className="whitespace-pre-wrap text-sm">
                {data.event.notes}
              </p>
            )}

            <div>
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Invitees
              </div>
              {data.attendees.length === 0 ? (
                <p className="text-sm text-muted-foreground">No invitees.</p>
              ) : (
                <ul className="space-y-2">
                  {data.attendees.map((a) => (
                    <AttendeeRow
                      key={a.id}
                      attendee={a}
                      onRespond={(response) =>
                        respond.mutate({ attendeeId: a.id, response })
                      }
                      respondPending={respond.isPending}
                    />
                  ))}
                </ul>
              )}
            </div>

            {data.event.status === "scheduled" && (
              <DialogFooter>
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (confirm("Cancel this event? Invitees will be notified.")) {
                      cancel.mutate(undefined);
                    }
                  }}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Cancel event
                </Button>
              </DialogFooter>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AttendeeRow({
  attendee,
  onRespond,
  respondPending,
}: {
  attendee: BarnEventAttendee;
  onRespond: (r: "confirmed" | "declined") => void;
  respondPending: boolean;
}) {
  const label = attendee.email ?? attendee.phone_e164 ?? "Invitee";
  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">
          {attendee.delivery_channel === "email_sms"
            ? "Email + SMS"
            : attendee.delivery_channel === "email"
              ? "Email"
              : "In-app"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={attendeeStatusTone(attendee.current_status)}>
          {formatAttendeeStatus(attendee.current_status)}
        </Badge>
        {attendee.current_status !== "confirmed" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => onRespond("confirmed")}
            disabled={respondPending}
          >
            Mark confirmed
          </Button>
        )}
        {attendee.current_status !== "declined" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRespond("declined")}
            disabled={respondPending}
            aria-label="Mark declined"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    </li>
  );
}
