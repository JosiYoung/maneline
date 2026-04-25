import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Mail, Phone, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type ProContactRole,
} from "@/lib/barn";

// ProfessionalContactsSection — embedded card-style rolodex for the
// owner's vets / farriers / nutritionists / etc. Backed by the same
// pro_contacts table as /app/barn/contacts, so contacts added here
// also show up in the Calendar invitee picker.
//
// "Delete" maps to soft-archive (pro_contacts is FK'd from
// barn_events, OAG §8) — the row disappears from the list either way,
// which matches the user-facing intent.

const ROLES: ProContactRole[] = [
  "vet",
  "farrier",
  "trainer",
  "nutritionist",
  "bodyworker",
  "boarding",
  "hauler",
  "other",
];

interface FormState {
  name: string;
  role: ProContactRole;
  email: string;
  phone_e164: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  role: "vet",
  email: "",
  phone_e164: "",
};

export function ProfessionalContactsSection() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);

  const q = useQuery({
    queryKey: [...PRO_CONTACTS_QUERY_KEY, { archived: false }] as const,
    queryFn: () => listProContacts({ includeArchived: false }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => archiveProContact(id),
    onSuccess: () => {
      notify.success("Contact removed");
      qc.invalidateQueries({ queryKey: PRO_CONTACTS_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const contacts = q.data ?? [];

  return (
    <section className="space-y-3" aria-labelledby="pro-contacts-heading">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2
            id="pro-contacts-heading"
            className="font-display text-lg text-primary"
          >
            Professional contacts
          </h2>
          <p className="text-xs text-muted-foreground">
            Vets, farriers, trainers, and anyone else on your barn's
            rolodex. Saved contacts also appear in the Calendar invitee
            picker.
          </p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Add
        </Button>
      </header>

      {q.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-lg border border-border bg-muted/40"
            />
          ))}
        </div>
      ) : q.isError ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-destructive">
            Couldn't load contacts. Try refreshing.
          </CardContent>
        </Card>
      ) : contacts.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No contacts yet. Add your vet or farrier to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {contacts.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.name}</p>
                    <Badge variant="secondary" className="mt-1">
                      {formatProRole(c.role)}
                    </Badge>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => {
                      if (
                        confirm(`Remove ${c.name}? They'll stop showing up here.`)
                      ) {
                        remove.mutate(c.id);
                      }
                    }}
                    disabled={remove.isPending}
                    aria-label={`Remove ${c.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="space-y-1 text-sm text-muted-foreground">
                  {c.email ? (
                    <a
                      href={`mailto:${c.email}`}
                      className="flex items-center gap-2 truncate hover:text-foreground"
                    >
                      <Mail className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{c.email}</span>
                    </a>
                  ) : null}
                  {c.phone_e164 ? (
                    <a
                      href={`tel:${c.phone_e164}`}
                      className="flex items-center gap-2 truncate hover:text-foreground"
                    >
                      <Phone className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{c.phone_e164}</span>
                    </a>
                  ) : null}
                  {!c.email && !c.phone_e164 ? (
                    <p className="text-xs italic">No contact info on file</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AddContactDialog
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: PRO_CONTACTS_QUERY_KEY });
        }}
      />
    </section>
  );
}

function AddContactDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [local, setLocal] = useState<FormState>(EMPTY_FORM);

  // Reset the form whenever the dialog re-opens.
  useEffect(() => {
    if (open) setLocal(EMPTY_FORM);
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      createProContact({
        name: local.name.trim(),
        role: local.role,
        email: local.email.trim() || null,
        phone_e164: local.phone_e164.trim() || null,
        notes: null,
      }),
    onSuccess: () => {
      notify.success("Contact added");
      onSaved();
      onClose();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!local.name.trim()) {
      notify.error("Name is required.");
      return;
    }
    if (!local.email.trim() && !local.phone_e164.trim()) {
      notify.error("Add an email or phone number.");
      return;
    }
    if (
      local.phone_e164.trim() &&
      !/^\+[1-9][0-9]{6,14}$/.test(local.phone_e164.trim())
    ) {
      notify.error("Phone must be E.164 format (e.g. +14155551234).");
      return;
    }
    save.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New professional contact</DialogTitle>
          <DialogDescription>
            Add a vet, farrier, trainer, or anyone else you work with at the
            barn.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="pc-add-name">Name</Label>
            <Input
              id="pc-add-name"
              value={local.name}
              onChange={(e) =>
                setLocal((p) => ({ ...p, name: e.target.value }))
              }
              required
              maxLength={200}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pc-add-role">Who they are</Label>
            <select
              id="pc-add-role"
              value={local.role}
              onChange={(e) =>
                setLocal((p) => ({
                  ...p,
                  role: e.target.value as ProContactRole,
                }))
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
            <Label htmlFor="pc-add-email">Email</Label>
            <Input
              id="pc-add-email"
              type="email"
              value={local.email}
              onChange={(e) =>
                setLocal((p) => ({ ...p, email: e.target.value }))
              }
              placeholder="name@example.com"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="pc-add-phone">Phone</Label>
            <Input
              id="pc-add-phone"
              value={local.phone_e164}
              onChange={(e) =>
                setLocal((p) => ({ ...p, phone_e164: e.target.value }))
              }
              placeholder="+14155551234"
            />
            <p className="text-xs text-muted-foreground">
              Use E.164 format — start with <code>+</code> and the country
              code.
            </p>
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
              Add contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
