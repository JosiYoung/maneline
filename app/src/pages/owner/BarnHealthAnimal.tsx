import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

import { mapSupabaseError } from "@/lib/errors";
import {
  HERD_HEALTH_ANIMAL_QUERY_KEY,
  HERD_HEALTH_CELL_CLASSES,
  formatCellLabel,
  formatHerdHealthRecordType,
  formatHerdHealthStatus,
  getHerdHealthAnimal,
  type HerdHealthCell,
  type HerdHealthRecordType,
} from "@/lib/barn";

export default function BarnHealthAnimal() {
  const { id } = useParams<{ id: string }>();
  const animalId = id ?? "";

  const q = useQuery({
    queryKey: animalId
      ? HERD_HEALTH_ANIMAL_QUERY_KEY(animalId)
      : ["herd_health_animal", "none"],
    queryFn: () => getHerdHealthAnimal(animalId),
    enabled: Boolean(animalId),
  });

  const cellByType = useMemo(() => {
    const m = new Map<HerdHealthRecordType, HerdHealthCell>();
    (q.data?.cells ?? []).forEach((c) => m.set(c.record_type, c));
    return m;
  }, [q.data]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-primary">
            {q.data?.animal.name ?? "Horse"}
          </h1>
          <p className="text-sm text-muted-foreground">
            Health status + record history.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/app/barn/health">Back to grid</Link>
        </Button>
      </header>

      {q.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : q.isError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {mapSupabaseError(q.error as Error)}
          </CardContent>
        </Card>
      ) : q.data ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status at a glance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {q.data.record_types.map((rt) => {
                  const cell = cellByType.get(rt);
                  if (!cell) {
                    return (
                      <Badge key={rt} variant="outline">
                        {formatHerdHealthRecordType(rt)} · —
                      </Badge>
                    );
                  }
                  return (
                    <Badge
                      key={rt}
                      variant="outline"
                      className={HERD_HEALTH_CELL_CLASSES[cell.status]}
                    >
                      {formatHerdHealthRecordType(rt)} ·{" "}
                      {formatCellLabel(cell)} ({formatHerdHealthStatus(cell.status)})
                    </Badge>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Records</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {q.data.records.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No records on file yet.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Issued</th>
                      <th className="px-4 py-3 font-medium">Expires</th>
                      <th className="px-4 py-3 font-medium">Provider</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.records.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-border last:border-0"
                      >
                        <td className="px-4 py-3 capitalize">
                          {r.record_type.replace(/_/g, " ")}
                        </td>
                        <td className="px-4 py-3">
                          {r.issued_on
                            ? new Date(r.issued_on).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {r.expires_on
                            ? new Date(r.expires_on).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="px-4 py-3">
                          {r.issuing_provider ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
