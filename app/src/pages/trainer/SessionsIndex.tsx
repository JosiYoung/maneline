import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SessionsList } from "@/components/trainer/SessionsList";
import { SESSIONS_QUERY_KEY, listMySessions } from "@/lib/sessions";

// SessionsIndex — /trainer/sessions.
//
// Every session the trainer has authored. RLS scopes by trainer_id; we
// filter out archived rows so the default view matches what the owner
// can see. A future tab can flip includeArchived for an audit view.
export default function SessionsIndex() {
  const q = useQuery({
    queryKey: [...SESSIONS_QUERY_KEY, "mine"],
    queryFn: () => listMySessions({ includeArchived: false }),
  });

  const sessions = q.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Sessions</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Every ride, groundwork session, and check-in you've logged
            across your clients.
          </p>
        </div>
        <Button asChild>
          <Link to="/trainer/sessions/new">
            <Plus size={16} />
            Log a session
          </Link>
        </Button>
      </header>

      {q.isLoading && (
        <ul className="space-y-3">
          {[0, 1, 2].map((i) => (
            <li
              key={i}
              className="h-24 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </ul>
      )}

      {q.isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Couldn't load your sessions. Try refreshing the page.
          </CardContent>
        </Card>
      )}

      {!q.isLoading && !q.isError && (
        <SessionsList
          sessions={sessions}
          detailHref={(id) => `/trainer/sessions/${id}`}
          emptyText="No sessions logged yet. Start with your next ride or groundwork."
        />
      )}
    </div>
  );
}
