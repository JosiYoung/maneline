import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ExternalLink, FileText, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArchiveAnimalDialog } from "@/components/owner/ArchiveAnimalDialog";
import { RecordsUploadDialog } from "@/components/owner/RecordsUploadDialog";
import { ShareRecordDialog } from "@/components/owner/ShareRecordDialog";
import {
  ANIMALS_QUERY_KEY,
  getAnimal,
  unarchiveAnimal,
  type Animal,
} from "@/lib/animals";
import {
  VET_RECORDS_QUERY_KEY,
  listVetRecordsWithKeys,
  type VetRecordType,
} from "@/lib/vetRecords";
import { readUrlFor } from "@/lib/uploads";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { SessionsList } from "@/components/trainer/SessionsList";
import {
  SESSIONS_QUERY_KEY,
  listSessionsForAnimal,
} from "@/lib/sessions";
import { ExpensesList } from "@/components/expenses/ExpensesList";
import { ExpenseForm } from "@/components/expenses/ExpenseForm";
import {
  EXPENSES_QUERY_KEY,
  listExpensesForAnimal,
} from "@/lib/expenses";
import { ProtocolsSection } from "@/components/owner/ProtocolsSection";

// AnimalDetail — /app/animals/:id
//
// Read-only summary with an Edit CTA, and either an Archive button
// (active animals) or an Unarchive button (archived animals). Record
// upload and history live in 1.6 and show up under this same page.
export default function AnimalDetail() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, id],
    queryFn: () => getAnimal(id),
    enabled: Boolean(id),
  });

  const unarchive = useMutation({
    mutationFn: () => unarchiveAnimal(id),
    onSuccess: (animal) => {
      queryClient.invalidateQueries({ queryKey: ANIMALS_QUERY_KEY });
      notify.success(`${animal.barn_name} restored.`);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <div className="space-y-6">
      <Link
        to="/app/animals"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Animals
      </Link>

      {query.isLoading ? (
        <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : query.isError || !query.data ? (
        <Card>
          <CardHeader>
            <CardTitle>We couldn't load this animal.</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            It may have been archived or you may not have access.
          </CardContent>
        </Card>
      ) : (
        <>
          <AnimalSummary
            animal={query.data}
            onUnarchive={() => unarchive.mutate()}
            unarchiving={unarchive.isPending}
          />
          {query.data.archived_at == null ? (
            <>
              <RecentRecords animalId={query.data.id} animalName={query.data.barn_name} />
              <ProtocolsSection animalId={query.data.id} role="owner" />
              <SessionsSection animalId={query.data.id} />
              <ExpensesSection animalId={query.data.id} />
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function SessionsSection({ animalId }: { animalId: string }) {
  // Owner-side session feed. RLS scopes rows to owner_id = auth.uid().
  // Owners don't create sessions — trainers do — so there's no "log"
  // CTA here. Approve-and-pay lands in Prompt 2.7.
  const q = useQuery({
    queryKey: [...SESSIONS_QUERY_KEY, "animal", animalId],
    queryFn: () => listSessionsForAnimal(animalId),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <div className="h-20 animate-pulse rounded-md bg-muted/40" />
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            Couldn't load sessions. Try refreshing the page.
          </p>
        ) : (
          <SessionsList
            sessions={q.data ?? []}
            emptyText="No training sessions logged on this animal yet."
            showAnimal={false}
            detailHref={(sid) => `/app/sessions/${sid}/pay`}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ExpensesSection({ animalId }: { animalId: string }) {
  const [adding, setAdding] = useState(false);

  const q = useQuery({
    queryKey: [...EXPENSES_QUERY_KEY, "animal", animalId],
    queryFn: () => listExpensesForAnimal(animalId, { includeArchived: true }),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Expenses</CardTitle>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add expense
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {adding && (
          <Card className="border-accent/40 bg-accent/5">
            <CardContent className="py-4">
              <ExpenseForm
                animalId={animalId}
                recorderRole="owner"
                onCreated={() => setAdding(false)}
                onCancel={() => setAdding(false)}
              />
            </CardContent>
          </Card>
        )}

        {q.isLoading ? (
          <div className="h-20 animate-pulse rounded-md bg-muted/40" />
        ) : q.isError ? (
          <p className="text-sm text-destructive">
            Couldn't load expenses. Try refreshing the page.
          </p>
        ) : (
          <ExpensesList
            expenses={q.data ?? []}
            showAnimal={false}
            emptyText="No expenses logged on this animal yet."
          />
        )}
      </CardContent>
    </Card>
  );
}

function RecentRecords({
  animalId,
  animalName,
}: {
  animalId: string;
  animalName: string;
}) {
  const recordsQuery = useQuery({
    queryKey: [...VET_RECORDS_QUERY_KEY, { animalId, limit: 5 }],
    queryFn: () => listVetRecordsWithKeys({ animalId, limit: 5 }),
  });

  const records = recordsQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Recent records</CardTitle>
        <div className="flex items-center gap-2">
          <RecordsUploadDialog initialAnimalId={animalId} />
          <ShareRecordDialog animalId={animalId} />
          <Button asChild size="sm" variant="outline">
            <Link to={`/app/records?animal=${animalId}`}>See all</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {recordsQuery.isLoading ? (
          <div className="h-24 animate-pulse rounded-md bg-muted/40" />
        ) : records.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No records on file yet. Upload the first Coggins or vaccine cert
            for {animalName} to get started.
          </p>
        ) : (
          <ul className="space-y-2">
            {records.map((r) => (
              <RecentRecordRow key={r.id} record={r} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function RecentRecordRow({
  record,
}: {
  record: {
    id: string;
    record_type: VetRecordType;
    issued_on: string | null;
    expires_on: string | null;
    issuing_provider: string | null;
    object_key: string | null;
  };
}) {
  const view = useMutation({
    mutationFn: async () => {
      if (!record.object_key) throw new Error("File missing");
      const { get_url } = await readUrlFor(record.object_key);
      window.open(get_url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <FileText size={16} className="shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{cap(record.record_type)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              record.issued_on && `Issued ${fmt(record.issued_on)}`,
              record.expires_on && `Expires ${fmt(record.expires_on)}`,
              record.issuing_provider,
            ]
              .filter(Boolean)
              .join(" · ") || "No dates"}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => view.mutate()}
        disabled={view.isPending || !record.object_key}
      >
        <ExternalLink size={14} />
      </Button>
    </li>
  );
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function AnimalSummary({
  animal,
  onUnarchive,
  unarchiving,
}: {
  animal: Animal;
  onUnarchive: () => void;
  unarchiving: boolean;
}) {
  const archived = animal.archived_at != null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-primary">{animal.barn_name}</h1>
          <p className="text-sm text-muted-foreground">
            {[animal.species, animal.breed, animal.sex]
              .filter(Boolean)
              .join(" · ") || "No details yet"}
          </p>
        </div>
        {archived ? (
          <Badge variant="outline">Archived</Badge>
        ) : animal.year_born ? (
          <Badge variant="secondary">{animal.year_born}</Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <Detail label="Species" value={cap(animal.species)} />
          <Detail label="Breed" value={animal.breed ?? "—"} />
          <Detail label="Sex" value={animal.sex ? cap(animal.sex) : "—"} />
          <Detail label="Year born" value={animal.year_born?.toString() ?? "—"} />
          <Detail label="Discipline" value={animal.discipline ?? "—"} />
          <Detail
            label="Status"
            value={archived ? "Archived" : "Active"}
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {archived ? (
          <Button onClick={onUnarchive} disabled={unarchiving}>
            {unarchiving ? "Restoring…" : "Restore animal"}
          </Button>
        ) : (
          <>
            <Button asChild variant="outline">
              <Link to={`/app/animals/${animal.id}/edit`}>
                <Pencil size={16} />
                Edit
              </Link>
            </Button>
            <ArchiveAnimalDialog
              animalId={animal.id}
              animalName={animal.barn_name}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
