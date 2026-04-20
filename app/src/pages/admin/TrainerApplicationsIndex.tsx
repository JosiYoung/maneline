import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  TRAINER_APPLICATIONS_QUERY_KEY,
  decideTrainerApplication,
  listTrainerApplications,
  type TrainerApplicationRow,
  type TrainerApplicationStatus,
} from "@/lib/trainerApplications";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";

type StatusFilter = TrainerApplicationStatus | "";

// TrainerApplicationsIndex — /admin/trainer-applications
//
// Phase 5 sub-prompt 5.3. Lists trainer applications (default:
// submitted queue) and lets silver_lining approve or reject each
// one. Decision flows through the Worker → admin_decide_trainer
// RPC → HubSpot enqueue (5.6).

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "submitted", label: "Queue" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "", label: "All" },
];

export default function TrainerApplicationsIndex() {
  const [status, setStatus] = useState<StatusFilter>("submitted");
  const [pending, setPending] = useState<
    | { row: TrainerApplicationRow; decision: "approve" | "reject" }
    | null
  >(null);
  const [notes, setNotes] = useState("");

  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: [...TRAINER_APPLICATIONS_QUERY_KEY, { status }] as const,
    queryFn: () => listTrainerApplications(status || undefined),
  });

  const decideM = useMutation({
    mutationFn: ({
      id,
      decision,
      reviewNotes,
    }: {
      id: string;
      decision: "approve" | "reject";
      reviewNotes?: string;
    }) => decideTrainerApplication(id, decision, reviewNotes),
    onSuccess: (result) => {
      const label = result.decision === "approved" ? "Approved" : "Rejected";
      notify.success(`${label} ${result.display_name || result.email || "trainer"}`);
      setPending(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: TRAINER_APPLICATIONS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Trainer applications</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review white-label trainer submissions. Approving flips the user to{" "}
          <code>active</code>; rejecting suspends them.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-2 py-3">
          {STATUS_OPTIONS.map((opt) => (
            <Button
              key={opt.value || "all"}
              variant={status === opt.value ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus(opt.value)}
            >
              {opt.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      {listQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn't load applications. {mapSupabaseError(listQ.error as Error)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Applicant</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewer notes</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && rows.length === 0 ? (
                  <LoadingRow />
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-10 text-center text-sm text-muted-foreground"
                    >
                      Nothing in this queue.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <AppRow
                      key={row.id}
                      row={row}
                      onApprove={() => {
                        setPending({ row, decision: "approve" });
                        setNotes("");
                      }}
                      onReject={() => {
                        setPending({ row, decision: "reject" });
                        setNotes("");
                      }}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!pending}
        onOpenChange={(open) => {
          if (!open) {
            setPending(null);
            setNotes("");
          }
        }}
      >
        <DialogContent>
          {pending ? (
            <>
              <DialogHeader>
                <DialogTitle>
                  {pending.decision === "approve" ? "Approve" : "Reject"}{" "}
                  {pending.row.display_name || pending.row.email || "trainer"}
                </DialogTitle>
                <DialogDescription>
                  {pending.decision === "approve"
                    ? "User will be flipped to active immediately."
                    : "User will be suspended. They'll see the rejection on next login."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="review-notes">
                  Reviewer notes (optional, shared with trainer)
                </label>
                <Textarea
                  id="review-notes"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={
                    pending.decision === "reject"
                      ? "Why the application is being declined…"
                      : "Any onboarding notes for the trainer…"
                  }
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPending(null);
                    setNotes("");
                  }}
                  disabled={decideM.isPending}
                >
                  Cancel
                </Button>
                <Button
                  variant={pending.decision === "approve" ? "default" : "destructive"}
                  onClick={() =>
                    decideM.mutate({
                      id: pending.row.id,
                      decision: pending.decision,
                      reviewNotes: notes.trim() || undefined,
                    })
                  }
                  disabled={decideM.isPending}
                >
                  {decideM.isPending
                    ? "Saving…"
                    : pending.decision === "approve"
                    ? "Approve"
                    : "Reject"}
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AppRow({
  row,
  onApprove,
  onReject,
}: {
  row: TrainerApplicationRow;
  onApprove: () => void;
  onReject: () => void;
}) {
  const submitted = useMemo(
    () => new Date(row.submitted_at).toLocaleString(),
    [row.submitted_at],
  );
  const isPending = row.status === "submitted";
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{row.display_name || "—"}</div>
        <div className="font-mono text-xs text-muted-foreground">{row.email || row.user_id}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {submitted}
      </TableCell>
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
      <TableCell className="max-w-[280px] text-xs text-muted-foreground">
        {row.review_notes || (isPending ? "—" : "(none)")}
      </TableCell>
      <TableCell className="text-right">
        {isPending ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onReject}>
              Reject
            </Button>
            <Button size="sm" onClick={onApprove}>
              Approve
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Decided</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: TrainerApplicationStatus }) {
  const variant =
    status === "approved"
      ? "default"
      : status === "rejected"
      ? "destructive"
      : status === "submitted"
      ? "secondary"
      : "outline";
  return (
    <Badge variant={variant} className="capitalize">
      {status}
    </Badge>
  );
}

function LoadingRow() {
  return (
    <TableRow>
      <TableCell colSpan={5} className="py-6">
        <div className="h-6 w-full animate-pulse rounded bg-muted/50" />
      </TableCell>
    </TableRow>
  );
}
