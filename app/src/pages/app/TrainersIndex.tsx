import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  ACCESS_QUERY_KEY,
  daysLeftInGrace,
  listGrants,
  revokeAccess,
  statusFor,
  type AccessGrantWithTrainer,
  type GrantStatus,
} from "@/lib/access";
import { ProfessionalContactsSection } from "@/components/owner/ProfessionalContactsSection";

// TrainersIndex — /app/trainers.
//
// Lists every grant the owner has made, grouped active / revoked. Each
// row has a Revoke button that opens a confirm dialog with a grace-days
// picker. Revoked rows in grace show a live countdown so the owner knows
// when the trainer actually loses read access.
export default function TrainersIndex() {
  const grantsQuery = useQuery({
    queryKey: ACCESS_QUERY_KEY,
    queryFn: listGrants,
  });

  const grants = grantsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-primary">Trainers</h1>
          <p className="text-sm text-muted-foreground">
            Who sees your animals — and for how long.
          </p>
        </div>
        <Button asChild size="sm">
          <Link to="/app/trainers/invite">
            <UserPlus size={14} />
            Invite
          </Link>
        </Button>
      </header>

      {grantsQuery.isLoading ? (
        <Skeleton />
      ) : grantsQuery.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load trainers.</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Please refresh or try again.
          </CardContent>
        </Card>
      ) : grants.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {grants.map((g) => (
            <GrantRow key={g.id} grant={g} />
          ))}
        </ul>
      )}

      <ProfessionalContactsSection />
    </div>
  );
}

function EmptyState() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No trainers yet.</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Invite one when you're ready — they'll only see the animals
          you choose.
        </p>
        <Button asChild size="sm">
          <Link to="/app/trainers/invite">
            <UserPlus size={14} />
            Invite a trainer
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function GrantRow({ grant }: { grant: AccessGrantWithTrainer }) {
  // Keep the badge countdown fresh without re-fetching the grant list.
  // One tick per minute is plenty; days-resolution numbers don't move
  // faster than that.
  const [, forceRerender] = useState(0);
  useEffect(() => {
    const id = setInterval(() => forceRerender((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const status = statusFor(grant);
  const label = grantTargetLabel(grant);

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">
          {grant.trainer_display_name || grant.trainer_email || "Unknown trainer"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {grant.trainer_email ? `${grant.trainer_email} · ` : ""}
          {label}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge grant={grant} status={status} />
        {status === "active" ? (
          <RevokeDialog grantId={grant.id} trainerLabel={grant.trainer_display_name || grant.trainer_email || "trainer"} />
        ) : null}
      </div>
    </li>
  );
}

function StatusBadge({
  grant,
  status,
}: {
  grant: AccessGrantWithTrainer;
  status: GrantStatus;
}) {
  if (status === "active") {
    return (
      <Badge variant="outline" className="border-primary text-primary">
        Active
      </Badge>
    );
  }
  if (status === "grace") {
    const days = daysLeftInGrace(grant);
    return (
      <Badge variant="outline" className="border-[#C4552B] text-[#C4552B]">
        Ends in {days}d
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-muted-foreground text-muted-foreground">
      Expired
    </Badge>
  );
}

function grantTargetLabel(g: AccessGrantWithTrainer): string {
  if (g.scope === "animal") return `Access to ${g.animal_barn_name ?? "an animal"}`;
  if (g.scope === "ranch")  return `Access to ${g.ranch_name ?? "a ranch"}`;
  return "Access to every animal";
}

function RevokeDialog({
  grantId,
  trainerLabel,
}: {
  grantId: string;
  trainerLabel: string;
}) {
  const [graceDays, setGraceDays] = useState(7);
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => revokeAccess({ grant_id: grantId, grace_days: graceDays }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY });
      notify.success(
        graceDays === 0
          ? `Access revoked for ${trainerLabel}.`
          : `Access will end in ${graceDays} day${graceDays === 1 ? "" : "s"} for ${trainerLabel}.`
      );
      setOpen(false);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Revoke
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke access</DialogTitle>
          <DialogDescription>
            {trainerLabel} keeps read-only access for a grace window, then
            drops to zero. Records you've shared stay in their account's
            archive — they just can't see new activity after the window.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label htmlFor="grace_days" className="text-sm font-medium text-foreground">
            Grace window
          </label>
          <select
            id="grace_days"
            value={graceDays}
            onChange={(e) => setGraceDays(Number(e.target.value))}
            disabled={mutation.isPending}
            className={cn(
              "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            )}
          >
            <option value={0}>End immediately</option>
            <option value={1}>1 day</option>
            <option value={7}>7 days (default)</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days (max)</option>
          </select>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={mutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? "Revoking…" : "Revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Skeleton() {
  return (
    <ul className="space-y-2">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-16 animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </ul>
  );
}
