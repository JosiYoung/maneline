import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  HERD_HEALTH_QUERY_KEY,
  formatHerdHealthRecordType,
  getHerdHealth,
  resetHerdHealthThresholds,
  updateHerdHealthThresholds,
  type HerdHealthRecordType,
  type HerdHealthThreshold,
} from "@/lib/barn";

interface Draft {
  record_type: HerdHealthRecordType;
  interval_days: number;
  enabled: boolean;
}

export default function BarnHealthThresholds() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: HERD_HEALTH_QUERY_KEY,
    queryFn: getHerdHealth,
  });
  const [draft, setDraft] = useState<Draft[]>([]);

  useEffect(() => {
    if (q.data?.thresholds) {
      setDraft(
        q.data.record_types.map((rt) => {
          const row = q.data!.thresholds.find((t) => t.record_type === rt);
          return {
            record_type: rt,
            interval_days: row?.interval_days ?? 365,
            enabled: row?.enabled ?? true,
          };
        })
      );
    }
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => updateHerdHealthThresholds(draft),
    onSuccess: () => {
      notify.success("Thresholds saved");
      qc.invalidateQueries({ queryKey: HERD_HEALTH_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const reset = useMutation({
    mutationFn: () => resetHerdHealthThresholds(),
    onSuccess: (rows: HerdHealthThreshold[]) => {
      notify.success("Reset to industry defaults");
      qc.invalidateQueries({ queryKey: HERD_HEALTH_QUERY_KEY });
      setDraft(
        rows.map((r) => ({
          record_type: r.record_type,
          interval_days: r.interval_days,
          enabled: r.enabled,
        }))
      );
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function updateRow(rt: HerdHealthRecordType, patch: Partial<Draft>) {
    setDraft((prev) =>
      prev.map((row) =>
        row.record_type === rt ? { ...row, ...patch } : row
      )
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-primary">Health thresholds</h1>
          <p className="text-sm text-muted-foreground">
            Industry defaults seeded on first load. Adjust the interval or turn
            a record type off.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => nav("/app/barn/health")}
        >
          Back
        </Button>
      </header>

      {q.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : q.isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {mapSupabaseError(q.error as Error)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Record type</th>
                  <th className="px-4 py-3 font-medium">Interval (days)</th>
                  <th className="px-4 py-3 font-medium">Enabled</th>
                </tr>
              </thead>
              <tbody>
                {draft.map((row) => (
                  <tr key={row.record_type} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium">
                      {formatHerdHealthRecordType(row.record_type)}
                    </td>
                    <td className="px-4 py-3">
                      <Input
                        type="number"
                        min={1}
                        max={3650}
                        value={row.interval_days}
                        className="w-24"
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          updateRow(row.record_type, {
                            interval_days: Number.isFinite(n) ? n : row.interval_days,
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={row.enabled}
                          onChange={(e) =>
                            updateRow(row.record_type, { enabled: e.target.checked })
                          }
                        />
                        <span className="text-sm text-muted-foreground">
                          {row.enabled ? "On" : "Off"}
                        </span>
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="outline"
          onClick={() => reset.mutate()}
          disabled={reset.isPending}
        >
          {reset.isPending ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="mr-1 h-4 w-4" />
          )}
          Reset to defaults
        </Button>
        <Button
          onClick={() => save.mutate()}
          disabled={save.isPending || draft.length === 0}
        >
          {save.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Save thresholds
        </Button>
      </div>
    </div>
  );
}
