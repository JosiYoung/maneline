import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ChevronLeft, Download, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { ANIMALS_QUERY_KEY, listAnimals } from "@/lib/animals";
import { supabase } from "@/lib/supabase";

type ExportWindow = 30 | 90 | 365;

type ExportResult = {
  object_key: string;
  get_url: string;
  expires_in: number;
  record_count: number;
};

async function runExport(animalId: string, windowDays: ExportWindow): Promise<ExportResult> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const res = await fetch("/api/records/export-pdf", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ animal_id: animalId, window_days: windowDays }),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg?.error || `Export failed (${res.status})`);
  }
  return (await res.json()) as ExportResult;
}

// ExportRecords — /app/records/export
//
// One-tap PDF the owner can hand to a vet, buyer, or show secretary.
// The PDF itself is metadata; original files stay in the portal and
// are only handed out via signed URL.
export default function ExportRecords() {
  const [animalId, setAnimalId] = useState<string>("");
  const [windowDays, setWindowDays] = useState<ExportWindow>(365);
  const [result, setResult] = useState<ExportResult | null>(null);

  const animalsQuery = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }],
    queryFn: () => listAnimals({ includeArchived: false }),
  });

  const exportMut = useMutation({
    mutationFn: () => runExport(animalId, windowDays),
    onSuccess: (res) => {
      setResult(res);
      notify.success("Your records PDF is ready.");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const animals = animalsQuery.data ?? [];
  const canExport = Boolean(animalId) && !exportMut.isPending;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          to="/app/records"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={16} />
          Records
        </Link>
        <h1 className="font-display text-2xl text-primary">Export records PDF</h1>
        <p className="text-sm text-muted-foreground">
          Hand a vet, buyer, or show secretary a single clean PDF.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText size={18} className="text-primary" />
            Generate a fresh PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="animal">Animal</Label>
            <select
              id="animal"
              value={animalId}
              onChange={(e) => {
                setAnimalId(e.target.value);
                setResult(null);
              }}
              className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              disabled={animalsQuery.isLoading || exportMut.isPending}
            >
              <option value="">Choose an animal…</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.barn_name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="window">Coverage window</Label>
            <select
              id="window"
              value={windowDays}
              onChange={(e) => {
                setWindowDays(Number(e.target.value) as ExportWindow);
                setResult(null);
              }}
              className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              disabled={exportMut.isPending}
            >
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last 12 months</option>
            </select>
          </div>

          <div className="flex items-center justify-end">
            <Button onClick={() => exportMut.mutate()} disabled={!canExport}>
              {exportMut.isPending ? "Generating…" : "Generate PDF"}
            </Button>
          </div>

          {result ? (
            <ResultBlock result={result} />
          ) : null}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        The download link expires in 15 minutes. Save the file locally
        if you plan to share it — regenerate if the link goes stale.
      </p>
    </div>
  );
}

function ResultBlock({ result }: { result: ExportResult }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
      <p className="text-sm font-medium text-foreground">
        PDF ready · {result.record_count} record
        {result.record_count === 1 ? "" : "s"} included
      </p>
      <p className="text-xs text-muted-foreground">
        Share this link or save the file. Link expires in 15 minutes.
      </p>
      <Button asChild size="sm">
        <a href={result.get_url} target="_blank" rel="noopener noreferrer">
          <Download size={14} />
          Download PDF
        </a>
      </Button>
    </div>
  );
}
