import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { EventListItem } from "@/lib/barn";
import { cn } from "@/lib/utils";

// WeekCalendar — shared 7-day visual grid used by the owner Barn
// Calendar and the trainer My Schedule pages. Renders a Sun→Sat row
// of day cells with up to MAX_CHIPS event chips per day; clicking a
// cell drills into the page-level day view, clicking a chip opens the
// event detail dialog directly.

export const MAX_CHIPS = 3;

export type WeekCalendarProps = {
  /** Sunday at 00:00 local. Caller controls navigation. */
  weekStart: Date;
  /** All events the page already loaded; we filter inside. */
  events: EventListItem[];
  /** Currently-selected day in the page (for Day view); optional. */
  selectedDate?: Date | null;
  /** Callbacks. */
  onWeekStartChange: (next: Date) => void;
  onSelectDay: (date: Date) => void;
  onOpenEvent?: (eventId: string) => void;
  /** While the events query is loading. */
  loading?: boolean;
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function startOfWeekSunday(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatChipTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: d.getMinutes() === 0 ? undefined : "2-digit",
  });
}

function formatRangeLabel(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const sameMonth = weekStart.getMonth() === end.getMonth();
  const sameYear = weekStart.getFullYear() === end.getFullYear();
  const startFmt = weekStart.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
  const endFmt = end.toLocaleDateString(undefined, {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startFmt} – ${endFmt}`;
}

export function WeekCalendar({
  weekStart,
  events,
  selectedDate,
  onWeekStartChange,
  onSelectDay,
  onOpenEvent,
  loading,
}: WeekCalendarProps) {
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  // Bucket events into the 7 day columns. Cancelled events still
  // show up but visually muted so the user knows they happened.
  const days = useMemo(() => {
    const buckets: Array<{
      date: Date;
      items: EventListItem[];
    }> = [];
    for (let i = 0; i < 7; i++) {
      buckets.push({ date: addDays(weekStart, i), items: [] });
    }
    for (const it of events) {
      const start = new Date(it.event.start_at);
      for (const b of buckets) {
        if (isSameDay(b.date, start)) {
          b.items.push(it);
          break;
        }
      }
    }
    for (const b of buckets) {
      b.items.sort(
        (a, c) =>
          new Date(a.event.start_at).getTime() -
          new Date(c.event.start_at).getTime(),
      );
    }
    return buckets;
  }, [weekStart, events]);

  return (
    <Card>
      <CardContent className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-medium">{formatRangeLabel(weekStart)}</div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={() => onWeekStartChange(addDays(weekStart, -7))}
              aria-label="Previous week"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onWeekStartChange(startOfWeekSunday(new Date()))}
            >
              This week
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onWeekStartChange(addDays(weekStart, 7))}
              aria-label="Next week"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1">
          {DAY_LABELS.map((label, idx) => {
            const date = addDays(weekStart, idx);
            const isToday = isSameDay(date, today);
            const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
            return (
              <div
                key={label}
                className={cn(
                  "text-center text-[11px] font-medium uppercase tracking-wide",
                  isToday ? "text-primary" : "text-muted-foreground",
                  isSelected && "underline underline-offset-2",
                )}
              >
                {label}
              </div>
            );
          })}

          {days.map(({ date, items }) => {
            const isToday = isSameDay(date, today);
            const isSelected = selectedDate ? isSameDay(date, selectedDate) : false;
            const visible = items.slice(0, MAX_CHIPS);
            const overflow = items.length - visible.length;
            return (
              <button
                type="button"
                key={date.toISOString()}
                onClick={() => onSelectDay(date)}
                className={cn(
                  "flex min-h-24 flex-col items-stretch gap-1 rounded-md border p-1 text-left transition-colors hover:bg-muted/50 sm:min-h-32",
                  isToday && "ring-2 ring-primary/40",
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-background",
                )}
                aria-label={`Open ${date.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}`}
              >
                <div
                  className={cn(
                    "text-xs font-semibold",
                    isToday ? "text-primary" : "text-foreground",
                  )}
                >
                  {date.getDate()}
                </div>

                {loading ? (
                  <Skeleton className="h-3 w-full" />
                ) : (
                  <>
                    {visible.map((item) => {
                      const cancelled = item.event.status === "cancelled";
                      return (
                        <button
                          type="button"
                          key={item.event.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (onOpenEvent) onOpenEvent(item.event.id);
                            else onSelectDay(date);
                          }}
                          className={cn(
                            "truncate rounded px-1 py-0.5 text-left text-[11px] leading-tight",
                            cancelled
                              ? "bg-muted text-muted-foreground line-through"
                              : "bg-primary/10 text-primary hover:bg-primary/20",
                          )}
                          title={`${formatChipTime(item.event.start_at)} · ${item.event.title}`}
                        >
                          <span className="font-medium">
                            {formatChipTime(item.event.start_at)}
                          </span>{" "}
                          <span className="truncate">{item.event.title}</span>
                        </button>
                      );
                    })}
                    {overflow > 0 && (
                      <span className="px-1 text-[11px] text-muted-foreground">
                        +{overflow} more
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
