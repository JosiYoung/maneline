import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  archiveAdminPromoCode,
  createAdminPromoCodes,
  listAdminPromoCodes,
  unarchiveAdminPromoCode,
  type AdminPromoCode,
} from "@/lib/barn";

// PromoCodesIndex — /admin/promo-codes
//
// Silver Lining admins curate comp campaigns here. Each bulk create
// mints 1–500 codes granting 1–36 months of Barn Mode comp. The list is
// filterable by campaign tag. Only silver_lining role reaches this
// route (gated at the Worker + App.tsx).

const PROMO_CODES_QUERY_KEY = ["admin", "promo_codes"] as const;

export default function PromoCodesIndex() {
  const [campaignFilter, setCampaignFilter] = useState<string>("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const q = useQuery({
    queryKey: [
      ...PROMO_CODES_QUERY_KEY,
      campaignFilter || null,
      includeArchived,
    ] as const,
    queryFn: () =>
      listAdminPromoCodes(campaignFilter.trim() || undefined, { includeArchived }),
  });

  const rows = q.data ?? [];

  const campaigns = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => set.add(r.campaign));
    return Array.from(set).sort();
  }, [rows]);

  return (
    <div className="space-y-6 pt-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-primary">Promo codes</h1>
          <p className="text-sm text-muted-foreground">
            Bulk-mint Barn Mode comp codes. Each code grants a fixed number
            of months; single-use by default.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New batch
        </Button>
      </header>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-muted-foreground">
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Label htmlFor="campaign-filter" className="text-sm">
            Campaign:
          </Label>
          <Input
            id="campaign-filter"
            className="max-w-xs"
            placeholder="All campaigns"
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            list="campaign-options"
          />
          <datalist id="campaign-options">
            {campaigns.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {campaignFilter && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCampaignFilter("")}
            >
              Clear
            </Button>
          )}
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Include archived
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          {q.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : q.isError ? (
            <p className="py-6 text-sm text-destructive">
              Could not load codes: {mapSupabaseError(q.error)}
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              No promo codes yet. Mint a batch above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Months</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <CodeRow key={row.id} row={row} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <CreateBatchDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
      />
    </div>
  );
}

