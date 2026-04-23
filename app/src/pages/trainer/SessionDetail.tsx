import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, Clock, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArchiveSessionDialog } from "@/components/trainer/ArchiveSessionDialog";
import { ExpenseForm } from "@/components/expenses/ExpenseForm";
import { ExpensesList } from "@/components/expenses/ExpensesList";

import {
  SESSIONS_QUERY_KEY,
  formatCents,
  formatDurationMinutes,
  formatStartedAt,
  getSession,
  sessionStatusLabel,
  sessionTypeLabel,
} from "@/lib/sessions";
import {
  EXPENSES_QUERY_KEY,
  listExpensesForSession,
} from "@/lib/expenses";
import type { SessionStatus } from "@/lib/database.types";

// SessionDetail — /trainer/sessions/:id.
//
// Trainer view of a logged session. Includes an expenses panel so the
// trainer can attach incidental costs (supplies ordered, treatments, etc.)
// directly to this session — visible to the owner on their approve-and-pay
// view.
export default function SessionDetail() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const [addingExpense, setAddingExpense] = useState(false);

  const q = useQuery({
    queryKey: [...SESSIONS_QUERY_KEY, id],
    queryFn: () => getSession(id),
    enabled: Boolean(id),
    retry: false,
  });

  const expensesQ = useQuery({
    queryKey: [...EXPENSES_QUERY_KEY, "session", id],
    queryFn: () => listExpensesForSession(id),
    enabled: Boolean(id) && q.isSuccess,
  });

  return (
    <div className="space-y-6">
      <Link
        to="/trainer/sessions"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Sessions
      </Link>

      {q.isLoading && (
        <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
      )}

      {q.isError && (
        <Card>
          <CardHeader>
            <CardTitle>We couldn't load this session.</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            It may have been archived or your access may have been revoked.
          </CardContent>
        </Card>
      )}

      {q.isSuccess && (
        <>
          <header className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <h1 className="font-display text-3xl text-primary">{q.data.title}</h1>
                <p className="text-sm text-muted-foreground">
                  {[
                    sessionTypeLabel(q.data.session_type),
                    q.data.animal_barn_name,
                    formatStartedAt(q.data.started_at),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <StatusBadge status={q.data.status} />
            </div>
          </header>

          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 text-sm">
              <Detail
                label="Duration"
                value={formatDurationMinutes(q.data.duration_minutes)}
                icon={<Clock size={14} className="text-muted-foreground" />}
              />
              <Detail
                label="Price"
                value={formatCents(q.data.trainer_price_cents) ?? "—"}
              />
              <Detail label="Status" value={sessionStatusLabel(q.data.status)} />
              <Detail
                label="Animal"
                value={
                  q.data.animal_barn_name ? (
                    <Link
                      to={`/trainer/animals/${q.data.animal_id}`}
                      className="text-primary hover:underline"
                    >
                      {q.data.animal_barn_name}
                    </Link>
                  ) : (
                    "—"
                  )
                }
              />
            </CardContent>
          </Card>

          {q.data.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm text-foreground">
                {q.data.notes}
              </CardContent>
            </Card>
          )}

          {/* Expenses tied to this session */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle>Session expenses</CardTitle>
              {!addingExpense && (
                <Button size="sm" onClick={() => setAddingExpense(true)}>
                  <Plus size={14} className="mr-1" />
                  Add expense
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {addingExpense && (
                <div className="rounded-md border border-accent/40 bg-accent/5 p-4">
                  <ExpenseForm
                    animalId={q.data.animal_id}
                    recorderRole="trainer"
                    sessionId={id}
                    onCreated={() => {
                      setAddingExpense(false);
                      queryClient.invalidateQueries({
                        queryKey: [...EXPENSES_QUERY_KEY, "session", id],
                      });
                    }}
                    onCancel={() => setAddingExpense(false)}
                  />
                </div>
              )}

              {expensesQ.isLoading && (
                <div className="h-16 animate-pulse rounded-md bg-muted/40" />
              )}
              {expensesQ.isError && (
                <p className="text-sm text-destructive">
                  Couldn't load expenses. Try refreshing.
                </p>
              )}
              {expensesQ.isSuccess && (
                <ExpensesList
                  expenses={expensesQ.data}
                  showAnimal={false}
                  emptyText="No expenses logged for this session yet."
                />
              )}
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button asChild variant="outline">
              <Link to={`/trainer/animals/${q.data.animal_id}`}>
                View animal
              </Link>
            </Button>
            {q.data.archived_at == null && q.data.status === "logged" && (
              <ArchiveSessionDialog
                sessionId={q.data.id}
                sessionTitle={q.data.title}
              />
            )}
          </div>
        </>
      )}
    </div>
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

function Detail({
  label,
  value,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="flex items-center gap-1.5 text-foreground">
        {icon}
        {value}
      </p>
    </div>
  );
}
