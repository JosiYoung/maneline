import { useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";

import { mapToUserMessage } from "@/lib/errors";
import {
  formatEventWhen,
  publicGetEvent,
  publicRespond,
  type AttendeeStatus,
} from "@/lib/barn";

// PublicEventAccept — /e/:token.
//
// Anonymous confirm / decline / counter surface. Token-gated; no portal
// chrome. Worker enforces rate limits + expiry + status gates.

export default function PublicEventAccept() {
  const { token = "" } = useParams<{ token: string }>();
  const hasToken = token.length > 0;

  const q = useQuery({
    queryKey: ["public_event", token],
    queryFn: () => publicGetEvent(token),
    enabled: hasToken,
    retry: false,
  });

  const [done, setDone] = useState<null | {
    response: "confirmed" | "declined" | "countered";
    currentStatus: AttendeeStatus;
  }>(null);
  const [mode, setMode] = useState<"idle" | "counter">("idle");
  const [counterStart, setCounterStart] = useState("");
  const [counterNote, setCounterNote] = useState("");

  const respond = useMutation({
    mutationFn: async (
      response: "confirmed" | "declined" | "countered"
    ) => {
      return publicRespond(token, {
        response,
        countered_start_at:
          response === "countered" && counterStart
            ? new Date(counterStart).toISOString()
            : null,
        countered_note:
          response === "countered" && counterNote.trim()
            ? counterNote.trim()
            : null,
      });
    },
    onSuccess: (r, variables) => {
      setDone({ response: variables, currentStatus: r.current_status });
    },
  });

  function submitCounter(e: FormEvent) {
    e.preventDefault();
    if (!counterStart) return;
    respond.mutate("countered");
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-10 space-y-6">
      <header className="space-y-1 border-b border-border pb-4">
        <div className="font-display text-2xl text-primary">Mane Line</div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Barn event — respond
        </div>
      </header>

      {!hasToken && (
        <ErrorCard
          title="Link is missing its access code"
          body="Ask the horse owner to re-share the invitation."
        />
      )}

      {hasToken && q.isLoading && (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading invitation…
          </CardContent>
        </Card>
      )}

      {hasToken && q.isError && (
        <ErrorCard
          title="Invitation unavailable"
          body={mapToUserMessage(q.error, "This link may have expired. Ask the owner to resend.")}
        />
      )}

      {q.data && !done && (
        <>
          <Card>
            <CardContent className="space-y-3 py-6">
              <div className="text-lg font-medium">{q.data.event.title}</div>
              <div className="text-sm text-muted-foreground">
                {formatEventWhen(
                  q.data.event.start_at,
                  q.data.event.duration_minutes
                )}
              </div>
              {q.data.event.location_text && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Location: </span>
                  {q.data.event.location_text}
                </div>
              )}
              {q.data.event.notes && (
                <>
                  <Separator />
                  <p className="whitespace-pre-wrap text-sm">
                    {q.data.event.notes}
                  </p>
                </>
              )}
              {q.data.owner_display_name && (
                <div className="text-xs text-muted-foreground">
                  Invited by {q.data.owner_display_name}
                </div>
              )}
            </CardContent>
          </Card>

          {q.data.event.status === "cancelled" ? (
            <ErrorCard
              title="Event cancelled"
              body="The owner cancelled this event. No response needed."
            />
          ) : mode === "counter" ? (
            <form onSubmit={submitCounter} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="pub-counter-start">Propose a new start time</Label>
                <Input
                  id="pub-counter-start"
                  type="datetime-local"
                  value={counterStart}
                  onChange={(e) => setCounterStart(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="pub-counter-note">Note (optional)</Label>
                <Textarea
                  id="pub-counter-note"
                  rows={3}
                  value={counterNote}
                  onChange={(e) => setCounterNote(e.target.value)}
                  maxLength={500}
                  placeholder="Sorry, running behind on my route — does this time work?"
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={respond.isPending || !counterStart}>
                  {respond.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Send proposal
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setMode("idle")}
                  disabled={respond.isPending}
                >
                  Back
                </Button>
              </div>
              {respond.isError && (
                <p className="text-sm text-destructive">
                  {mapToUserMessage(respond.error)}
                </p>
              )}
            </form>
          ) : (
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => respond.mutate("confirmed")}
                disabled={respond.isPending}
              >
                {respond.isPending && (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                )}
                Confirm attendance
              </Button>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setMode("counter")}
                disabled={respond.isPending}
              >
                Propose a new time
              </Button>
              <Button
                variant="ghost"
                className="w-full text-destructive hover:text-destructive"
                onClick={() => respond.mutate("declined")}
                disabled={respond.isPending}
              >
                Can't make it
              </Button>
              {respond.isError && (
                <p className="text-sm text-destructive">
                  {mapToUserMessage(respond.error)}
                </p>
              )}
            </div>
          )}
        </>
      )}

      {done && (
        <Card>
          <CardContent className="space-y-3 py-8 text-center">
            {done.response === "declined" ? (
              <XCircle className="mx-auto h-10 w-10 text-muted-foreground" />
            ) : (
              <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
            )}
            <div className="font-medium">
              {done.response === "confirmed" && "You're confirmed — thank you."}
              {done.response === "declined" && "Response recorded. The owner has been notified."}
              {done.response === "countered" && "Proposal sent. The owner will review."}
            </div>
            <p className="text-sm text-muted-foreground">
              Mane Line keeps every barn visit one click away. Want your own
              barn on Mane Line?{" "}
              <a
                href="https://maneline.co"
                className="underline hover:text-foreground"
              >
                Learn more
              </a>
              .
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="space-y-2 py-6">
        <div className="font-medium">{title}</div>
        <p className="text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}
