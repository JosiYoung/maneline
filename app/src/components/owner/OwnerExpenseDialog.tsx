import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ANIMALS_QUERY_KEY, listAnimals } from "@/lib/animals";
import { ExpenseForm } from "@/components/expenses/ExpenseForm";

export interface OwnerExpenseDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-select an animal (e.g. on BarnSpendingAnimal). If omitted, user picks. */
  animalId?: string;
}

export function OwnerExpenseDialog({
  open,
  onClose,
  animalId,
}: OwnerExpenseDialogProps) {
  const [picked, setPicked] = useState<string | null>(animalId ?? null);

  const animalsQ = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }] as const,
    queryFn: () => listAnimals({ includeArchived: false }),
    enabled: open && !animalId,
  });

  const effectiveId = animalId ?? picked;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setPicked(animalId ?? null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log expense</DialogTitle>
          <DialogDescription>
            Record a bill you paid — farrier, vet, supplies. Gets tagged to
            the horse and counted in your barn spending rollup.
          </DialogDescription>
        </DialogHeader>

        {!animalId && (
          <div className="space-y-1.5">
            <Label htmlFor="expense-animal">Horse / dog</Label>
            {animalsQ.isLoading ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <select
                id="expense-animal"
                value={picked ?? ""}
                onChange={(e) => setPicked(e.target.value || null)}
                className={cn(
                  "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
                  "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                )}
              >
                <option value="">— Pick one —</option>
                {(animalsQ.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.barn_name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {effectiveId && (
          <ExpenseForm
            animalId={effectiveId}
            recorderRole="owner"
            onCreated={() => {
              setPicked(animalId ?? null);
              onClose();
            }}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
