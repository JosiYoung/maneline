import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

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
import { ANIMALS_QUERY_KEY, archiveAnimal } from "@/lib/animals";

// ArchiveAnimalDialog — reason is required. OAG §8: never delete, and
// every soft-archive must carry a human-readable reason so the audit
// trail (animal_archive_events) is worth reading a year from now.
export function ArchiveAnimalDialog({
  animalId,
  animalName,
}: {
  animalId: string;
  animalName: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => archiveAnimal(animalId, reason.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ANIMALS_QUERY_KEY });
      notify.success(`${animalName} archived.`);
      setOpen(false);
      setReason("");
      navigate("/app/animals");
    },
    onError: (err) => {
      notify.error(mapSupabaseError(err as Error));
    },
  });

  const canSubmit = reason.trim().length > 0 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Archive</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {animalName}?</DialogTitle>
          <DialogDescription>
            Archived animals are hidden from the default list, but their
            records and photos stay searchable under the "Show archived"
            filter. This is reversible — it is not a delete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="archive-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="archive-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Sold, retired, deceased, passed to new owner…"
            rows={3}
            disabled={mutation.isPending}
          />
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
          >
            {mutation.isPending ? "Archiving…" : "Archive animal"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
