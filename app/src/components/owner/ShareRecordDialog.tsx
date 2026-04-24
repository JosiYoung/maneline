import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Link2, Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  VET_SHARE_EXPIRY_CHOICES,
  VET_SHARE_TOKENS_QUERY_KEY,
  createVetShareToken,
  listVetShareTokens,
  revokeVetShareToken,
  type VetShareExpiryDays,
  type VetShareTokenCreated,
  type VetShareTokenRow,
} from "@/lib/vetShare";

// Map the revoke-specific Worker error codes to something the owner can
// act on. The `err.code` field is populated by vetShare.ts's parseError.
function mapRevokeError(err: unknown): string {
  const code = (err as Error & { code?: string })?.code;
  switch (code) {
    case "not_found":
      return "That link was already removed. Refresh to see the current list.";
    case "forbidden":
      return "You don't have permission to revoke that link.";
    case "revoke_failed":
      return "Couldn't revoke just now — please try again in a moment.";
    case "unauthorized":
      return "Your session expired. Please sign in again.";
    default:
      return mapSupabaseError(err as Error);
  }
}

// ShareRecordDialog — Phase 5.7
//
// Owner clicks "Share with vet" from AnimalDetail. The dialog opens in
// "create" mode. On submit we POST /api/vet-share-tokens and flip to
// "created" mode: URL + copy-to-clipboard + a Revoke button. The list of
// active tokens for this animal also shows so the owner can revoke any
// still-open share from one place.
export function ShareRecordDialog({ animalId }: { animalId: string }) {
  const [open, setOpen] = useState(false);
  const [expiry, setExpiry] = useState<VetShareExpiryDays>(14);
  const [includeMedia, setIncludeMedia] = useState(false);
  const [created, setCreated] = useState<VetShareTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: [...VET_SHARE_TOKENS_QUERY_KEY, animalId],
    queryFn: () => listVetShareTokens(animalId),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () =>
      createVetShareToken({
        animal_id: animalId,
        expires_in_days: expiry,
        scope: { records: true, media: includeMedia },
      }),
    onSuccess: (data) => {
      setCreated(data);
      queryClient.invalidateQueries({ queryKey: VET_SHARE_TOKENS_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => revokeVetShareToken(id),
    onSuccess: (data) => {
      if (data?.revoked_at || (data as { already_revoked?: boolean })?.already_revoked) {
        notify.success("Share revoked.");
      } else {
        notify.success("Share revoked.");
      }
      queryClient.invalidateQueries({ queryKey: VET_SHARE_TOKENS_QUERY_KEY });
    },
    onError: (err) => notify.error(mapRevokeError(err)),
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setCreated(null);
      setCopied(false);
      setExpiry(14);
      setIncludeMedia(false);
    }
  };

  const handleCopy = async () => {
    if (!created?.url) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      notify.success("Link copied.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error("Couldn't copy — select the link and copy manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Share2 size={14} />
          Share with vet
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Share link ready</DialogTitle>
              <DialogDescription>
                Anyone with this link can read this animal's records until it
                expires. Copy it into an email or text — we don't send it for
                you.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={created.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 font-mono text-xs"
                />
                <Button onClick={handleCopy} size="default" variant="outline">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Expires{" "}
                {new Date(created.expires_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                .
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => revoke.mutate(created.id)}
                disabled={revoke.isPending}
              >
                {revoke.isPending ? "Revoking…" : "Revoke now"}
              </Button>
              <Button onClick={() => handleOpenChange(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Share with vet</DialogTitle>
              <DialogDescription>
                Create a read-only link to this animal's 12-month record. You
                can revoke it anytime.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Expires in</Label>
                <div className="grid grid-cols-4 gap-2">
                  {VET_SHARE_EXPIRY_CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => setExpiry(c.value)}
                      className={
                        "rounded-md border px-3 py-2 text-sm transition-colors " +
                        (expiry === c.value
                          ? "border-primary bg-primary/10 font-medium text-foreground"
                          : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground")
                      }
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>What to include</Label>
                <div className="space-y-2">
                  <label className="flex items-start gap-2.5 rounded-md border border-border bg-muted/20 p-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <p className="font-medium text-foreground">
                        Vet records
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Coggins, vaccines, dental, farrier. Always included.
                      </p>
                    </div>
                  </label>
                  <label className="flex items-start gap-2.5 rounded-md border border-border p-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={includeMedia}
                      onChange={(e) => setIncludeMedia(e.target.checked)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <p className="font-medium text-foreground">
                        Photos & videos
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Include any photos and videos on file for this animal.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
              <Button onClick={() => create.mutate()} disabled={create.isPending}>
                {create.isPending ? "Creating…" : "Create share link"}
              </Button>
            </DialogFooter>

            <Separator />

            <ActiveSharesList
              query={listQuery}
              onRevoke={(id) => revoke.mutate(id)}
              revoking={revoke.isPending}
            />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ActiveSharesList({
  query,
  onRevoke,
  revoking,
}: {
  query: ReturnType<
    typeof useQuery<VetShareTokenRow[], Error, VetShareTokenRow[], readonly unknown[]>
  >;
  onRevoke: (id: string) => void;
  revoking: boolean;
}) {
  const all = query.data ?? [];
  const active = all.filter(
    (r) => r.revoked_at == null && Date.parse(r.expires_at) > Date.now(),
  );

  if (query.isLoading) {
    return <div className="h-8 animate-pulse rounded bg-muted/40" />;
  }
  if (active.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No active share links for this animal.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs">Active share links</Label>
      <ul className="space-y-1.5">
        {active.map((row) => (
          <li
            key={row.id}
            className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-xs"
          >
            <div className="flex min-w-0 items-center gap-2">
              <Link2 size={12} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate font-mono">{row.token_hint}</p>
                <p className="truncate text-muted-foreground">
                  Expires{" "}
                  {new Date(row.expires_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                  {row.view_count > 0
                    ? ` · ${row.view_count} view${row.view_count === 1 ? "" : "s"}`
                    : " · not opened yet"}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRevoke(row.id)}
              disabled={revoking}
            >
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
