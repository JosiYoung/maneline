import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, Loader2, Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  PRO_CONTACTS_QUERY_KEY,
  archiveProContact,
  createProContact,
  formatProRole,
  listProContacts,
  updateProContact,
  type ProContact,
  type ProContactRole,
} from "@/lib/barn";

// BarnContacts — /app/barn/contacts.
//
// Owner-scoped directory of farriers / vets / bodyworkers etc. that the
// Calendar's invitee picker pulls from. Archive (not delete) per OAG §8;
// historical barn_events keep their pro_contact_id FK intact.

const ROLES: ProContactRole[] = [
  "farrier",
  "vet",
  "nutritionist",
  "bodyworker",
  "trainer",
  "boarding",
  "hauler",
  "other",
];

interface FormState {
  id: string | null;
  display_name: string;
  role: ProContactRole;
  email: string;
  phone_e164: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  id: null,
  display_name: "",
  role: "farrier",
  email: "",
  phone_e164: "",
  notes: "",
};

export default function BarnContacts() {
  const qc = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<FormState | null>(null);

  const q = useQuery({
    queryKey: [...PRO_CONTACTS_QUERY_KEY, { archived: showArchived }] as const,
    queryFn: () =>
      listProContacts({ includeArchived: showArchived }),
  });

  const archive = useMutation({
    mutationFn: (id: string) => archiveProContact(id),
    onSuccess: () => {
      notify.success("Contact archived");
      qc.invalidateQueries({ queryKey: PRO_CONTACTS_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const rows = q.data ?? [];
  const byRole = useMemo(() => {
    const acc = new Map<ProContactRole, ProContact[]>();
    for (const c of rows) {
      const arr = acc.get(c.role) ?? [];
      arr.push(c);
      acc.set(c.role, arr);
    }
    return acc;
  }, [rows]);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-primary">Professional contacts</h1>
          <p className="text-sm text-muted-foreground">
            Your barn's rolodex. Saved contacts show up in the Calendar
            invitee picker.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({ ...EMPTY_FORM })}>
          <Plus className="mr-1 h-4 w-4" /> New contact
        </Button>
      </header>

      <div className="flex items-center gap-3 text-xs">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
      </div>

      {q.isLoading && <Skeleton className="h-40 w-full" />}

      {!q.isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No contacts yet. Add your farrier or vet to start inviting them to
            events.
          </CardContent>
        </Card>
      )}

      {!q.isLoading && rows.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead className="hidden sm:table-cell">Email</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ROLES.flatMap((role) => byRole.get(role) ?? []).map((c) => (
                  <TableRow
                    key={c.id}
                    className={c.archived_at ? "opacity-60" : ""}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {c.display_name}
                        {c.linked_user_id && (
                          <Badge variant="outline" className="text-[10px]">
                            In-app
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{formatProRole(c.role)}</Badge>
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {c.email ?? "—"}
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                      {c.phone_e164 ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            setEditing({
                              id: c.id,
                              display_name: c.display_name,
                              role: c.role,
                              email: c.email ?? "",
                              phone_e164: c.phone_e164 ?? "",
                              notes: c.notes ?? "",
                            })
                          }
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {!c.archived_at && (
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              if (confirm(`Archive ${c.display_name}?`)) {
                                archive.mutate(c.id);
                              }
                            }}
                            disabled={archive.isPending}
                            aria-label="Archive"
                          >
                            <Archive className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ContactFormDialog
        state={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: PRO_CONTACTS_QUERY_KEY });
        }}
      />
    </div>
  );
}

function ContactFormDialog({
  state,
  onClose,
  onSaved,
}: {
  state: FormState | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = Boolean(state);
  const [local, setLocal] = useState<FormState>(EMPTY_FORM);

  // Sync local form when dialog opens with a new state.
  useEffect(() => {
    if (state) setLocal(state);
  }, [state]);

  const save = useMutation({
    mutationFn: async () => {
      const patch = {
        display_name: local.display_name.trim(),
        role: local.role,
        email: local.email.trim() || null,
        phone_e164: local.phone_e164.trim() || null,
        notes: local.notes.trim() || null,
      };
      if (local.id) return updateProContact(local.id, patch);
      return createProContact({
        display_name: patch.display_name,
        role: patch.role,
        email: patch.email,
        phone_e164: patch.phone_e164,
        notes: patch.notes,
      });
    },
    onSuccess: () => {
      notify.success(local.id ? "Contact updated" : "Contact added");
      onSaved();
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!local.display_name.trim()) {
      notify.error("Name is required.");
      return;
    }
    if (!local.email.trim() && !local.phone_e164.trim()) {
      notify.error("Add an email or phone number.");
      return;
    }
    if (local.phone_e164.trim() && !/^\+[1-9][0-9]{6,14}$/.test(local.phone_e164.trim())) {
      notify.error("Phone must be E.164 format (e.g. +14155551234).");
      return;
    }
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {local.id ? "Edit contact" : "New professional contact"}
          </DialogTitle>
          <DialogDescription>
            This contact will appear in the invitee picker when scheduling
            events.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pc-name">Name</Label>
            <Input
              id="pc-name"
              value={local.display_name}
              onChange={(e) =>
                setLocal((p) => ({ ...p, display_name: e.target.value }))
              }
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pc-role">Role</Label>
            <select
              id="pc-role"
              value={local.role}
              onChange={(e) =>
                setLocal((p) => ({ ...p, role: e.target.value as ProContactRole }))
              }
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {formatProRole(r)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pc-email">Email</Label>
            <Input
              id="pc-email"
              type="email"
              value={local.email}
              onChange={(e) => setLocal((p) => ({ ...p, email: e.target.value }))}
              placeholder="farrier@example.com"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pc-phone">Phone (E.164)</Label>
            <Input
              id="pc-phone"
              value={local.phone_e164}
              onChange={(e) =>
                setLocal((p) => ({ ...p, phone_e164: e.target.value }))
              }
              placeholder="+14155551234"
            />
            <p className="text-xs text-muted-foreground">
              Must start with <code>+</code> and country code.
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="pc-notes">Notes</Label>
            <Textarea
              id="pc-notes"
              rows={3}
              value={local.notes}
              onChange={(e) => setLocal((p) => ({ ...p, notes: e.target.value }))}
              maxLength={2000}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={save.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              )}
              {local.id ? "Save changes" : "Add contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
