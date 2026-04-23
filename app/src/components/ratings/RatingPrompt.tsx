import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { notify } from "@/lib/toast";
import { cn } from "@/lib/utils";

import {
  MY_RATING_FOR_SESSION_QUERY_KEY,
  USER_RATING_SUMMARY_QUERY_KEY,
  getMyRatingForSession,
  submitSessionRating,
} from "@/lib/ratings";

// RatingPrompt — shown on SessionDetail pages once the session is
// approved or paid. Each party sees this exactly once (per session);
// after submitting we show their locked-in rating.

export function RatingPrompt({
  sessionId,
  rateeId,
  rateeLabel,
  eligible,
}: {
  sessionId: string;
  rateeId: string;
  rateeLabel: string;
  /** session.status in ('approved','paid') — prompt is hidden otherwise */
  eligible: boolean;
}) {
  const qc = useQueryClient();
  const existing = useQuery({
    queryKey: MY_RATING_FOR_SESSION_QUERY_KEY(sessionId),
    queryFn: () => getMyRatingForSession(sessionId),
    enabled: Boolean(sessionId) && eligible,
  });

  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");

  const submitM = useMutation({
    mutationFn: () =>
      submitSessionRating({ sessionId, rateeId, stars, comment }),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: MY_RATING_FOR_SESSION_QUERY_KEY(sessionId),
      });
      qc.invalidateQueries({
        queryKey: USER_RATING_SUMMARY_QUERY_KEY(rateeId),
      });
      notify.success("Rating submitted. Thanks!");
    },
    onError: (err: unknown) => {
      notify.error(err instanceof Error ? err.message : "Could not submit rating.");
    },
  });

  if (!eligible) return null;
  if (existing.isLoading) return null;

  if (existing.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your rating</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Stars value={existing.data.stars} readOnly />
          {existing.data.comment && (
            <p className="text-sm text-muted-foreground">"{existing.data.comment}"</p>
          )}
          <p className="text-xs text-muted-foreground">
            Ratings are final — no edits after submit.
          </p>
        </CardContent>
      </Card>
    );
  }

  const canSubmit = stars >= 1 && stars <= 5 && !submitM.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate {rateeLabel}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Your rating is private to you and {rateeLabel}; only the average is
          shown on their profile.
        </p>
        <Stars
          value={stars}
          hover={hover}
          onChange={setStars}
          onHover={setHover}
        />
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value.slice(0, 1000))}
          placeholder={`Anything you'd like ${rateeLabel} to know? (optional)`}
          rows={3}
          maxLength={1000}
        />
        <Button onClick={() => submitM.mutate()} disabled={!canSubmit}>
          {submitM.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit rating
        </Button>
      </CardContent>
    </Card>
  );
}

function Stars({
  value,
  hover = 0,
  readOnly = false,
  onChange,
  onHover,
}: {
  value: number;
  hover?: number;
  readOnly?: boolean;
  onChange?: (n: number) => void;
  onHover?: (n: number) => void;
}) {
  const effective = hover || value;
  return (
    <div
      className="flex gap-1"
      role="radiogroup"
      aria-label="Stars"
      onMouseLeave={() => onHover?.(0)}
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= effective;
        return (
          <button
            key={n}
            type="button"
            disabled={readOnly}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            onMouseEnter={() => onHover?.(n)}
            onClick={() => onChange?.(n)}
            className={cn(
              "rounded p-1 transition-colors",
              !readOnly && "hover:text-primary"
            )}
          >
            <Star
              className={cn(
                "h-6 w-6",
                active ? "fill-primary text-primary" : "text-muted-foreground"
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
