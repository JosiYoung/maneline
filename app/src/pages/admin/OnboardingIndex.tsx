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
  INVITATIONS_QUERY_KEY,
  archiveInvitation,
  createInvitation,
  createInvitationsBulk,
  listInvitations,
  parseInvitationsCsv,
  resendInvitation,
  type BulkInvitationResult,
  type CreateInvitationInput,
  type InvitationRow,
  type InvitationStatus,
} from "@/lib/invitations";
import { mapSupabaseError } from "@/lib/errors";
import { notify } from "@/lib/toast";

type StatusFilter = InvitationStatus | "";

const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "invited", label: "Invited" },
  { value: "activated", label: "Activated" },
  { value: "expired", label: "Expired" },
  { value: "archived", label: "Archived" },
  { value: "", label: "All" },
];

export default function OnboardingIndex() {
  const [status, setStatus] = useState<StatusFilter>("invited");
  const [singleOpen, setSingleOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const qc = useQueryClient();

  const listQ = useQuery({
    queryKey: [...INVITATIONS_QUERY_KEY, { status }] as const,
    queryFn: () => listInvitations(status || undefined),
    refetchInterval: 60_000,
  });

  const resendM = useMutation({
    mutationFn: (id: string) => resendInvitation(id),
    onSuccess: () => {
      notify.success("Invitation re-sent");
      qc.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  const archiveM = useMutation({
    mutationFn: (id: string) => archiveInvitation(id),
    onSuccess: () => {
      notify.success("Invitation archived");
      qc.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY });
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  const rows = listQ.data ?? [];
  const counts = useMemo(() => summarizeCounts(rows), [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl">Closed-beta onboarding</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Invite owners + trainers, track activation, resend expiring links.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}>
            Bulk upload
          </Button>
          <Button onClick={() => setSingleOpen(true)}>Invite</Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-4 py-4 text-xs text-muted-foreground">
          <Stat label="Invited" value={counts.invited} />
          <Stat label="Activated" value={counts.activated} />
          <Stat label="First session" value={counts.firstSessionLogged} />
          <Stat label="Expired" value={counts.expired} />
        </CardContent>
      </Card>

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
            Couldn't load invitations. {mapSupabaseError(listQ.error as Error)}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Barn</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invited</TableHead>
                  <TableHead>First session</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listQ.isLoading && rows.length === 0 ? (
                  <LoadingRow />
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                      Nothing in this view.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <Row
                      key={row.id}
                      row={row}
                      onResend={() => resendM.mutate(row.id)}
                      onArchive={() => archiveM.mutate(row.id)}
                      busy={resendM.isPending || archiveM.isPending}
                    />
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <SingleInviteDialog
        open={singleOpen}
        onOpenChange={setSingleOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY })}
      />
      <BulkInviteDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: INVITATIONS_QUERY_KEY })}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold text-foreground">{value}</div>
      <div>{label}</div>
    </div>
  );
}

function summarizeCounts(rows: InvitationRow[]) {
  let invited = 0, activated = 0, expired = 0, firstSessionLogged = 0;
  for (const r of rows) {
    if (r.status === "invited") invited++;
    if (r.status === "activated") activated++;
    if (r.status === "expired") expired++;
    if (r.first_session_logged_at) firstSessionLogged++;
  }
  return { invited, activated, expired, firstSessionLogged };
}

function Row({
  row,
  onResend,
  onArchive,
  busy,
}: {
  row: InvitationRow;
  onResend: () => void;
  onArchive: () => void;
  busy: boolean;
}) {
  const invited = useMemo(() => new Date(row.invited_at).toLocaleString(), [row.invited_at]);
  const canResend = row.status === "invited" || row.status === "expired";
  const firstSession = row.first_session_logged_at
    ? new Date(row.first_session_logged_at).toLocaleDateString()
    : "—";
  return (
    <TableRow>
      <TableCell className="font-mono text-xs">{row.email}</TableCell>
      <TableCell className="capitalize">{row.role}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{row.barn_name || "—"}</TableCell>
      <TableCell><StatusBadge status={row.status} /></TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{invited}</TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{firstSession}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          {canResend ? (
            <Button size="sm" variant="outline" onClick={onResend} disabled={busy}>
              Resend
            </Button>
          ) : null}
          {row.status !== "archived" ? (
            <Button size="sm" variant="ghost" onClick={onArchive} disabled={busy}>
              Archive
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function StatusBadge({ status }: { status: InvitationStatus }) {
  const variant =
    status === "activated" ? "default"
    : status === "invited"  ? "secondary"
    : status === "expired"  ? "destructive"
    : "outline";
  return <Badge variant={variant} className="capitalize">{status}</Badge>;
}

function LoadingRow() {
  return (
    <TableRow>
      <TableCell colSpan={7} className="py-6">
        <div className="h-6 w-full animate-pulse rounded bg-muted/50" />
      </TableCell>
    </TableRow>
  );
}

// ---------- Single invite dialog ----------------------------------------

function SingleInviteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "trainer">("owner");
  const [barn, setBarn] = useState("");

  const createM = useMutation({
    mutationFn: (input: CreateInvitationInput) => createInvitation(input),
    onSuccess: () => {
      notify.success(`Invited ${email}`);
      onCreated();
      setEmail(""); setBarn(""); setRole("owner");
      onOpenChange(false);
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setEmail(""); setBarn(""); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to closed beta</DialogTitle>
          <DialogDescription>
            A branded email with a one-time magic link will be sent to this address.
            The invite expires in 14 days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="inv-email">Email</Label>
            <Input
              id="inv-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="rider@example.com"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={role === "owner" ? "default" : "outline"}
              size="sm"
              onClick={() => setRole("owner")}
            >
              Owner
            </Button>
            <Button
              type="button"
              variant={role === "trainer" ? "default" : "outline"}
              size="sm"
              onClick={() => setRole("trainer")}
            >
              Trainer
            </Button>
          </div>
          {role === "owner" ? (
            <div>
              <Label htmlFor="inv-barn">Barn name (optional)</Label>
              <Input
                id="inv-barn"
                value={barn}
                onChange={(e) => setBarn(e.target.value)}
                placeholder="Flying Y Ranch"
              />
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={createM.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              createM.mutate({
                email: email.trim().toLowerCase(),
                role,
                barn_name: barn.trim() || undefined,
              })
            }
            disabled={createM.isPending || !email.trim()}
          >
            {createM.isPending ? "Inviting…" : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------- Bulk invite dialog ------------------------------------------

function BulkInviteDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [csv, setCsv] = useState("email,role,barn_name\n");
  const [batch, setBatch] = useState("");
  const parsed = useMemo(() => parseInvitationsCsv(csv), [csv]);
  const [result, setResult] = useState<BulkInvitationResult | null>(null);

  const bulkM = useMutation({
    mutationFn: () => createInvitationsBulk(parsed.valid, batch.trim() || undefined),
    onSuccess: (res) => {
      setResult(res);
      const created = res.results.filter((r) => r.ok).length;
      notify.success(`Invited ${created} of ${res.results.length}`);
      onCreated();
    },
    onError: (e: Error) => notify.error(mapSupabaseError(e)),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setResult(null); } }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Bulk upload</DialogTitle>
          <DialogDescription>
            Paste CSV with <code>email,role,barn_name</code> header. Up to 200 rows.
            Role must be <code>owner</code> or <code>trainer</code>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="inv-batch">Batch tag (optional)</Label>
            <Input
              id="inv-batch"
              value={batch}
              onChange={(e) => setBatch(e.target.value)}
              placeholder="2026-05-25"
            />
          </div>
          <div>
            <Label htmlFor="inv-csv">CSV</Label>
            <Textarea
              id="inv-csv"
              rows={10}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              className="font-mono text-xs"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {parsed.valid.length} valid row{parsed.valid.length === 1 ? "" : "s"}
            {parsed.errors.length ? ` · ${parsed.errors.length} error${parsed.errors.length === 1 ? "" : "s"}` : ""}
          </div>
          {parsed.errors.length ? (
            <div className="max-h-32 overflow-auto rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
              {parsed.errors.map((e, i) => (
                <div key={i}>Line {e.line}: {e.error}</div>
              ))}
            </div>
          ) : null}
          {result ? (
            <div className="max-h-40 overflow-auto rounded border border-border p-2 text-xs">
              {result.results.map((r, i) => (
                <div key={i} className={r.ok ? "text-muted-foreground" : "text-destructive"}>
                  {r.email}: {r.ok ? `invited${r.email_sent ? "" : " (email skipped)"}` : r.error}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={bulkM.isPending}>
            Close
          </Button>
          <Button
            onClick={() => bulkM.mutate()}
            disabled={bulkM.isPending || parsed.valid.length === 0}
          >
            {bulkM.isPending ? "Sending…" : `Send ${parsed.valid.length} invite${parsed.valid.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
