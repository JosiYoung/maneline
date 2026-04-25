import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, ChevronLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  WeekCalendar,
  addDays,
  isSameDay,
  startOfWeekSunday,
} from "@/components/barn/WeekCalendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { useAuthStore } from "@/lib/authStore";
import {
  BARN_EVENTS_QUERY_KEY,
  BARN_EVENT_DETAIL_QUERY_KEY,
  TRAINER_SCHEDULE_QUERY_KEY,
  attendeeStatusTone,
  formatAttendeeStatus,
  formatEventWhen,
  getEvent,
  listEvents,
  respondToEvent,
  type BarnEventAttendee,
  type EventListItem,
} from "@/lib/barn";

// MySchedule — /trainer/my-schedule.
//
// Mirror of the owner Barn Calendar, scoped by the Worker to only the
// events the trainer is an attendee on. Read-only for event data —
// trainer's only write surface is respond / counter-propose.

const RANGE_START_ISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString();
};
const RANGE_END_ISO = () => {
  const d = new Date();
  d.setDate(d.getDate() + 180);
  return d.toISOString();
};

export default function MySchedule() {
  const userId = useAuthStore((s) => s.session?.user.id) ?? null;
  const [openId, setOpenId] = useState<string | null>(null);

  const eventsQuery = useQuery({
    queryKey: [...TRAINER_SCHEDULE_QUERY_KEY, userId] as const,
    queryFn: () =>
      listEvents({ start: RANGE_START_ISO(), end: RANGE_END_ISO() }),
    enabled: Boolean(userId),
  });

  const events = (eventsQuery.data ?? []).filter(
    (e): e is EventListItem => Boolean(e?.event?.start_at),
  );

  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeekSunday(new Date()),
  );
  const [view, setView] = useState<"week" | "day">("week");
  const [dayDate, setDayDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const dayItems = useMemo(
    () =>
      events
        .filter((e) => isSameDay(new Date(e.event.start_at), dayDate))
        .sort(
          (a, b) =>
            new Date(a.event.start_at).getTime() -
            new Date(b.event.start_at).getTime(),
        ),
    [events, dayDate],
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl text-primary">My schedule</h1>
        <p className="text-sm text-muted-foreground">
          Barn events where you've been invited. Tap one to confirm, decline,
          or propose a new time.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border bg-background p-0.5">
          <Button
            size="sm"
            variant={view === "week" ? "default" : "ghost"}
            className="h-7 px-3"
            onClick={() => setView("week")}
          >
            Week
          </Button>
          <Button
            size="sm"
            variant={view === "day" ? "default" : "ghost"}
            className="h-7 px-3"
            onClick={() => setView("day")}
          >
            Day
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            setDayDate(today);
            setWeekStart(startOfWeekSunday(today));
            setView("day");
          }}
        >
          My day
        </Button>
      </div>

      {view === "week" ? (
        <WeekCalendar
          weekStart={weekStart}
          events={events}
          selectedDate={dayDate}
          loading={eventsQuery.isLoading}
          onWeekStartChange={setWeekStart}
          onSelectDay={(date) => {
            setDayDate(date);
            setView("day");
          }}
          onOpenEvent={setOpenId}
        />
      ) : (
        <DayView
          date={dayDate}
          loading={eventsQuery.isLoading}
          items={dayItems}
          onPrevDay={() => setDayDate(addDays(dayDate, -1))}
          onNextDay={() => setDayDate(addDays(dayDate, 1))}
          onBack={() => setView("week")}
          onOpenEvent={setOpenId}
          empty="Nothing on your schedule this day."
        />
      )}

      <TrainerRespondDialog
        userId={userId}
        eventId={openId}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}

function DayView({
  date,
  loading,
  items,
  onPrevDay,
  onNextDay,
  onBack,
  onOpenEvent,
  empty,
}: {
  date: Date;
  loading: boolean;
  items: EventListItem[];
  onPrevDay: () => void;
  onNextDay: () => void;
  onBack: () => void;
  onOpenEvent: (id: string) => void;
  empty: string;
}) {
  const headline = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="ghost" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" /> Week
        </Button>
        <div className="text-sm font-medium">{headline}</div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={onPrevDay} aria-label="Previous day">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={onNextDay} aria-label="Next day">
            <ChevronLeft className="h-4 w-4 rotate-180" />
          </Button>
        </div>
      </div>
      <ScheduleList
        loading={loading}
        items={items}
        empty={empty}
        onOpen={onOpenEvent}
      />
    </div>
  );
}

