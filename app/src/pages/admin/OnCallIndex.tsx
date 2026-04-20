import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  ADMIN_ON_CALL_QUERY_KEY,
  ADMIN_SMS_DISPATCHES_QUERY_KEY,
  archiveOnCallEntry,
  createOnCallEntry,
  listOnCallSchedule,
  listSmsDispatches,
  type CreateOnCallInput,
  type OnCallRow,
  type SmsDispatchRow,
} from "@/lib/onCall";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";

// OnCallIndex — /admin/on-call
//
// Phase 6.4. Manages the on-call roster for emergency SMS pages +
// shows the recent dispatch log. Exclusion constraint on
// on_call_schedule.tstzrange prevents overlapping active rows, so a
// bad create returns 409 error=overlap from the Worker.

const E164_RE = /^\+[1-9][0-9]{6,14}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

export default function OnCallIndex() {
  const [scope, setScope] = useState<"active" | "all">("active");
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();

  const rosterQ = useQuery({
    queryKey: [...ADMIN_ON_CALL_QUERY_KEY, { scope }] as const,
    queryFn: () => listOnCallSchedule(scope),
    refetchInterval: 60_000,
  });

  const dispatchesQ = useQuery({
    queryKey: ADMIN_SMS_DISPATCHES_QUERY_KEY,
    queryFn: () => listSmsDispatches(),
    refetchInterval: 30_000,
  });

  const archiveM = useMutation({
    mutationFn: (id: string) => archiveOnCallEntry(id),
    onSuccess: () => {
      notify.success("Schedule row archived");
      qc.invalidateQueries({ queryKey: ADMIN_ON_CALL_QUERY_KEY });
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  const rows = rosterQ.data ?? [];
  const dispatches = dispatchesQ.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">On-call rotation</h1>
          <p className="text-sm text-muted-foreground">
            Every emergency-follow-up ticket pages the current on-call admin by SMS.
            Overlapping active windows are rejected by the database.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as "active" | "all")}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
          >
            <option value="active">Active only</option>
            <option value="all">Active + archived</option>
          </select>
          <Button onClick={() => setCreateOpen(true)}>Add shift</Button>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead>Ends</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-1">{""}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rosterQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Loading roster…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No on-call rows. Add the first shift — emergency pages will fail open until one exists.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => <OnCallRowView key={r.id} row={r} onArchive={() => archiveM.mutate(r.id)} />)
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <header className="flex items-end justify-between gap-3 pt-4">
        <div>
          <h2 className="text-xl font-semibold">Recent dispatches</h2>
          <p className="text-sm text-muted-foreground">
            Last 200 Twilio sends. Status transitions via the delivery-status webhook.
          </p>
        </div>
      </header>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Delivered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispatchesQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Loading dispatches…
                  </TableCell>
                </TableRow>
              ) : dispatches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    No dispatches yet.
                  </TableCell>
                </TableRow>
              ) : (
                dispatches.map((d) => <DispatchRowView key={d.id} row={d} />)
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateShiftDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ADMIN_ON_CALL_QUERY_KEY });
        }}
      />
    </div>
  );
}

function OnCallRowView({ row, onArchive }: { row: OnCallRow; onArchive: () => void }) {
  const label = row.user_display_name || row.user_email || row.user_id.slice(0, 8);
  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{label}</div>
        {row.notes ? <div className="text-xs text-muted-foreground">{row.notes}</div> : null}
      </TableCell>
      <TableCell className="font-mono text-xs">{row.phone_e164}</TableCell>
      <TableCell className="text-xs">{formatDate(row.starts_at)}</TableCell>
      <TableCell className="text-xs">{formatDate(row.ends_at)}</TableCell>
      <TableCell>
        {row.archived_at ? (
          <Badge variant="outline">Archived</Badge>
        ) : row.is_current ? (
          <Badge>On call now</Badge>
        ) : new Date(row.starts_at) > new Date() ? (
          <Badge variant="secondary">Upcoming</Badge>
        ) : (
          <Badge variant="outline">Past</Badge>
        )}
      </TableCell>
      <TableCell>
        {row.archived_at ? null : (
          <Button size="sm" variant="outline" onClick={onArchive}>
            Archive
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

function DispatchRowView({ row }: { row: SmsDispatchRow }) {
  return (
    <TableRow>
      <TableCell className="text-xs">{formatDate(row.created_at)}</TableCell>
      <TableCell className="font-mono text-xs">{row.ticket_id ? row.ticket_id.slice(0, 8) : "—"}</TableCell>
      <TableCell className="font-mono text-xs">{row.to_phone}</TableCell>
      <TableCell>
        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {row.error_code ? `#${row.error_code}` : "—"}
      </TableCell>
      <TableCell className="text-xs">{row.delivered_at ? formatDate(row.delivered_at) : "—"}</TableCell>
    </TableRow>
  );
}

function statusVariant(s: SmsDispatchRow["status"]): "default" | "secondary" | "destructive" | "outline" {
  switch (s) {
    case "delivered": return "default";
    case "sent":
    case "queued":    return "secondary";
    case "failed":
    case "undelivered": return "destructive";
    default:          return "outline";
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function CreateShiftDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [userId, setUserId] = useState("");
  const [phone, setPhone] = useState("+1");
  const [starts, setStarts] = useState(() => toLocalInput(new Date()));
  const [ends, setEnds] = useState(() => toLocalInput(addYears(new Date(), 1)));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createM = useMutation({
    mutationFn: (input: CreateOnCallInput) => createOnCallEntry(input),
    onSuccess: () => {
      notify.success("Shift added");
      onOpenChange(false);
      onCreated();
    },
    onError: (e: Error) => {
      const code = (e as Error & { code?: string }).code;
      if (code === "overlap") {
        setError("That window overlaps an existing active shift.");
      } else {
        setError(mapSupabaseError(e));
      }
    },
  });

  function submit() {
    setError(null);
    if (!UUID_RE.test(userId.trim())) {
      setError("Admin user id must be a UUID.");
      return;
    }
    if (!E164_RE.test(phone.trim())) {
      setError("Phone must be E.164 (e.g. +15551234567).");
      return;
    }
    const startsIso = new Date(starts).toISOString();
    const endsIso = new Date(ends).toISOString();
    if (new Date(endsIso) <= new Date(startsIso)) {
      setError("Ends must be after starts.");
      return;
    }
    createM.mutate({
      user_id: userId.trim(),
      phone_e164: phone.trim(),
      starts_at: startsIso,
      ends_at: endsIso,
      notes: notes.trim() || null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add on-call shift</DialogTitle>
          <DialogDescription>
            Paste the admin's <code>user_profiles.user_id</code> and a registered
            E.164 phone. Ranges cannot overlap active rows.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="on-call-user">Admin user id</Label>
            <Input
              id="on-call-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="on-call-phone">Phone (E.164)</Label>
            <Input
              id="on-call-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+15551234567"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="on-call-starts">Starts</Label>
              <Input
                id="on-call-starts"
                type="datetime-local"
                value={starts}
                onChange={(e) => setStarts(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="on-call-ends">Ends</Label>
              <Input
                id="on-call-ends"
                type="datetime-local"
                value={ends}
                onChange={(e) => setEnds(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="on-call-notes">Notes (optional)</Label>
            <Textarea
              id="on-call-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. weekend backup for Cedric"
              rows={2}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createM.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={createM.isPending}>
            {createM.isPending ? "Saving…" : "Save shift"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addYears(d: Date, n: number): Date {
  const out = new Date(d);
  out.setFullYear(out.getFullYear() + n);
  return out;
}
