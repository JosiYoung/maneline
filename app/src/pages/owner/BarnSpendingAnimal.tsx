import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  COST_BASIS_QUERY_KEY,
  DISPOSITION_LABELS,
  formatUsdCents,
  getAnimalCostBasis,
  patchAnimalCostBasis,
  type Disposition,
  type PatchCostBasisInput,
} from "@/lib/barn";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";
import { OwnerExpenseDialog } from "@/components/owner/OwnerExpenseDialog";

// BarnSpendingAnimal — /app/barn/spending/animals/:id.
//
// Cost-basis card per horse: acquisition price + dates, lifetime
// spend, disposition (sold / retired / etc). Edit via dialog; the
// Worker enforces the "disposition_at implies non-still-owned" rule.

function dollarsToCents(input: string): number | null {
  if (!input.trim()) return null;
  const n = Number(input.replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function centsToDollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export default function BarnSpendingAnimal() {
  const { id = "" } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  const basisQ = useQuery({
    queryKey: COST_BASIS_QUERY_KEY(id),
    queryFn: () => getAnimalCostBasis(id),
    enabled: !!id,
  });

  const data = basisQ.data;

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/app/barn/spending"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to spending
        </Link>
      </div>

      {basisQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : basisQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Could not load cost basis: {mapSupabaseError(basisQ.error)}
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-3">
              {data.animal.color_hex ? (
                <span
                  className="inline-block h-8 w-8 rounded-full border border-border"
                  style={{ backgroundColor: data.animal.color_hex }}
                />
              ) : null}
              <div>
                <h1 className="font-display text-2xl text-primary">
                  {data.animal.barn_name}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Cost basis and lifetime spend.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setLogOpen(true)}>
                Log expense
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditOpen(true)}
              >
                Edit cost basis
              </Button>
            </div>
          </header>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Acquisition
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="font-display text-2xl text-primary">
                  {formatUsdCents(data.animal.acquired_price_cents)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.animal.acquired_at ?? "Date not set"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Lifetime spend
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <p className="font-display text-2xl text-primary">
                  {formatUsdCents(data.cumulative_spend_cents)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {data.annualized_spend_cents !== null
                    ? `${formatUsdCents(data.annualized_spend_cents)} / yr annualized`
                    : "Not enough history to annualize"}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">
                  Status
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <div>
                  <Badge variant="secondary">
                    {data.animal.disposition
                      ? DISPOSITION_LABELS[data.animal.disposition]
                      : "Still owned"}
                  </Badge>
                </div>
                {data.animal.disposition_at ? (
                  <p className="text-xs text-muted-foreground">
                    {data.animal.disposition_at}
                    {data.animal.disposition_amount_cents !== null
                      ? ` — ${formatUsdCents(data.animal.disposition_amount_cents)}`
                      : ""}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <EditCostBasisDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            animalId={id}
            initial={data.animal}
            onSaved={() => {
              qc.invalidateQueries({ queryKey: COST_BASIS_QUERY_KEY(id) });
              qc.invalidateQueries({ queryKey: ["spending"] });
            }}
          />

          <OwnerExpenseDialog
            open={logOpen}
            onClose={() => {
              setLogOpen(false);
              qc.invalidateQueries({ queryKey: COST_BASIS_QUERY_KEY(id) });
              qc.invalidateQueries({ queryKey: ["spending"] });
            }}
            animalId={id}
          />
        </>
      ) : null}
    </div>
  );
}

function EditCostBasisDialog({
  open,
  onOpenChange,
  animalId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  animalId: string;
  initial: {
    acquired_at: string | null;
    acquired_price_cents: number | null;
    disposition: Disposition | null;
    disposition_at: string | null;
    disposition_amount_cents: number | null;
  };
  onSaved: () => void;
}) {
  const [acquiredAt, setAcquiredAt] = useState<string>("");
  const [acquiredPrice, setAcquiredPrice] = useState<string>("");
  const [disposition, setDisposition] = useState<Disposition | "">("");
  const [dispositionAt, setDispositionAt] = useState<string>("");
  const [dispositionAmount, setDispositionAmount] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setAcquiredAt(initial.acquired_at ?? "");
    setAcquiredPrice(centsToDollars(initial.acquired_price_cents));
    setDisposition((initial.disposition ?? "") as Disposition | "");
    setDispositionAt(initial.disposition_at ?? "");
    setDispositionAmount(centsToDollars(initial.disposition_amount_cents));
  }, [open, initial]);

  const dispositionIsExit =
    disposition !== "" && disposition !== "still_owned";

  const patch = useMutation({
    mutationFn: async () => {
      const input: PatchCostBasisInput = {
        acquired_at: acquiredAt.trim() || null,
        acquired_price_cents: dollarsToCents(acquiredPrice),
        disposition: (disposition || null) as Disposition | null,
        disposition_at: dispositionIsExit ? dispositionAt.trim() || null : null,
        disposition_amount_cents: dispositionIsExit
          ? dollarsToCents(dispositionAmount)
          : null,
      };
      return patchAnimalCostBasis(animalId, input);
    },
    onSuccess: () => {
      notify.success("Cost basis updated");
      onSaved();
      onOpenChange(false);
    },
    onError: (err) => {
      notify.error(mapSupabaseError(err));
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit cost basis</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="acquired-at">Acquired on</Label>
              <Input
                id="acquired-at"
                type="date"
                value={acquiredAt}
                onChange={(e) => setAcquiredAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="acquired-price">Acquired price (USD)</Label>
              <Input
                id="acquired-price"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={acquiredPrice}
                onChange={(e) => setAcquiredPrice(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="disposition">Disposition</Label>
            <select
              id="disposition"
              value={disposition}
              onChange={(e) =>
                setDisposition(e.target.value as Disposition | "")
              }
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">— not set —</option>
              {(Object.keys(DISPOSITION_LABELS) as Disposition[]).map((d) => (
                <option key={d} value={d}>
                  {DISPOSITION_LABELS[d]}
                </option>
              ))}
            </select>
          </div>

          {dispositionIsExit ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="disposition-at">Disposition date</Label>
                <Input
                  id="disposition-at"
                  type="date"
                  value={dispositionAt}
                  onChange={(e) => setDispositionAt(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="disposition-amount">
                  Disposition amount (USD)
                </Label>
                <Input
                  id="disposition-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={dispositionAmount}
                  onChange={(e) => setDispositionAmount(e.target.value)}
                />
              </div>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={patch.isPending}
          >
            Cancel
          </Button>
          <Button onClick={() => patch.mutate()} disabled={patch.isPending}>
            {patch.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