function ScheduleList({
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
                <div className="flex items-start gap-2">
                  <CalendarDays
                    className="mt-0.5 h-5 w-5 text-muted-foreground"
                    aria-hidden="true"
                  />
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
                </div>
                {item.event.status === "cancelled" && (
                  <Badge variant="destructive">Cancelled</Badge>
                )}
              </CardContent>
            </Card>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TrainerRespondDialog({
  userId,
  eventId,
  onClose,
}: {
  userId: string | null;
  eventId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: eventId
      ? BARN_EVENT_DETAIL_QUERY_KEY(eventId)
      : ["barn_event_detail", "none"],
    queryFn: () => getEvent(eventId!),
    enabled: Boolean(eventId),
  });

  const [counterStart, setCounterStart] = useState("");
  const [counterNote, setCounterNote] = useState("");
  const [mode, setMode] = useState<"idle" | "counter">("idle");

  const myAttendee: BarnEventAttendee | null = useMemo(() => {
    if (!detailQ.data || !userId) return null;
    return (
      detailQ.data.attendees.find((a) => a.linked_user_id === userId) ?? null
    );
  }, [detailQ.data, userId]);

  const respond = useMutation({
    mutationFn: async (
      response: "confirmed" | "declined" | "countered"
    ) => {
      if (!eventId || !myAttendee) throw new Error("Not an invitee.");
      return respondToEvent(eventId, {
        attendee_id: myAttendee.id,
        status: response,
        counter_start_at:
          response === "countered" && counterStart
            ? new Date(counterStart).toISOString()
            : null,
        response_note:
          response === "countered" && counterNote.trim()
            ? counterNote.trim()
            : null,
      });
    },
    onSuccess: () => {
      notify.success("Response sent");
      if (eventId) {
        qc.invalidateQueries({ queryKey: BARN_EVENT_DETAIL_QUERY_KEY(eventId) });
      }
      qc.invalidateQueries({ queryKey: TRAINER_SCHEDULE_QUERY_KEY });
      qc.invalidateQueries({ queryKey: BARN_EVENTS_QUERY_KEY });
      setMode("idle");
      setCounterStart("");
      setCounterNote("");
      onClose();
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
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {data && (
          <div className="space-y-4">
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

            {myAttendee ? (
              <div className="space-y-3 rounded-md border border-border bg-muted/40 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">Your status</span>
                  <Badge
                    variant={attendeeStatusTone(myAttendee.current_status)}
                  >
                    {formatAttendeeStatus(myAttendee.current_status)}
                  </Badge>
                </div>

                {data.event.status === "scheduled" && mode === "idle" && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => respond.mutate("confirmed")}
                      disabled={respond.isPending}
                    >
                      Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setMode("counter")}
                      disabled={respond.isPending}
                    >
                      Propose new time
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => respond.mutate("declined")}
                      disabled={respond.isPending}
                    >
                      Decline
                    </Button>
                  </div>
                )}

                {mode === "counter" && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label htmlFor="ms-counter-start">
                        Proposed start time
                      </Label>
                      <Input
                        id="ms-counter-start"
                        type="datetime-local"
                        value={counterStart}
                        onChange={(e) => setCounterStart(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="ms-counter-note">Note (optional)</Label>
                      <Textarea
                        id="ms-counter-note"
                        rows={2}
                        value={counterNote}
                        onChange={(e) => setCounterNote(e.target.value)}
                        maxLength={500}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => respond.mutate("countered")}
                        disabled={respond.isPending || !counterStart}
                      >
                        {respond.isPending && (
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                        )}
                        Send proposal
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMode("idle")}
                        disabled={respond.isPending}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                You're not listed as an invitee on this event.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
