import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ANIMAL_PROTOCOLS_QUERY_KEY,
  PROTOCOLS_QUERY_KEY,
  SUPPLEMENT_DOSES_QUERY_KEY,
  assignProtocol,
  confirmDoseToday,
  dosesGivenToday,
  endAnimalProtocol,
  listActiveAnimalProtocols,
  listProtocols,
} from "@/lib/protocols";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";

// ProtocolsSection — /app/animals/:id
// Owner-facing supplement-protocol surface for an animal.
// - Lists active animal_protocols.
// - One-tap "Confirm dose" writes into supplement_doses (idempotent
//   per day: if already dosed today, button renders as a green
//   "Dosed today" badge).
// - "Assign protocol" dialog picks a protocol from the SLH catalog.
// - "End protocol" archives the row by setting ended_on = today.
export function ProtocolsSection({
  animalId,
  role,
}: {
  animalId: string;
  role: "owner" | "trainer";
}) {
  const qc = useQueryClient();

  const activeQ = useQuery({
    queryKey: [...ANIMAL_PROTOCOLS_QUERY_KEY, "active", animalId],
    queryFn: () => listActiveAnimalProtocols(animalId),
  });

  const dosedTodayQ = useQuery({
    queryKey: [...SUPPLEMENT_DOSES_QUERY_KEY, "today", animalId],
    queryFn: () => dosesGivenToday(animalId),
  });

  const confirm = useMutation({
    mutationFn: (animalProtocolId: string) =>
      confirmDoseToday({ animalProtocolId, animalId, role }),
    onSuccess: () => {
      notify.success("Dose confirmed for today.");
      qc.invalidateQueries({ queryKey: SUPPLEMENT_DOSES_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const end = useMutation({
    mutationFn: (animalProtocolId: string) =>
      endAnimalProtocol(animalProtocolId, new Date().toISOString().slice(0, 10)),
    onSuccess: () => {
      notify.success("Protocol ended.");
      qc.invalidateQueries({ queryKey: ANIMAL_PROTOCOLS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: SUPPLEMENT_DOSES_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const active = activeQ.data ?? [];
  const dosedMap = dosedTodayQ.data ?? {};

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle>Protocols</CardTitle>
        {role === "owner" ? <AssignProtocolDialog animalId={animalId} /> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {activeQ.isLoading ? (
          <div className="h-16 animate-pulse rounded-md bg-muted/40" />
        ) : active.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No active protocols. {role === "owner"
              ? "Assign one from Silver Lining's catalog to start tracking daily doses."
              : "The owner hasn't assigned a protocol for this animal yet."}
          </p>
        ) : (
          <ul className="space-y-2">
            {active.map((ap) => {
              const alreadyDosed = dosedMap[ap.id] === true;
              return (
                <li
                  key={ap.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {ap.protocol.number ? `${ap.protocol.number} · ` : ""}
                      {ap.protocol.name}
                    </p>
                    {ap.dose_instructions ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {ap.dose_instructions}
                      </p>
                    ) : ap.protocol.description ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {ap.protocol.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {alreadyDosed ? (
                      <Badge variant="secondary" className="gap-1">
                        <Check size={12} />
                        Dosed today
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => confirm.mutate(ap.id)}
                        disabled={confirm.isPending}
                      >
                        Confirm dose
                      </Button>
                    )}
                    {role === "owner" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => end.mutate(ap.id)}
                        disabled={end.isPending}
                      >
                        End
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AssignProtocolDialog({ animalId }: { animalId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [doseInstructions, setDoseInstructions] = useState("");

  const catalogQ = useQuery({
    queryKey: PROTOCOLS_QUERY_KEY,
    queryFn: listProtocols,
    enabled: open,
  });

  const assign = useMutation({
    mutationFn: () =>
      assignProtocol({
        animalId,
        protocolId: selectedId,
        startedOn: new Date().toISOString().slice(0, 10),
        doseInstructions: doseInstructions.trim() || null,
      }),
    onSuccess: () => {
      notify.success("Protocol assigned.");
      qc.invalidateQueries({ queryKey: ANIMAL_PROTOCOLS_QUERY_KEY });
      setOpen(false);
      setSelectedId("");
      setDoseInstructions("");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const catalog = useMemo(() => catalogQ.data ?? [], [catalogQ.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus size={14} />
          Assign protocol
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign a protocol</DialogTitle>
          <DialogDescription>
            Pick a Silver Lining protocol. Doses will appear on Today until
            you end it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="protocol">Protocol</Label>
            {catalogQ.isLoading ? (
              <div className="h-10 animate-pulse rounded-md bg-muted/40" />
            ) : (
              <select
                id="protocol"
                className="w-full rounded-md border border-border bg-background p-2 text-sm"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <option value="">Choose a protocol…</option>
                {catalog.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number ? `${p.number} · ` : ""}
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="dose">Dose instructions (optional)</Label>
            <Textarea
              id="dose"
              placeholder="e.g. 1 scoop with AM feed"
              rows={3}
              value={doseInstructions}
              onChange={(e) => setDoseInstructions(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => assign.mutate()}
            disabled={!selectedId || assign.isPending}
          >
            {assign.isPending ? "Assigning…" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
