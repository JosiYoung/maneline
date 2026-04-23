import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { useAuthStore } from "@/lib/authStore";

import {
  HORSE_MESSAGES_QUERY_KEY,
  HORSE_MESSAGES_UNREAD_TOTAL_QUERY_KEY,
  listHorseMessages,
  markHorseMessagesRead,
  sendHorseMessage,
  type HorseMessage,
} from "@/lib/horseMessages";

// HorseMessageThread — async text chat scoped to a single animal.
// Mounted by both owner (BarnHealthAnimal) and trainer (AnimalReadOnly).
// RLS in migration 00028 handles access: any user with an active
// grant on the animal can post, and all thread participants see the
// same messages.

const MAX_BODY = 4000;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function HorseMessageThread({
  animalId,
  animalName,
}: {
  animalId: string;
  animalName: string;
}) {
  const qc = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const myUserId = session?.user.id ?? null;

  const listQ = useQuery({
    queryKey: [...HORSE_MESSAGES_QUERY_KEY, animalId],
    queryFn: () => listHorseMessages(animalId),
    enabled: Boolean(animalId),
    refetchInterval: 30_000,
  });

  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendM = useMutation({
    mutationFn: (body: string) => sendHorseMessage(animalId, body),
    onSuccess: (msg) => {
      setDraft("");
      qc.setQueryData<HorseMessage[]>(
        [...HORSE_MESSAGES_QUERY_KEY, animalId],
        (prev) => (prev ? [...prev, msg] : [msg]),
      );
      // Immediately mark our own send as "read" so unread count stays right.
      void markHorseMessagesRead(animalId).catch(() => {});
    },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Could not send message.");
    },
  });

  // Mark as read whenever the thread mounts or new messages arrive.
  const latestIso = listQ.data?.at(-1)?.created_at ?? null;
  useEffect(() => {
    if (!animalId || !listQ.isSuccess) return;
    markHorseMessagesRead(animalId)
      .then(() => {
        qc.invalidateQueries({ queryKey: HORSE_MESSAGES_UNREAD_TOTAL_QUERY_KEY });
      })
      .catch(() => {});
  }, [animalId, latestIso, listQ.isSuccess, qc]);

  // Scroll to bottom when messages change.
  useEffect(() => {
    if (!bottomRef.current) return;
    bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [listQ.data?.length]);

  const messages = listQ.data ?? [];
  const grouped = useMemo(() => groupByDay(messages), [messages]);

  const canSend = draft.trim().length > 0 && !sendM.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend) return;
    sendM.mutate(draft);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) sendM.mutate(draft);
    }
  }

  return (
    <Card className="flex flex-col" aria-label={`Messages about ${animalName}`}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div
          className="flex max-h-[480px] min-h-[200px] flex-col gap-3 overflow-y-auto pr-1"
          role="log"
          aria-live="polite"
        >
          {listQ.isLoading && (
            <p className="text-sm text-muted-foreground">Loading messages…</p>
          )}
          {listQ.isError && (
            <p className="text-sm text-destructive">
              Couldn't load messages. Try refreshing.
            </p>
          )}
          {listQ.isSuccess && messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No messages yet. Say hi — owners and trainers with access will
              see the same thread.
            </p>
          )}

          {grouped.map((group) => (
            <div key={group.dayKey} className="space-y-2">
              <div className="sticky top-0 z-10 flex justify-center">
                <span className="rounded-full bg-background/90 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {group.dayLabel}
                </span>
              </div>
              {group.items.map((m) => {
                const mine = m.sender_id === myUserId;
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "flex flex-col gap-0.5",
                      mine ? "items-end" : "items-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm",
                        mine
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-secondary text-foreground"
                      )}
                    >
                      {m.body}
                    </div>
                    <span className="px-1 text-[10px] text-muted-foreground">
                      {formatTime(m.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_BODY))}
            onKeyDown={handleKeyDown}
            placeholder={`Message about ${animalName}…`}
            rows={2}
            maxLength={MAX_BODY}
            className="min-h-[44px] resize-none"
            aria-label="New message"
          />
          <Button type="submit" disabled={!canSend} size="icon" aria-label="Send message">
            {sendM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function groupByDay(messages: HorseMessage[]) {
  const groups: { dayKey: string; dayLabel: string; items: HorseMessage[] }[] = [];
  for (const m of messages) {
    const d = new Date(m.created_at);
    const key = d.toISOString().slice(0, 10);
    let bucket = groups.at(-1);
    if (!bucket || bucket.dayKey !== key) {
      bucket = {
        dayKey: key,
        dayLabel: formatDayLabel(d),
        items: [],
      };
      groups.push(bucket);
    }
    bucket.items.push(m);
  }
  return groups;
}

function formatDayLabel(d: Date): string {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
  if (sameDay(d, now)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
