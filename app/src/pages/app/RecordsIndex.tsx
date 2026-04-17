import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { FileText, ExternalLink, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { ANIMALS_QUERY_KEY, listAnimals, type Animal } from "@/lib/animals";
import {
  RECORD_TYPES,
  VET_RECORDS_QUERY_KEY,
  listVetRecordsWithKeys,
  type VetRecordType,
} from "@/lib/vetRecords";
import { readUrlFor } from "@/lib/uploads";
import { RecordsUploadDialog } from "@/components/owner/RecordsUploadDialog";

// RecordsIndex — /app/records
//
// Flat list of every vet_record the owner can read (RLS already
// enforces that). Filter row: animal + record_type. "View" opens a
// short-lived signed GET URL in a new tab.
export default function RecordsIndex() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedAnimalId = searchParams.get("animal") || "";
  const selectedType = (searchParams.get("type") as VetRecordType | "") || "";

  const animalsQuery = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }],
    queryFn: () => listAnimals({ includeArchived: false }),
  });

  const recordsQuery = useQuery({
    queryKey: [
      ...VET_RECORDS_QUERY_KEY,
      { animalId: selectedAnimalId, recordType: selectedType },
    ],
    queryFn: () =>
      listVetRecordsWithKeys({
        animalId: selectedAnimalId || undefined,
        recordType: (selectedType || undefined) as VetRecordType | undefined,
      }),
  });

  const animalsById = useMemo(() => {
    const m = new Map<string, Animal>();
    for (const a of animalsQuery.data ?? []) m.set(a.id, a);
    return m;
  }, [animalsQuery.data]);

  function updateFilter(key: "animal" | "type", value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const records = recordsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-primary">Records</h1>
          <p className="text-sm text-muted-foreground">
            Coggins, vaccines, dental, farrier — all in one place.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/app/records/export">
              <Download size={14} />
              Export PDF
            </Link>
          </Button>
          <RecordsUploadDialog initialAnimalId={selectedAnimalId || undefined} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <FilterSelect
          label="Animal"
          value={selectedAnimalId}
          onChange={(v) => updateFilter("animal", v)}
          options={[
            { value: "", label: "All animals" },
            ...(animalsQuery.data ?? []).map((a) => ({
              value: a.id,
              label: a.barn_name,
            })),
          ]}
        />
        <FilterSelect
          label="Type"
          value={selectedType}
          onChange={(v) => updateFilter("type", v)}
          options={[
            { value: "", label: "All types" },
            ...RECORD_TYPES.map((t) => ({ value: t, label: cap(t) })),
          ]}
        />
      </div>

      {recordsQuery.isLoading ? (
        <RecordListSkeleton />
      ) : recordsQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load records.</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Please refresh or try again.
          </CardContent>
        </Card>
      ) : records.length === 0 ? (
        <EmptyState hasFilters={!!selectedAnimalId || !!selectedType} />
      ) : (
        <ul className="space-y-2">
          {records.map((r) => (
            <RecordRow
              key={r.id}
              record={r}
              animalName={animalsById.get(r.animal_id)?.barn_name ?? "—"}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function RecordRow({
  record,
  animalName,
}: {
  record: {
    id: string;
    animal_id: string;
    record_type: VetRecordType;
    issued_on: string | null;
    expires_on: string | null;
    issuing_provider: string | null;
    object_key: string | null;
    created_at: string;
  };
  animalName: string;
}) {
  const view = useMutation({
    mutationFn: async () => {
      if (!record.object_key) throw new Error("File missing");
      const { get_url } = await readUrlFor(record.object_key);
      window.open(get_url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const expiresSoon = isExpiringSoon(record.expires_on);
  const expired = isExpired(record.expires_on);

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
          <FileText size={18} />
        </div>
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">
            {cap(record.record_type)} — {animalName}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[
              record.issued_on && `Issued ${fmt(record.issued_on)}`,
              record.expires_on && `Expires ${fmt(record.expires_on)}`,
              record.issuing_provider,
            ]
              .filter(Boolean)
              .join(" · ") || fmt(record.created_at)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {expired ? (
          <Badge variant="outline" className="border-destructive text-destructive">
            Expired
          </Badge>
        ) : expiresSoon ? (
          <Badge variant="outline" className="border-[#C4552B] text-[#C4552B]">
            Due soon
          </Badge>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => view.mutate()}
          disabled={view.isPending || !record.object_key}
        >
          <ExternalLink size={14} />
          View
        </Button>
      </div>
    </li>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-muted-foreground">
      <span className="text-xs uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-9 rounded-md border border-input bg-card px-2 text-sm text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {hasFilters ? "Nothing matches those filters." : "No records yet."}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {hasFilters
          ? "Try widening the animal or record-type filter."
          : "Upload your first Coggins or vaccine cert and it'll live here forever."}
      </CardContent>
    </Card>
  );
}

function RecordListSkeleton() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </ul>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function isExpired(iso: string | null): boolean {
  if (!iso) return false;
  return new Date(iso) < startOfToday();
}

function isExpiringSoon(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const today = startOfToday();
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() + 30);
  return d >= today && d <= cutoff;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
