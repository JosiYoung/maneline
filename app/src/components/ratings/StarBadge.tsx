import { useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  RATING_AGGREGATE_MIN_SAMPLE,
  USER_RATING_SUMMARY_QUERY_KEY,
  getUserRatingSummary,
} from "@/lib/ratings";

// StarBadge — public rating summary for a user (owner or trainer).
// Uber-style: hides the numeric average until n >= 3 to avoid jumpy
// one-sample scores. Before that threshold shows a "New" badge.

export function StarBadge({
  userId,
  className,
}: {
  userId: string;
  className?: string;
}) {
  const q = useQuery({
    queryKey: USER_RATING_SUMMARY_QUERY_KEY(userId),
    queryFn: () => getUserRatingSummary(userId),
    enabled: Boolean(userId),
    staleTime: 60_000,
  });

  if (q.isLoading || q.isError || !q.data) {
    return null;
  }

  const { avg_stars, rating_count } = q.data;

  if (rating_count < RATING_AGGREGATE_MIN_SAMPLE || avg_stars == null) {
    return (
      <Badge variant="outline" className={cn("gap-1", className)} aria-label="New — not enough ratings yet">
        <Star className="h-3 w-3" />
        New
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={cn("gap-1", className)}
      aria-label={`${avg_stars.toFixed(1)} of 5 stars, from ${rating_count} ratings`}
    >
      <Star className="h-3 w-3 fill-current" />
      {avg_stars.toFixed(1)}
      <span className="text-muted-foreground">({rating_count})</span>
    </Badge>
  );
}
