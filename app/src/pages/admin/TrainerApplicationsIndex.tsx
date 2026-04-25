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
  revokeOrBanTrainer,
  type TrainerApplicationRow,
  type TrainerApplicationStatus,
} from "@/lib/trainerApplications";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";

type StatusFilter = TrainerApplicationStatus | "";
type PendingAction =
  | { kind: "approve" | "reject"; row: TrainerApplicationRow }
  | { kind: "revoke" | "ban"; row: TrainerApplicationRow };

const REVOKE_BAN_NOTES_MIN = 10;

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
  { value: "revoked", label: "Revoked" },
  { value: "banned", label: "Banned" },
  { value: "", label: "All" },
];

export default function TrainerApplicationsIndex() {
  const [status, setStatus] = useState<StatusFilter>("submitted");
  const [pending, setPending] = useState<PendingAction | null>(null);
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

  const revokeBanM = useMutation({
    mutationFn: ({
      id,
      action,
      reviewNotes,
    }: {
      id: string;
      action: "revoke" | "ban";
      reviewNotes: string;
    }) => revokeOrBanTrainer(id, action, reviewNotes),
    onSuccess: (result) => {
      const label = result.decision === "banned" ? "Banned" : "Revoked";
      notify.success(`${label} ${result.display_name || result.email || "trainer"}`);
      setPending(null);
      setNotes("");
      qc.invalidateQueries({ queryKey: TRAINER_APPLICATIONS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
    },
    onError: (e: Error & { code?: string }) => {
      if (e.code === "bad_notes") {
        notify.error("Notes are required to revoke or ban a trainer.");
      } else {
        notify.error(mapSupabaseError(e));
      }
    },
  });

  const rows = listQ.data ?? [];
  const isMutating = decideM.isPending || revokeBanM.isPending;

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
                        setPending({ kind: "approve", row });
                        setNotes("");
                      }}
                      onReject={() => {
                        setPending({ kind: "reject", row });
                        setNotes("");
                      }}
                      onRevoke={() => {
                        setPending({ kind: "revoke", row });
                        setNotes("");
                      }}
                      onBan={() => {
                        setPending({ kind: "ban", row });
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
                  {dialogTitleFor(pending.kind)}{" "}
                  {pending.row.display_name || pending.row.email || "trainer"}
                </DialogTitle>
                <DialogDescription>
                  {dialogDescriptionFor(pending.kind)}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground" htmlFor="review-notes">
                  {pending.kind === "revoke" || pending.kind === "ban"
                    ? `Reason (required, at least ${REVOKE_BAN_NOTES_MIN} characters)`
                    : "Reviewer notes (optional, shared with trainer)"}
                </label>
                <Textarea
                  id="review-notes"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={placeholderFor(pending.kind)}
                />
                {(pending.kind === "revoke" || pending.kind === "ban") &&
                  notes.trim().length > 0 &&
                  notes.trim().length < REVOKE_BAN_NOTES_MIN ? (
                    <p className="text-xs text-destructive">
                      Notes must be at least {REVOKE_BAN_NOTES_MIN} characters.
                    </p>
                  ) : null}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setPending(null);
                    setNotes("");
                  }}
                  disabled={isMutating}
                >
                  Cancel
                </Button>
                <Button
                  variant={pending.kind === "approve" ? "default" : "destructive"}
                  onClick={() => {
                    if (pending.kind === "approve" || pending.kind === "reject") {
                      decideM.mutate({
                        id: pending.row.id,
                        decision: pending.kind,
                        reviewNotes: notes.trim() || undefined,
                      });
                    } else {
                      revokeBanM.mutate({
                        id: pending.row.id,
                        action: pending.kind,
                        reviewNotes: notes.trim(),
                      });
                    }
                  }}
                  disabled={
                    isMutating ||
                    ((pending.kind === "revoke" || pending.kind === "ban") &&
                      notes.trim().length < REVOKE_BAN_NOTES_MIN)
                  }
                >
                  {isMutating ? "Saving…" : submitLabelFor(pending.kind)}
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
  onRevoke,
  onBan,
}: {
  row: TrainerApplicationRow;
  onApprove: () => void;
  onReject: () => void;
  onRevoke: () => void;
  onBan: () => void;
}) {
  const submitted = useMemo(
    () => new Date(row.submitted_at).toLocaleString(),
    [row.submitted_at],
  );
  const isSubmitted = row.status === "submitted";
  const isApproved = row.status === "approved";
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
        {row.review_notes || (isSubmitted ? "—" : "(none)")}
      </TableCell>
      <TableCell className="text-right">
        {isSubmitted ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onReject}>
              Reject
            </Button>
            <Button size="sm" onClick={onApprove}>
              Approve
            </Button>
          </div>
        ) : isApproved ? (
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={onRevoke}>
              Revoke
            </Button>
            <Button variant="destructive" size="sm" onClick={onBan}>
              Ban
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
      : status === "rejected" || status === "banned"
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

function dialogTitleFor(kind: PendingAction["kind"]): string {
  switch (kind) {
    case "approve": return "Approve";
    case "reject":  return "Reject";
    case "revoke":  return "Revoke access for";
    case "ban":     return "Ban";
  }
}

function dialogDescriptionFor(kind: PendingAction["kind"]): string {
  switch (kind) {
    case "approve":
      return "User will be flipped to active immediately.";
    case "reject":
      return "User will be suspended. They'll see the rejection on next login.";
    case "revoke":
      return "Trainer's portal access will be turned off (account suspended). They can be re-approved later. Notes are required.";
    case "ban":
      return "Trainer will be permanently banned from the platform. This is terminal — they cannot re-apply without an admin override. Notes are required.";
  }
}

function placeholderFor(kind: PendingAction["kind"]): string {
  switch (kind) {
    case "approve": return "Any onboarding notes for the trainer…";
    case "reject":  return "Why the application is being declined…";
    case "revoke":  return "Why access is being revoked…";
    case "ban":     return "Why this trainer is being banned…";
  }
}

function submitLabelFor(kind: PendingAction["kind"]): string {
  switch (kind) {
    case "approve": return "Approve";
    case "reject":  return "Reject";
    case "revoke":  return "Revoke access";
    case "ban":     return "Ban trainer";
  }
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
