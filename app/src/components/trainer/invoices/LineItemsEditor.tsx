import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Download } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
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
import { Badge } from "@/components/ui/badge";

import { formatCentsUsd } from "@/lib/expenses";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  BILLABLE_SOURCES_QUERY_KEY,
  INVOICE_DETAIL_QUERY_KEY,
  addLineItem,
  computeLineAmountCents,
  fetchBillableSources,
  recomputeDraftTotals,
  removeLineItem,
  type BillableExpense,
  type BillableSession,
  type Invoice,
  type InvoiceLineItem,
  type RecurringTemplate,
} from "@/lib/invoices";

// LineItemsEditor — the draft-editing surface inside InvoiceDetail.
//
// Three panels:
//   • Table of current lines (delete individually)
//   • Custom-line form (description + quantity + unit + tax)
//   • "Import from…" picker with three tabs sourcing sessions /
//     expenses / recurring-templates for the invoice's counterparty.
//
// Every mutation invalidates both INVOICE_DETAIL_QUERY_KEY and
// BILLABLE_SOURCES_QUERY_KEY so the already-billed filter in the
// picker stays accurate after an add.

interface Props {
  invoice: Invoice;
  lines: InvoiceLineItem[];
}

export function LineItemsEditor({ invoice, lines }: Props) {
  const queryClient = useQueryClient();
  const readonly = invoice.status !== "draft";

  const [importOpen, setImportOpen] = useState(false);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: INVOICE_DETAIL_QUERY_KEY(invoice.id) });
    queryClient.invalidateQueries({
      queryKey: BILLABLE_SOURCES_QUERY_KEY(
        invoice.owner_id ?? invoice.adhoc_email ?? "",
        invoice.period_start ?? "",
        invoice.period_end ?? ""
      ),
    });
  };

  const remove = useMutation({
    mutationFn: async (lineId: string) => {
      await removeLineItem(lineId);
      await recomputeDraftTotals(invoice.id);
    },
    onSuccess: () => invalidate(),
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Line items</CardTitle>
        {!readonly && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setImportOpen(true)}
          >
            <Download className="mr-2 h-4 w-4" />
            Import from…
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No line items yet.{" "}
            {!readonly && "Add a custom line below or import from your sessions, expenses, or recurring templates."}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit</TableHead>
                <TableHead className="text-right">Tax</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="capitalize">{line.kind}</Badge>
                      <span className="truncate">{line.description}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(line.quantity).toFixed(2)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCentsUsd(line.unit_amount_cents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {line.tax_rate_bps === 0
                      ? "—"
                      : `${(line.tax_rate_bps / 100).toFixed(2)}%`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCentsUsd(line.amount_cents)}
                  </TableCell>
                  <TableCell className="text-right">
                    {!readonly && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => remove.mutate(line.id)}
                        disabled={remove.isPending}
                        aria-label="Remove line"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {!readonly && (
          <CustomLineForm invoiceId={invoice.id} nextSortOrder={lines.length} onAdded={invalidate} />
        )}
      </CardContent>

      {!readonly && (
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          invoice={invoice}
          existingLines={lines}
          onAdded={invalidate}
        />
      )}
    </Card>
  );
}

function CustomLineForm({
  invoiceId,
  nextSortOrder,
  onAdded,
}: {
  invoiceId: string;
  nextSortOrder: number;
  onAdded: () => void;
}) {
  const [description, setDescription] = useState("");
  const [qty, setQty]           = useState("1");
  const [unitDollars, setUnit]  = useState("");
  const [taxPct, setTaxPct]     = useState("0");

  const add = useMutation({
    mutationFn: async () => {
      const desc = description.trim();
      if (!desc) throw new Error("Description is required.");

      const q = Number(qty);
      if (!Number.isFinite(q) || q <= 0) throw new Error("Quantity must be a positive number.");

      const unit = Number(unitDollars);
      if (!Number.isFinite(unit) || unit < 0) throw new Error("Unit amount must be zero or more.");
      const unitCents = Math.round(unit * 100);

      const tax = Number(taxPct);
      if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
        throw new Error("Tax rate must be between 0 and 100.");
      }
      const taxBps = Math.round(tax * 100);

      await addLineItem({
        invoiceId,
        kind: "custom",
        sourceId: null,
        description: desc,
        quantity: q,
        unitAmountCents: unitCents,
        taxRateBps: taxBps,
        sortOrder: nextSortOrder,
      });
      await recomputeDraftTotals(invoiceId);
    },
    onSuccess: () => {
      setDescription("");
      setQty("1");
      setUnit("");
      setTaxPct("0");
      onAdded();
      notify.success("Line added");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    add.mutate();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-md border border-dashed p-3 md:grid-cols-[1fr,90px,110px,90px,auto] md:items-end"
    >
      <div className="space-y-1">
        <Label htmlFor="cl-desc" className="text-xs">Custom line</Label>
        <Input
          id="cl-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Clinic entry fee"
          maxLength={300}
          disabled={add.isPending}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cl-qty" className="text-xs">Qty</Label>
        <Input
          id="cl-qty"
          type="number"
          min={0}
          step={0.25}
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          disabled={add.isPending}
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cl-unit" className="text-xs">Unit (USD)</Label>
        <Input
          id="cl-unit"
          type="number"
          min={0}
          step="0.01"
          value={unitDollars}
          onChange={(e) => setUnit(e.target.value)}
          disabled={add.isPending}
          placeholder="0.00"
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cl-tax" className="text-xs">Tax %</Label>
        <Input
          id="cl-tax"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={taxPct}
          onChange={(e) => setTaxPct(e.target.value)}
          disabled={add.isPending}
        />
      </div>
      <Button type="submit" disabled={add.isPending}>
        {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Plus className="mr-2 h-4 w-4" />Add</>}
      </Button>
    </form>
  );
}

// Import dialog — sessions / expenses / recurring templates.
function ImportDialog({
  open,
  onOpenChange,
  invoice,
  existingLines,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice;
  existingLines: InvoiceLineItem[];
  onAdded: () => void;
}) {
  const q = useQuery({
    queryKey: BILLABLE_SOURCES_QUERY_KEY(
      invoice.owner_id ?? invoice.adhoc_email ?? "",
      invoice.period_start ?? "",
      invoice.period_end ?? ""
    ),
    queryFn: () =>
      fetchBillableSources(
        invoice.trainer_id,
        invoice.owner_id,
        invoice.adhoc_email,
        invoice.period_start,
        invoice.period_end
      ),
    enabled: open,
  });

  // Hide rows already added in this edit pass (the server-side filter
  // checks persisted lines; in-memory lines from this dialog session
  // need their own check).
  const usedSourceIds = useMemo(
    () => new Set(existingLines.map((l) => l.source_id).filter(Boolean) as string[]),
    [existingLines]
  );

  const sessions  = (q.data?.sessions  ?? []).filter((s) => !usedSourceIds.has(s.id));
  const expenses  = (q.data?.expenses  ?? []).filter((e) => !usedSourceIds.has(e.id));
  const recurring = q.data?.recurring ?? [];

  const importOne = useMutation({
    mutationFn: async (args: {
      kind: "session" | "expense" | "recurring";
      sourceId: string | null;
      description: string;
      quantity: number;
      unitAmountCents: number;
      taxRateBps: number;
    }) => {
      await addLineItem({
        invoiceId: invoice.id,
        kind: args.kind,
        sourceId: args.sourceId,
        description: args.description,
        quantity: args.quantity,
        unitAmountCents: args.unitAmountCents,
        taxRateBps: args.taxRateBps,
        sortOrder: existingLines.length,
      });
      await recomputeDraftTotals(invoice.id);
    },
    onSuccess: () => {
      onAdded();
      notify.success("Line added");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function importSession(s: BillableSession) {
    const hours = (s.duration_minutes ?? 60) / 60;
    const unit = s.trainer_price_cents ?? 0;
    const desc = [
      s.animal_barn_name ?? "Session",
      s.title,
      new Date(s.started_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    ].filter(Boolean).join(" · ");
    importOne.mutate({
      kind: "session",
      sourceId: s.id,
      description: desc,
      quantity: 1, // one session = one line; per-session pricing stays as-is
      unitAmountCents: unit,
      taxRateBps: 0,
    });
    void hours;
  }

  function importExpense(e: BillableExpense) {
    // Apply markup (amount × (1 + markup_bps/10000)), keep tax separate.
    const base = e.amount_cents;
    const withMarkup = Math.round((base * (10000 + e.markup_bps)) / 10000);
    importOne.mutate({
      kind: "expense",
      sourceId: e.id,
      description: `Reimbursement: ${e.description}`,
      quantity: 1,
      unitAmountCents: withMarkup,
      taxRateBps: e.tax_rate_bps,
    });
  }

  function importRecurring(r: RecurringTemplate) {
    importOne.mutate({
      kind: "recurring",
      sourceId: r.id,
      description: r.description,
      quantity: 1,
      unitAmountCents: r.amount_cents,
      taxRateBps: 0,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import line items</DialogTitle>
        </DialogHeader>

        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {q.isError && (
          <p className="text-sm text-destructive">Couldn't load candidates. Try again.</p>
        )}

        {!q.isLoading && !q.isError && (
          <div className="space-y-6 max-h-[70vh] overflow-y-auto">
            <ImportSection
              title="Unbilled sessions"
              emptyMsg="No unbilled billable sessions in this period."
              count={sessions.length}
            >
              {sessions.map((s) => {
                const amt = s.trainer_price_cents ?? 0;
                return (
                  <ImportRow
                    key={s.id}
                    title={`${s.animal_barn_name ?? "Session"}${s.title ? " · " + s.title : ""}`}
                    subtitle={new Date(s.started_at).toLocaleDateString()}
                    amountLabel={formatCentsUsd(amt)}
                    onAdd={() => importSession(s)}
                    disabled={importOne.isPending}
                  />
                );
              })}
            </ImportSection>

            <ImportSection
              title="Billable expenses"
              emptyMsg="No unbilled expenses flagged as billable to this client."
              count={expenses.length}
            >
              {expenses.map((e) => {
                const withMarkup = Math.round((e.amount_cents * (10000 + e.markup_bps)) / 10000);
                const lineTotal = computeLineAmountCents(1, withMarkup, e.tax_rate_bps);
                return (
                  <ImportRow
                    key={e.id}
                    title={e.description}
                    subtitle={`${e.occurred_on}${e.markup_bps ? ` · ${(e.markup_bps/100).toFixed(1)}% markup` : ""}${e.tax_rate_bps ? ` · ${(e.tax_rate_bps/100).toFixed(2)}% tax` : ""}`}
                    amountLabel={formatCentsUsd(lineTotal)}
                    onAdd={() => importExpense(e)}
                    disabled={importOne.isPending}
                  />
                );
              })}
            </ImportSection>

            <ImportSection
              title="Recurring templates"
              emptyMsg="No active recurring items for this client."
              count={recurring.length}
            >
              {recurring.map((r) => (
                <ImportRow
                  key={r.id}
                  title={r.description}
                  subtitle="Recurring"
                  amountLabel={formatCentsUsd(r.amount_cents)}
                  onAdd={() => importRecurring(r)}
                  disabled={importOne.isPending}
                />
              ))}
            </ImportSection>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline">Done</Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportSection({
  title,
  count,
  emptyMsg,
  children,
}: {
  title: string;
  count: number;
  emptyMsg: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">
        {title} <span className="text-muted-foreground">({count})</span>
      </h3>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyMsg}</p>
      ) : (
        <div className="divide-y rounded-md border">{children}</div>
      )}
    </section>
  );
}

function ImportRow({
  title,
  subtitle,
  amountLabel,
  onAdd,
  disabled,
}: {
  title: string;
  subtitle: string;
  amountLabel: string;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="flex items-center gap-3">
        <span className="tabular-nums text-sm">{amountLabel}</span>
        <Button type="button" size="sm" variant="outline" onClick={onAdd} disabled={disabled}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
    </div>
  );
}
