import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  GOALS_QUERY_KEY,
  upsertCurrentMonthGoal,
  formatMonthLabel,
} from "@/lib/trainerGoals";

// GoalEditDialog — set / clear the two monthly targets.
//
// Revenue target is typed in whole dollars (int) and stored as cents.
// Hours target is a decimal (numeric(6,2)) — 0.25 h granularity is
// enough for session logging, so we display "h" and accept two
// decimal places. Either field can be cleared to null independently.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trainerId: string;
  monthStart: string;
  initialRevenueCents: number | null;
  initialHours: number | null;
}

export function GoalEditDialog({
  open,
  onOpenChange,
  trainerId,
  monthStart,
  initialRevenueCents,
  initialHours,
}: Props) {
  const queryClient = useQueryClient();

  const [revenueDollars, setRevenueDollars] = useState<string>("");
  const [hours, setHours] = useState<string>("");

  // Reset the form each time the dialog opens so a mid-edit close
  // doesn't leak state into the next edit.
  useEffect(() => {
    if (!open) return;
    setRevenueDollars(
      initialRevenueCents == null ? "" : String(Math.round(initialRevenueCents / 100))
    );
    setHours(initialHours == null ? "" : String(initialHours));
  }, [open, initialRevenueCents, initialHours]);

  const save = useMutation({
    mutationFn: async () => {
      const revenueTrimmed = revenueDollars.trim();
      const hoursTrimmed = hours.trim();

      let revenue_target_cents: number | null = null;
      if (revenueTrimmed !== "") {
        const n = Number(revenueTrimmed);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          throw new Error("Revenue target must be a whole number of dollars.");
        }
        revenue_target_cents = Math.round(n * 100);
      }

      let hours_target: number | null = null;
      if (hoursTrimmed !== "") {
        const n = Number(hoursTrimmed);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error("Hours target must be zero or more.");
        }
        // DB column is numeric(6,2) — five digits left of decimal is plenty
        // (99,999.99 hours), but clamp precision for safety.
        hours_target = Math.round(n * 100) / 100;
      }

      return upsertCurrentMonthGoal(trainerId, {
        revenue_target_cents,
        hours_target,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: GOALS_QUERY_KEY });
      notify.success("Goal saved");
      onOpenChange(false);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Goal for {formatMonthLabel(monthStart)}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="goal-revenue">Revenue target (USD)</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">$</span>
              <Input
                id="goal-revenue"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder="e.g. 8000"
                value={revenueDollars}
                onChange={(e) => setRevenueDollars(e.target.value)}
                disabled={save.isPending}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Gross revenue from succeeded payments this month. Leave
              blank to skip the revenue target.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="goal-hours">Hours target</Label>
            <Input
              id="goal-hours"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.25}
              placeholder="e.g. 60"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              disabled={save.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Logged session hours this month. Leave blank to skip.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={save.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save goal
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
