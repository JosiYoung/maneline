import { Link } from "react-router-dom";
import { ArrowRight, Clock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  formatCents,
  formatDurationMinutes,
  formatStartedAt,
  sessionStatusLabel,
  sessionTypeLabel,
  type TrainingSessionWithAnimal,
} from "@/lib/sessions";
import type { SessionStatus } from "@/lib/database.types";

// SessionsList — shared between /trainer/sessions, the trainer
// AnimalReadOnly Sessions tab, and the owner AnimalDetail page. Link
// target varies by caller so trainers land on the editable detail page
// and owners land on the approve-and-pay page (Prompt 2.7).

type Props = {
  sessions: TrainingSessionWithAnimal[];
  /** When present, each row is rendered as a link. */
  detailHref?: (sessionId: string) => string;
  emptyText?: string;
  showAnimal?: boolean;
};

export function SessionsList({
  sessions,
  detailHref,
  emptyText = "No sessions logged yet.",
  showAnimal = true,
}: Props) {
  if (sessions.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          {emptyText}
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-3">
      {sessions.map((s) => {
        const body = (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-medium">{s.title}</p>
                <StatusBadge status={s.status} />
                {s.archived_at && <Badge variant="outline">Archived</Badge>}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {[
                  sessionTypeLabel(s.session_type),
                  showAnimal && s.animal_barn_name,
                  formatStartedAt(s.started_at),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock size={12} />
                {formatDurationMinutes(s.duration_minutes)}
                {s.trainer_price_cents != null && (
                  <>
                    <span aria-hidden>·</span>
                    <span>{formatCents(s.trainer_price_cents)}</span>
                  </>
                )}
                {s.trainer_display_name && (
                  <>
                    <span aria-hidden>·</span>
                    <span className="truncate">{s.trainer_display_name}</span>
                  </>
                )}
              </p>
            </div>
            {detailHref && (
              <ArrowRight
                size={16}
                className="mt-1 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              />
            )}
          </div>
        );
        return (
          <li key={s.id}>
            {detailHref ? (
              <Link
                to={detailHref(s.id)}
                className="group block rounded-md border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                {body}
              </Link>
            ) : (
              <div className="rounded-md border border-border bg-card p-4">
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function StatusBadge({ status }: { status: SessionStatus }) {
  const label = sessionStatusLabel(status);
  if (status === "logged")   return <Badge>{label}</Badge>;
  if (status === "approved") return <Badge variant="secondary">{label}</Badge>;
  if (status === "paid") {
    return (
      <Badge className="bg-accent text-accent-foreground hover:bg-accent/90">
        {label}
      </Badge>
    );
  }
  return <Badge variant="destructive">{label}</Badge>;
}
