import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { EXPENSES_QUERY_KEY, archiveExpense } from "@/lib/expenses";

// ArchiveExpenseDialog — OAG §8. Soft-archive with an optional reason;
// the Worker writes an append-only expense_archive_events audit row.
// Mirrors ArchiveSessionDialog (reason field is optional here since
// the data is much lower-stakes than a session or animal archive).
export function ArchiveExpenseDialog({
  expenseId,
  summary,
  trigger,
}: {
  expenseId: string;
  summary: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      archiveExpense({ expense_id: expenseId, reason: reason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      notify.success("Expense archived.");
      setOpen(false);
      setReason("");
    },
    onError: (err) => {
      notify.error(mapSupabaseError(err as Error));
    },
  });

  const busy = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            Archive
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this expense?</DialogTitle>
          <DialogDescription>
            "{summary}" will be hidden from the default list. You can show
            archived rows via the toggle above the table — this is not a
            delete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="expense-archive-reason">Reason (optional)</Label>
          <Textarea
            id="expense-archive-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Duplicate entry, logged on the wrong animal, refund issued…"
            rows={3}
            disabled={busy}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={busy}
          >
            {busy ? "Archiving…" : "Archive expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
