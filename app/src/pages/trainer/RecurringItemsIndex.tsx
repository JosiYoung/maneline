import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

import { useAuthStore } from "@/lib/authStore";
import { formatCentsUsd } from "@/lib/expenses";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  TRAINER_CLIENTS_QUERY_KEY,
  listClientGrants,
  activeOrGrace,
} from "@/lib/trainerAccess";
import {
  RECURRING_QUERY_KEY,
  listRecurringItems,
  createRecurringItem,
  setRecurringActive,
  type RecurringLineItem,
} from "@/lib/recurringLineItems";

// RecurringItemsIndex — /trainer/invoices/recurring
//
// Trainer-configured standing charges (board, lesson retainer, etc.).
// The hourly cron stamps one line per active row onto each monthly
// draft invoice for the matching (trainer, subject) pair. Retire via
// "Deactivate"; historical invoices keep their source_id pointer.

export default function RecurringItemsIndex() {
  const trainerId = useAuthStore((s) => s.session?.user.id) ?? null;
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);

  const q = useQuery({
    queryKey: [...RECURRING_QUERY_KEY, showInactive ? "all" : "active"] as const,
    queryFn: () => {
      if (!trainerId) throw new Error("Not signed in.");
      return listRecurringItems(trainerId, { includeInactive: showInactive });
    },
    enabled: Boolean(trainerId),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setRecurringActive(id, active),
    onSuccess: (_row, { active }) => {
      qc.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
      notify.success(active ? "Recurring item reactivated" : "Recurring item deactivated");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link
            to="/trainer/invoices"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to invoices
          </Link>
          <h1 className="mt-2 text-3xl">Recurring charges</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Standing charges that get added to each monthly draft invoice — board,
            lesson retainers, etc. The auto-finalize cron stamps one line per
            active row per period.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? "Hide inactive" : "Show inactive"}
        </Button>
      </div>

      <NewRecurringForm trainerId={trainerId} />

      {q.isLoading && <LoadingCard />}
      {q.isError && <ErrorCard />}
      {!q.isLoading && !q.isError && rows.length === 0 && <EmptyCard />}
      {!q.isLoading && !q.isError && rows.length > 0 && (
        <RecurringTable
          rows={rows}
          onToggle={(row) =>
            toggleActive.mutate({ id: row.id, active: !row.active })
          }
          disabled={toggleActive.isPending}
        />
      )}
    </div>
  );
}

// -----------------------------------------------------------
// New-recurring form — inline card above the list. Mirrors the
// NewInvoiceDialog client/ad-hoc split but as a single panel.
// -----------------------------------------------------------

function NewRecurringForm({ trainerId }: { trainerId: string | null }) {
  const qc = useQueryClient();

  const clientsQ = useQuery({
    queryKey: TRAINER_CLIENTS_QUERY_KEY,
    queryFn: listClientGrants,
    enabled: Boolean(trainerId),
  });

  const clients = useMemo(() => {
    const rows = activeOrGrace(clientsQ.data ?? []);
    const seen = new Set<string>();
    const out: { id: string; name: string; email: string | null }[] = [];
    for (const g of rows) {
      if (seen.has(g.owner_id)) continue;
      seen.add(g.owner_id);
      out.push({
        id:    g.owner_id,
        name:  g.owner_display_name || g.owner_email || "Unnamed client",
        email: g.owner_email,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [clientsQ.data]);

  const [mode, setMode] = useState<"client" | "adhoc">("client");
  const [ownerId, setOwnerId] = useState<string>("");
  const [adhocEmail, setAdhocEmail] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(""); // dollars, not cents

  const save = useMutation({
    mutationFn: async () => {
      if (!trainerId) throw new Error("Not signed in.");
      const desc = description.trim();
      if (!desc) throw new Error("Description is required.");
      if (desc.length > 200) throw new Error("Description must be 200 characters or fewer.");

      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        throw new Error("Amount must be greater than zero.");
      }
      const amountCents = Math.round(amountNum * 100);

      let chosenOwner: string | null = null;
      let chosenEmail: string | null = null;
      if (mode === "client") {
        if (!ownerId) throw new Error("Pick a client first.");
        chosenOwner = ownerId;
      } else {
        const email = adhocEmail.trim();
        if (!email) throw new Error("Client email is required.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          throw new Error("That email looks off — double-check it.");
        }
        chosenEmail = email;
      }

      return createRecurringItem({
        trainerId,
        ownerId:    chosenOwner,
        adhocEmail: chosenEmail,
        description: desc,
        amountCents,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RECURRING_QUERY_KEY });
      notify.success("Recurring charge added");
      setDescription("");
      setAmount("");
      setAdhocEmail("");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card>
      <CardContent className="py-5">
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Bill to</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={mode === "client" ? "default" : "outline"}
                onClick={() => setMode("client")}
                disabled={save.isPending}
              >
                Active client
              </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "adhoc" ? "default" : "outline"}
                onClick={() => setMode("adhoc")}
                disabled={save.isPending}
              >
                One-off (ad-hoc)
              </Button>
            </div>
          </div>

          {mode === "client" && (
            <div className="space-y-2">
              <Label htmlFor="rec-owner">Client</Label>
              {clientsQ.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading clients…</p>
              ) : clients.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No active clients. Switch to one-off to bill by email.
                </p>
              ) : (
                <select
                  id="rec-owner"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  disabled={save.isPending}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">— pick a client —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.email ? ` · ${c.email}` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {mode === "adhoc" && (
            <div className="space-y-2">
              <Label htmlFor="rec-email">Client email</Label>
              <Input
                id="rec-email"
                type="email"
                value={adhocEmail}
                onChange={(e) => setAdhocEmail(e.target.value)}
                disabled={save.isPending}
                placeholder="billing@example.com"
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <div className="space-y-2">
              <Label htmlFor="rec-description">Description</Label>
              <Input
                id="rec-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={save.isPending}
                placeholder="Monthly board — full care"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rec-amount">Amount (USD)</Label>
              <Input
                id="rec-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={save.isPending}
                placeholder="500.00"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              <Plus className="mr-1 h-4 w-4" />
              Add recurring charge
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------
// Table + empty/loading/error states
// -----------------------------------------------------------

function RecurringTable({
  rows,
  onToggle,
  disabled,
}: {
  rows: RecurringLineItem[];
  onToggle: (row: RecurringLineItem) => void;
  disabled: boolean;
}) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Subject</TableHead>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="text-sm">
                {r.owner_id ? (
                  <span className="text-muted-foreground">Client · {r.owner_id.slice(0, 8)}…</span>
                ) : (
                  <span>{r.adhoc_email}</span>
                )}
              </TableCell>
              <TableCell className="font-medium">{r.description}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCentsUsd(r.amount_cents)}
              </TableCell>
              <TableCell>
                <Badge variant={r.active ? "default" : "secondary"}>
                  {r.active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => onToggle(r)}
                  aria-label={r.active ? "Deactivate" : "Reactivate"}
                >
                  {r.active ? (
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  )}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Loading recurring charges…
      </CardContent>
    </Card>
  );
}

function ErrorCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-destructive">
        Couldn't load recurring charges. Try refreshing the page.
      </CardContent>
    </Card>
  );
}

function EmptyCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        No recurring charges yet. Add one above to start auto-billing monthly.
      </CardContent>
    </Card>
  );
}
