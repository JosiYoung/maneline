import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Settings2, FileDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  HERD_HEALTH_QUERY_KEY,
  HERD_HEALTH_CELL_CLASSES,
  acknowledgeHerdHealthCell,
  formatCellLabel,
  formatHerdHealthRecordType,
  formatHerdHealthStatus,
  getHerdHealth,
  type HerdHealthAnimalRow,
  type HerdHealthCell,
  type HerdHealthRecordType,
  type HerdHealthStatus,
} from "@/lib/barn";
import { BarnSubNav } from "@/components/owner/BarnSubNav";

// BarnHealth — /app/barn/health.
//
// Horses × record-types grid, colored by cell status. Click any cell to
// open the action sheet (snooze / open detail). "Export PDF" is
// Barn-Mode-gated (Module 05). Thresholds page is a separate route.

interface ActionSheet {
  animal: HerdHealthAnimalRow;
  cell: HerdHealthCell;
}

export default function BarnHealth() {
  const q = useQuery({
    queryKey: HERD_HEALTH_QUERY_KEY,
    queryFn: getHerdHealth,
  });
  const [sheet, setSheet] = useState<ActionSheet | null>(null);

  const cellIndex = useMemo(() => {
    const m = new Map<string, HerdHealthCell>();
    (q.data?.cells ?? []).forEach((c) => {
      m.set(`${c.animal_id}:${c.record_type}`, c);
    });
    return m;
  }, [q.data]);

  const recordTypes = q.data?.record_types ?? [];
  const animals = q.data?.animals ?? [];

  return (
    <div className="space-y-6">
      <BarnSubNav />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-primary">Herd health</h1>
          <p className="text-sm text-muted-foreground">
            Color-coded expiration grid. Tap a cell to snooze, schedule, or
            view details.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/app/barn/health/thresholds">
              <Settings2 className="mr-1 h-4 w-4" /> Thresholds
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Barn Mode unlocks health reports"
          >
            <FileDown className="mr-1 h-4 w-4" /> Export PDF
          </Button>
        </div>
      </header>

      {q.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : q.isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {mapSupabaseError(q.error as Error)}
          </CardContent>
        </Card>
      ) : animals.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Add a horse to get started.
            <div className="mt-4">
              <Button asChild size="sm">
                <Link to="/app/animals/new">Add a horse</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground">
                    Horse
                  </th>
                  {recordTypes.map((rt) => (
                    <th
                      key={rt}
                      className="whitespace-nowrap px-3 py-2 text-left font-medium text-muted-foreground"
                    >
                      {formatHerdHealthRecordType(rt)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {animals.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="inline-block h-3 w-3 rounded-full border border-border"
                          style={{ background: a.color_hex ?? "#e5e7eb" }}
                        />
                        <Link
                          to={`/app/barn/health/animals/${a.id}`}
                          className="font-medium hover:underline"
                        >
                          {a.name}
                        </Link>
                      </div>
                    </td>
                    {recordTypes.map((rt) => {
                      const cell = cellIndex.get(`${a.id}:${rt}`);
                      if (!cell) {
                        return (
                          <td key={rt} className="px-2 py-2">
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={rt} className="px-2 py-2">
                          <button
                            type="button"
                            className={`inline-flex w-full min-w-[120px] items-center justify-between rounded-md border px-2 py-1 text-xs transition ${HERD_HEALTH_CELL_CLASSES[cell.status]}`}
                            onClick={() => setSheet({ animal: a, cell })}
                          >
                            <span className="truncate">{formatCellLabel(cell)}</span>
                            <StatusDot status={cell.status} />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Legend />

      <CellActionDialog
        sheet={sheet}
        onClose={() => setSheet(null)}
      />
    </div>
  );
}

function StatusDot({ status }: { status: HerdHealthStatus }) {
  const colorMap: Record<HerdHealthStatus, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    overdue: "bg-rose-500",
    dismissed: "bg-slate-400",
    no_record: "bg-slate-300",
    disabled: "bg-slate-200",
  };
  return (
    <span
      aria-hidden="true"
      className={`ml-2 inline-block h-2 w-2 flex-shrink-0 rounded-full ${colorMap[status]}`}
    />
  );
}

function Legend() {
  const items: HerdHealthStatus[] = [
    "ok",
    "warn",
    "overdue",
    "dismissed",
    "no_record",
    "disabled",
  ];
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {items.map((s) => (
        <Badge
          key={s}
          variant="outline"
          className={HERD_HEALTH_CELL_CLASSES[s]}
        >
          {formatHerdHealthStatus(s)}
        </Badge>
      ))}
    </div>
  );
}

function CellActionDialog({
  sheet,
  onClose,
}: {
  sheet: ActionSheet | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"menu" | "snooze">("menu");
  const [dismissDate, setDismissDate] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const snooze = useMutation({
    mutationFn: async () => {
      if (!sheet) throw new Error("no cell");
      if (!dismissDate) throw new Error("Pick a date.");
      const iso = new Date(`${dismissDate}T23:59:59`).toISOString();
      return acknowledgeHerdHealthCell({
        animal_id: sheet.animal.id,
        record_type: sheet.cell.record_type,
        dismissed_until: iso,
        reason: reason.trim() || null,
      });
    },
    onSuccess: () => {
      notify.success("Cell snoozed");
      qc.invalidateQueries({ queryKey: HERD_HEALTH_QUERY_KEY });
      handleClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function handleClose() {
    setMode("menu");
    setDismissDate("");
    setReason("");
    onClose();
  }

  return (
    <Dialog
      open={Boolean(sheet)}
      onOpenChange={(v) => { if (!v) handleClose(); }}
    >
      <DialogContent>
        {sheet && (
          <>
            <DialogHeader>
              <DialogTitle>
                {sheet.animal.name} — {formatHerdHealthRecordType(sheet.cell.record_type)}
              </DialogTitle>
              <DialogDescription>
                {sheet.cell.last_record_at
                  ? `Last record ${new Date(sheet.cell.last_record_at).toLocaleDateString()}`
                  : "No record on file."}
                {sheet.cell.next_due_at
                  ? ` · Due ${new Date(sheet.cell.next_due_at).toLocaleDateString()}`
                  : ""}
              </DialogDescription>
            </DialogHeader>

            {mode === "menu" && (
              <div className="space-y-3">
                <Badge variant="outline" className={HERD_HEALTH_CELL_CLASSES[sheet.cell.status]}>
                  {formatHerdHealthStatus(sheet.cell.status)}
                </Badge>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link to={`/app/barn/health/animals/${sheet.animal.id}`}>
                      View horse
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setMode("snooze")}
                    disabled={!sheet.cell.enabled}
                  >
                    Snooze
                  </Button>
                  <Button
                    size="sm"
                    asChild
                    title="Pre-fills the calendar create dialog"
                  >
                    <Link
                      to={`/app/barn/calendar?prefill=health&animal=${sheet.animal.id}&type=${sheet.cell.record_type}`}
                    >
                      Schedule
                    </Link>
                  </Button>
                </div>
              </div>
            )}

            {mode === "snooze" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label htmlFor="hh-dismiss-until">Snooze until</Label>
                  <Input
                    id="hh-dismiss-until"
                    type="date"
                    value={dismissDate}
                    onChange={(e) => setDismissDate(e.target.value)}
                    min={new Date(Date.now() + 24 * 3600 * 1000)
                      .toISOString()
                      .slice(0, 10)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="hh-dismiss-reason">Reason (optional)</Label>
                  <Textarea
                    id="hh-dismiss-reason"
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    maxLength={500}
                  />
                </div>
                <DialogFooter>
                  <Button
                    variant="ghost"
                    onClick={() => setMode("menu")}
                    disabled={snooze.isPending}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => snooze.mutate()}
                    disabled={snooze.isPending || !dismissDate}
                  >
                    {snooze.isPending && (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    )}
                    Snooze cell
                  </Button>
                </DialogFooter>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Silence unused-var for HerdHealthRecordType (re-exported for consumers)
export type { HerdHealthRecordType };
