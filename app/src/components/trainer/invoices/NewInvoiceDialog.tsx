import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useAuthStore } from "@/lib/authStore";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  TRAINER_CLIENTS_QUERY_KEY,
  listClientGrants,
  activeOrGrace,
} from "@/lib/trainerAccess";
import {
  TRAINER_BRANDING_QUERY_KEY,
  fetchTrainerBranding,
  DEFAULT_SETTINGS,
} from "@/lib/trainerBranding";
import {
  INVOICES_QUERY_KEY,
  createDraftInvoice,
  defaultDueDate,
} from "@/lib/invoices";

// NewInvoiceDialog — picks a client (or collects ad-hoc name/email),
// sets a due date (seeded from trainer_invoice_settings.default_due_net_days),
// and an optional billing period. On submit, inserts a draft row and
// navigates to /trainer/invoices/:id for line-item composition.

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewInvoiceDialog({ open, onOpenChange }: Props) {
  const trainerId = useAuthStore((s) => s.session?.user.id) ?? null;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const clientsQ = useQuery({
    queryKey: TRAINER_CLIENTS_QUERY_KEY,
    queryFn: listClientGrants,
    enabled: open,
  });
  const brandingQ = useQuery({
    queryKey: TRAINER_BRANDING_QUERY_KEY,
    queryFn: () => fetchTrainerBranding(trainerId!),
    enabled: open && Boolean(trainerId),
  });

  // Unique owner list from active-or-grace grants.
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

  const defaultNet = brandingQ.data?.settings?.default_due_net_days
    ?? DEFAULT_SETTINGS.default_due_net_days;

  // Form state. "adhoc" mode collects a name + email when the trainer
  // needs to bill someone who isn't an active client (one-off clinic,
  // external party, etc.).
  const [mode, setMode]         = useState<"client" | "adhoc">("client");
  const [ownerId, setOwnerId]   = useState<string>("");
  const [adhocName, setAdhocName]   = useState("");
  const [adhocEmail, setAdhocEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd]     = useState("");
  const [notes, setNotes]             = useState("");

  useEffect(() => {
    if (!open) return;
    // Reset each open to avoid leaking prior state.
    setMode("client");
    setOwnerId(clients[0]?.id ?? "");
    setAdhocName("");
    setAdhocEmail("");
    setDueDate(defaultDueDate(defaultNet));
    setPeriodStart("");
    setPeriodEnd("");
    setNotes("");
  }, [open, clients.length, defaultNet]);

  const save = useMutation({
    mutationFn: async () => {
      if (!trainerId) throw new Error("Not signed in.");
      if (!dueDate) throw new Error("Due date is required.");

      if (mode === "client") {
        if (!ownerId) throw new Error("Pick a client first.");
      } else {
        const name  = adhocName.trim();
        const email = adhocEmail.trim();
        if (!name)  throw new Error("Client name is required.");
        if (!email) throw new Error("Client email is required.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          throw new Error("That email looks off — double-check it.");
        }
      }

      if ((periodStart && !periodEnd) || (!periodStart && periodEnd)) {
        throw new Error("Pick both a period start and end, or neither.");
      }
      if (periodStart && periodEnd && periodEnd < periodStart) {
        throw new Error("Period end must be on or after the start.");
      }

      return createDraftInvoice({
        trainerId,
        ownerId: mode === "client" ? ownerId : null,
        adhocName:  mode === "adhoc" ? adhocName.trim() : null,
        adhocEmail: mode === "adhoc" ? adhocEmail.trim().toLowerCase() : null,
        dueDate,
        periodStart: periodStart || null,
        periodEnd:   periodEnd   || null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: INVOICES_QUERY_KEY });
      notify.success("Draft created");
      onOpenChange(false);
      navigate(`/trainer/invoices/${invoice.id}`);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate();
  }

  const noClients = !clientsQ.isLoading && clients.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New invoice</DialogTitle>
        </DialogHeader>

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
              <Label htmlFor="invoice-owner">Client</Label>
              {clientsQ.isLoading ? (
                <p className="text-xs text-muted-foreground">Loading clients…</p>
              ) : noClients ? (
                <p className="text-xs text-muted-foreground">
                  You don't have any active clients yet. Switch to "One-off" to
                  bill someone outside your roster.
                </p>
              ) : (
                <select
                  id="invoice-owner"
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  disabled={save.isPending}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="adhoc-name">Client name</Label>
                <Input
                  id="adhoc-name"
                  value={adhocName}
                  onChange={(e) => setAdhocName(e.target.value)}
                  disabled={save.isPending}
                  placeholder="Acme Equestrian"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adhoc-email">Client email</Label>
                <Input
                  id="adhoc-email"
                  type="email"
                  value={adhocEmail}
                  onChange={(e) => setAdhocEmail(e.target.value)}
                  disabled={save.isPending}
                  placeholder="billing@example.com"
                />
              </div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-due">Due date</Label>
              <Input
                id="inv-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={save.isPending}
              />
              <p className="text-xs text-muted-foreground">
                Default is {defaultNet} days out — change it per invoice if needed.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="inv-period-start">Period start (optional)</Label>
              <Input
                id="inv-period-start"
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                disabled={save.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="inv-period-end">Period end (optional)</Label>
              <Input
                id="inv-period-end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                disabled={save.isPending}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inv-notes">Notes (optional)</Label>
            <Textarea
              id="inv-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={save.isPending}
              rows={3}
              placeholder="Anything you'd like the client to see on the invoice."
              maxLength={2000}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={save.isPending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create draft
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
