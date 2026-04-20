import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  PLATFORM_FEES_QUERY_KEY,
  bpsToPercent,
  getFees,
  setDefaultFee,
  setTrainerOverride,
  type FeesResponse,
  type TrainerFeeOverride,
} from "@/lib/platformFees";
import { searchAdminUsers } from "@/lib/admin";

// PlatformFeesIndex — /admin/settings/fees
//
// Silver Lining admin only. Two sections:
//   1. Default fee (bps) — the baseline platform take that
//      effective_fee_bps() returns when a trainer has no override.
//   2. Trainer overrides — one row per stripe_connect_accounts.fee_override_bps
//      that isn't null. Admin can edit or clear.
//
// Every mutation goes through /api/admin/fees/* which re-validates the
// silver_lining role on the server side — this page's gating is purely
// for UX; security lives in the Worker.

function percentStringToBps(pct: string): number | null {
  const n = Number(pct);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.round(n * 100);
}

function bpsToEditableString(bps: number): string {
  return (bps / 100).toString();
}

export default function PlatformFeesIndex() {
  const queryClient = useQueryClient();
  const feesQ = useQuery({
    queryKey: PLATFORM_FEES_QUERY_KEY,
    queryFn: getFees,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Platform fees</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Controls what percentage Mane Line keeps on every session payment.
          Default applies to all trainers; overrides carve out exceptions
          for VIPs or special partnerships.
        </p>
      </div>

      {feesQ.isLoading ? (
        <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : feesQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn't load fee settings. {mapSupabaseError(feesQ.error as Error)}
          </CardContent>
        </Card>
      ) : feesQ.data ? (
        <>
          <DefaultFeeCard
            fees={feesQ.data}
            onSaved={() =>
              queryClient.invalidateQueries({ queryKey: PLATFORM_FEES_QUERY_KEY })
            }
          />
          <TrainerOverridesCard
            overrides={feesQ.data.overrides}
            onChanged={() =>
              queryClient.invalidateQueries({ queryKey: PLATFORM_FEES_QUERY_KEY })
            }
          />
        </>
      ) : null}
    </div>
  );
}

function DefaultFeeCard({
  fees,
  onSaved,
}: {
  fees: FeesResponse;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(bpsToEditableString(fees.default_fee_bps));
  const dirty = useMemo(
    () => percentStringToBps(value) !== fees.default_fee_bps,
    [value, fees.default_fee_bps],
  );

  const mutation = useMutation({
    mutationFn: (bps: number) => setDefaultFee(bps),
    onSuccess: () => {
      notify.success("Default fee updated.");
      onSaved();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSave() {
    const bps = percentStringToBps(value);
    if (bps === null) {
      notify.error("Enter a percentage between 0 and 100.");
      return;
    }
    mutation.mutate(bps);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Default fee</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="default_fee_pct">Percent of each session charge</Label>
          <div className="relative max-w-xs">
            <Input
              id="default_fee_pct"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              max={100}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="pr-9"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Stored as basis points — 10% = 1000 bps. Trainers with an
            override below bypass this value.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onSave} disabled={!dirty || mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save default"}
          </Button>
          <p className="text-xs text-muted-foreground">
            Current: {bpsToPercent(fees.default_fee_bps)}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function TrainerOverridesCard({
  overrides,
  onChanged,
}: {
  overrides: TrainerFeeOverride[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const existingIds = useMemo(
    () => new Set(overrides.map((o) => o.trainer_id)),
    [overrides],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Trainer overrides</CardTitle>
        <Button
          size="sm"
          onClick={() => setAdding(true)}
          disabled={adding}
        >
          Add override
        </Button>
      </CardHeader>
      <CardContent>
        {adding ? (
          <div className="mb-4">
            <AddOverrideForm
              excludeTrainerIds={existingIds}
              onCancel={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                onChanged();
              }}
            />
          </div>
        ) : null}
        {overrides.length === 0 && !adding ? (
          <p className="text-sm text-muted-foreground">
            No overrides set. Every trainer currently pays the default fee.
            Use <strong>Add override</strong> above to carve out an exception.
          </p>
        ) : overrides.length === 0 ? null : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead>Override</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead className="w-[1%] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overrides.map((o) =>
                editing === o.trainer_id ? (
                  <OverrideEditRow
                    key={o.trainer_id}
                    override={o}
                    onDone={() => {
                      setEditing(null);
                      onChanged();
                    }}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <TableRow key={o.trainer_id}>
                    <TableCell className="font-medium">{o.trainer_name}</TableCell>
                    <TableCell>{bpsToPercent(o.fee_override_bps)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {o.reason || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setEditing(o.trainer_id)}
                        >
                          Edit
                        </Button>
                        <ClearOverrideButton
                          trainerId={o.trainer_id}
                          trainerName={o.trainer_name}
                          onCleared={onChanged}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function AddOverrideForm({
  excludeTrainerIds,
  onSaved,
  onCancel,
}: {
  excludeTrainerIds: Set<string>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [trainerId, setTrainerId] = useState("");
  const [pct, setPct] = useState("");
  const [reason, setReason] = useState("");

  const trainersQ = useQuery({
    queryKey: ["admin", "users", "trainers"] as const,
    queryFn: () => searchAdminUsers({ role: "trainer" }),
  });

  const candidates = useMemo(() => {
    const rows = trainersQ.data?.rows ?? [];
    return rows.filter(
      (u) => u.status === "active" && !excludeTrainerIds.has(u.user_id),
    );
  }, [trainersQ.data, excludeTrainerIds]);

  const mutation = useMutation({
    mutationFn: (input: { trainer_id: string; bps: number; reason: string }) =>
      setTrainerOverride({
        trainer_id: input.trainer_id,
        fee_override_bps: input.bps,
        reason: input.reason.trim() || null,
      }),
    onSuccess: () => {
      notify.success("Override added.");
      onSaved();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSave() {
    if (!trainerId) {
      notify.error("Pick a trainer.");
      return;
    }
    const bps = percentStringToBps(pct);
    if (bps === null) {
      notify.error("Enter a percentage between 0 and 100.");
      return;
    }
    mutation.mutate({ trainer_id: trainerId, bps, reason });
  }

  return (
    <div className="rounded-md border border-border bg-muted/20 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_120px_1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="add-trainer">Trainer</Label>
          <select
            id="add-trainer"
            value={trainerId}
            onChange={(e) => setTrainerId(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            disabled={trainersQ.isLoading}
          >
            <option value="">
              {trainersQ.isLoading
                ? "Loading trainers…"
                : candidates.length === 0
                ? "No eligible trainers"
                : "Select a trainer…"}
            </option>
            {candidates.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {u.display_name || u.email} ({u.email})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-pct">Fee %</Label>
          <div className="relative">
            <Input
              id="add-pct"
              type="number"
              inputMode="decimal"
              step="0.01"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className="pr-7"
            />
            <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="add-reason">Reason (optional)</Label>
          <Input
            id="add-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="VIP, launch partner, etc."
          />
        </div>
        <div className="flex items-end gap-2">
          <Button onClick={onSave} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button variant="outline" onClick={onCancel} disabled={mutation.isPending}>
            Cancel
          </Button>
        </div>
      </div>
      {trainersQ.isError ? (
        <p className="mt-2 text-xs text-destructive">
          Couldn't load trainer list. {mapSupabaseError(trainersQ.error as Error)}
        </p>
      ) : null}
    </div>
  );
}

function OverrideEditRow({
  override: o,
  onDone,
  onCancel,
}: {
  override: TrainerFeeOverride;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [pct, setPct] = useState(bpsToEditableString(o.fee_override_bps));
  const [reason, setReason] = useState(o.reason ?? "");

  const mutation = useMutation({
    mutationFn: (input: { bps: number; reason: string }) =>
      setTrainerOverride({
        trainer_id: o.trainer_id,
        fee_override_bps: input.bps,
        reason: input.reason.trim() || null,
      }),
    onSuccess: () => {
      notify.success(`${o.trainer_name} override updated.`);
      onDone();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSave() {
    const bps = percentStringToBps(pct);
    if (bps === null) {
      notify.error("Enter a percentage between 0 and 100.");
      return;
    }
    mutation.mutate({ bps, reason });
  }

  return (
    <TableRow>
      <TableCell className="font-medium align-top">{o.trainer_name}</TableCell>
      <TableCell className="align-top">
        <div className="relative max-w-[7rem]">
          <Input
            type="number"
            inputMode="decimal"
            step="0.01"
            min={0}
            max={100}
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="pr-7"
            aria-label="Override percent"
          />
          <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">
            %
          </span>
        </div>
      </TableCell>
      <TableCell className="align-top">
        <Input
          type="text"
          placeholder="Why does this trainer get an exception?"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Override reason"
        />
      </TableCell>
      <TableCell className="text-right align-top">
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={onSave} disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onCancel}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ClearOverrideButton({
  trainerId,
  trainerName,
  onCleared,
}: {
  trainerId: string;
  trainerName: string;
  onCleared: () => void;
}) {
  const mutation = useMutation({
    mutationFn: () =>
      setTrainerOverride({
        trainer_id: trainerId,
        fee_override_bps: null,
        reason: null,
      }),
    onSuccess: () => {
      notify.success(`${trainerName} reverted to the default fee.`);
      onCleared();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={() => mutation.mutate()}
      disabled={mutation.isPending}
    >
      {mutation.isPending ? "Clearing…" : "Clear"}
    </Button>
  );
}