function CodeRow({ row }: { row: AdminPromoCode }) {
  const qc = useQueryClient();
  const redeemed = row.redeemed_at != null;
  const archived = row.archived_at != null;
  const expired =
    !redeemed &&
    !archived &&
    row.expires_at != null &&
    new Date(row.expires_at).getTime() < Date.now();

  const status: { label: string; tone: "secondary" | "default" | "outline" } =
    archived
      ? { label: "Archived", tone: "outline" }
      : redeemed
        ? { label: "Redeemed", tone: "secondary" }
        : expired
          ? { label: "Expired", tone: "outline" }
          : { label: "Available", tone: "default" };

  async function copy() {
    try {
      await navigator.clipboard.writeText(row.code);
      notify.success("Code copied.");
    } catch {
      notify.error("Copy failed.");
    }
  }

  const toggle = useMutation({
    mutationFn: () =>
      archived ? unarchiveAdminPromoCode(row.id) : archiveAdminPromoCode(row.id),
    onSuccess: () => {
      notify.success(archived ? "Code restored." : "Code archived.");
      qc.invalidateQueries({ queryKey: PROMO_CODES_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  // Redeemed rows are immutable — the grant already flowed through.
  const canToggle = !redeemed;

  return (
    <TableRow className={archived ? "opacity-60" : undefined}>
      <TableCell>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 font-mono text-sm hover:text-primary"
          title="Copy to clipboard"
        >
          {row.code}
          <Copy className="h-3 w-3" aria-hidden="true" />
        </button>
      </TableCell>
      <TableCell className="text-sm">{row.campaign}</TableCell>
      <TableCell className="text-right tabular-nums">
        {row.grants_barn_mode_months}
      </TableCell>
      <TableCell>
        <Badge variant={status.tone}>{status.label}</Badge>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {row.expires_at ? formatDate(row.expires_at) : "—"}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDate(row.created_at)}
      </TableCell>
      <TableCell className="text-right">
        {canToggle ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggle.mutate()}
            disabled={toggle.isPending}
            title={archived ? "Restore code" : "Archive code"}
          >
            {archived ? (
              <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Archive className="h-4 w-4" aria-hidden="true" />
            )}
            <span className="sr-only">
              {archived ? "Restore code" : "Archive code"}
            </span>
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function CreateBatchDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [campaign, setCampaign] = useState("");
  const [months, setMonths] = useState(12);
  const [count, setCount] = useState(10);
  const [singleUse, setSingleUse] = useState(true);
  const [notes, setNotes] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [minted, setMinted] = useState<AdminPromoCode[] | null>(null);

  function reset() {
    setCampaign("");
    setMonths(12);
    setCount(10);
    setSingleUse(true);
    setNotes("");
    setExpiresAt("");
    setMinted(null);
  }

  const create = useMutation({
    mutationFn: () =>
      createAdminPromoCodes({
        campaign: campaign.trim(),
        grants_barn_mode_months: months,
        count,
        single_use: singleUse,
        notes: notes.trim() || null,
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    onSuccess: (codes) => {
      notify.success(`Minted ${codes.length} code${codes.length === 1 ? "" : "s"}.`);
      setMinted(codes);
      qc.invalidateQueries({ queryKey: PROMO_CODES_QUERY_KEY });
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const disabled = create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mint promo codes</DialogTitle>
          <DialogDescription>
            Each code grants Barn Mode comp when redeemed by an owner at{" "}
            <span className="font-mono">/app/settings/subscription</span>.
          </DialogDescription>
        </DialogHeader>

        {minted ? (
          <MintedCodesList codes={minted} />
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="promo-campaign">Campaign</Label>
              <Input
                id="promo-campaign"
                value={campaign}
                onChange={(e) => setCampaign(e.target.value)}
                placeholder="e.g. SLH-Q2-2026"
                maxLength={64}
                required
                disabled={disabled}
              />
              <p className="text-xs text-muted-foreground">
                Short tag that groups this batch. Shows on the owner
                subscription card when redeemed.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="promo-months">Months granted</Label>
                <Input
                  id="promo-months"
                  type="number"
                  min={1}
                  max={36}
                  value={months}
                  onChange={(e) =>
                    setMonths(Math.max(1, Math.min(36, Number(e.target.value))))
                  }
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-count">Count</Label>
                <Input
                  id="promo-count"
                  type="number"
                  min={1}
                  max={500}
                  value={count}
                  onChange={(e) =>
                    setCount(Math.max(1, Math.min(500, Number(e.target.value))))
                  }
                  disabled={disabled}
                />
                <p className="text-xs text-muted-foreground">1–500.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="promo-expires">Expires (optional)</Label>
              <Input
                id="promo-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                disabled={disabled}
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={singleUse}
                onChange={(e) => setSingleUse(e.target.checked)}
                disabled={disabled}
              />
              Single-use (un-tick for a shared team code)
            </label>

            <div className="space-y-1.5">
              <Label htmlFor="promo-notes">Notes (optional)</Label>
              <Textarea
                id="promo-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                placeholder="Context for the ledger."
                disabled={disabled}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          {minted ? (
            <Button
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  onClose();
                }}
                disabled={disabled}
              >
                Cancel
              </Button>
              <Button
                onClick={() => create.mutate()}
                disabled={disabled || !campaign.trim()}
              >
                {disabled ? "Minting…" : `Mint ${count} code${count === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MintedCodesList({ codes }: { codes: AdminPromoCode[] }) {
  const text = useMemo(() => codes.map((c) => c.code).join("\n"), [codes]);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(text);
      notify.success(`Copied ${codes.length} codes.`);
    } catch {
      notify.error("Copy failed.");
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Minted {codes.length} code{codes.length === 1 ? "" : "s"} — copy
        the list and hand them off.
      </p>
      <Textarea
        readOnly
        rows={Math.min(10, codes.length)}
        value={text}
        className="font-mono text-xs"
      />
      <Button variant="outline" size="sm" onClick={copyAll}>
        <Copy className="mr-1 h-3 w-3" /> Copy all
      </Button>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
