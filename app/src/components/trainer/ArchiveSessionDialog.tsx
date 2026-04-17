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
import { SESSIONS_QUERY_KEY, archiveSession } from "@/lib/sessions";

// ArchiveSessionDialog — OAG §8. Sessions are never deleted; trainers
// soft-archive with a reason, and the Worker writes an append-only
// session_archive_events row for audit. Mirrors ArchiveAnimalDialog.
export function ArchiveSessionDialog({
  sessionId,
  sessionTitle,
}: {
  sessionId: string;
  sessionTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: () => archiveSession({ session_id: sessionId, reason: reason.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      notify.success("Session archived.");
      setOpen(false);
      setReason("");
      navigate("/trainer/sessions");
    },
    onError: (err) => {
      notify.error(mapSupabaseError(err as Error));
    },
  });

  const canSubmit = reason.trim().length > 0 && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Archive session</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive this session?</DialogTitle>
          <DialogDescription>
            "{sessionTitle}" will be hidden from both your list and the owner's.
            This is reversible through support — it is not a delete.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="session-archive-reason">
            Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="session-archive-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Logged on the wrong animal, duplicate, cancelled after logging…"
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
            {mutation.isPending ? "Archiving…" : "Archive session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
