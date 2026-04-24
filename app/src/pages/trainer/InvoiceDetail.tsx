import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink, Loader2, Send, Ban, CheckCircle2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";

import { formatCentsUsd } from "@/lib/expenses";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  INVOICE_DETAIL_QUERY_KEY,
  INVOICES_QUERY_KEY,
  fetchInvoice,
  finalizeInvoice,
  formatInvoiceStatus,
  invoiceStatusTone,
  sendInvoice,
  subjectLabel,
  updateDraftInvoice,
  voidInvoice,
} from "@/lib/invoices";
import { LineItemsEditor } from "@/components/trainer/invoices/LineItemsEditor";

// InvoiceDetail — /trainer/invoices/:id
//
// Draft: editable header (due date, period, notes), inline line items,
// Finalize + Void actions. No Stripe round-trip until Finalize.
//
// Post-finalize (open/paid/void): read-only summary, Send (if open +
// unsent), Void (if not paid), and a link to the Stripe hosted
// invoice page for the definitive status/receipt.

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: INVOICE_DETAIL_QUERY_KEY(id!),
    queryFn: () => fetchInvoice(id!),
    enabled: Boolean(id),
  });

  const [confirmOpen, setConfirmOpen] = useState<null | "finalize" | "send" | "void">(null);

  const finalizeM = useMutation({
    mutationFn: () => finalizeInvoice(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVOICE_DETAIL_QUERY_KEY(id!) });
      queryClient.invalidateQueries({ queryKey: INVOICES_QUERY_KEY });
      notify.success("Invoice finalized");
      setConfirmOpen(null);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const sendM = useMutation({
    mutationFn: () => sendInvoice(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVOICE_DETAIL_QUERY_KEY(id!) });
      queryClient.invalidateQueries({ queryKey: INVOICES_QUERY_KEY });
      notify.success("Invoice sent");
      setConfirmOpen(null);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const voidM = useMutation({
    mutationFn: () => voidInvoice(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVOICE_DETAIL_QUERY_KEY(id!) });
      queryClient.invalidateQueries({ queryKey: INVOICES_QUERY_KEY });
      notify.success("Invoice voided");
      setConfirmOpen(null);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-6">
        <Link
          to="/trainer/invoices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading invoice…
          </CardContent>
        </Card>
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="space-y-6">
        <Link
          to="/trainer/invoices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Couldn't load this invoice.{" "}
            <button
              type="button"
              onClick={() => navigate("/trainer/invoices")}
              className="underline hover:text-foreground"
            >
              Back to invoices
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { invoice, lines } = q.data;
  const isDraft = invoice.status === "draft";
  const isOpen  = invoice.status === "open";
  const isSent  = Boolean(invoice.sent_at);
  const canVoid = invoice.status !== "paid" && invoice.status !== "void";
  const canFinalize = isDraft && lines.length > 0 && invoice.total_cents > 0;
  const canSend = isOpen && !isSent && Boolean(invoice.stripe_invoice_id);

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/trainer/invoices"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Invoices
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl">{subjectLabel(invoice)}</h1>
              <Badge variant={invoiceStatusTone(invoice.status)}>
                {formatInvoiceStatus(invoice.status)}
              </Badge>
            </div>
            {invoice.invoice_number && (
              <p className="mt-1 text-sm text-muted-foreground">#{invoice.invoice_number}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canFinalize && (
              <Button type="button" onClick={() => setConfirmOpen("finalize")}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Finalize
              </Button>
            )}
            {canSend && (
              <Button type="button" variant="outline" onClick={() => setConfirmOpen("send")}>
                <Send className="mr-2 h-4 w-4" />
                Send
              </Button>
            )}
            {canVoid && (
              <Button type="button" variant="ghost" onClick={() => setConfirmOpen("void")}>
                <Ban className="mr-2 h-4 w-4" />
                Void
              </Button>
            )}
            {invoice.stripe_hosted_invoice_url && (
              <Button asChild type="button" variant="outline">
                <a
                  href={invoice.stripe_hosted_invoice_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Stripe page
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {isDraft ? (
        <DraftHeaderForm invoice={invoice} />
      ) : (
        <ReadOnlyHeader invoice={invoice} />
      )}

      <LineItemsEditor invoice={invoice} lines={lines} />

      <TotalsCard invoice={invoice} />

      <ConfirmDialog
        open={confirmOpen === "finalize"}
        onOpenChange={(v) => !v && setConfirmOpen(null)}
        title="Finalize invoice?"
        description="This locks the invoice shape, creates it on Stripe, and transitions it from draft to open. You'll still need to click Send to email the client."
        confirmLabel="Finalize"
        pending={finalizeM.isPending}
        onConfirm={() => finalizeM.mutate()}
      />
      <ConfirmDialog
        open={confirmOpen === "send"}
        onOpenChange={(v) => !v && setConfirmOpen(null)}
        title="Send invoice to client?"
        description={`Stripe will email the invoice to ${invoice.adhoc_email ?? "the client"} with a link to pay.`}
        confirmLabel="Send"
        pending={sendM.isPending}
        onConfirm={() => sendM.mutate()}
      />
      <ConfirmDialog
        open={confirmOpen === "void"}
        onOpenChange={(v) => !v && setConfirmOpen(null)}
        title="Void this invoice?"
        description="Voiding is permanent. A voided invoice can't be reopened — you'd need to create a new one."
        confirmLabel="Void"
        destructive
        pending={voidM.isPending}
        onConfirm={() => voidM.mutate()}
      />
    </div>
  );
}

function DraftHeaderForm({ invoice }: { invoice: import("@/lib/invoices").Invoice }) {
  const queryClient = useQueryClient();

  const [dueDate, setDueDate]         = useState(invoice.due_date);
  const [periodStart, setPeriodStart] = useState(invoice.period_start ?? "");
  const [periodEnd, setPeriodEnd]     = useState(invoice.period_end ?? "");
  const [notes, setNotes]             = useState(invoice.notes ?? "");

  const save = useMutation({
    mutationFn: () =>
      updateDraftInvoice(invoice.id, {
        due_date: dueDate,
        period_start: periodStart || null,
        period_end:   periodEnd   || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: INVOICE_DETAIL_QUERY_KEY(invoice.id) });
      notify.success("Saved");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Invoice details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="due">Due date</Label>
              <Input id="due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={save.isPending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ps">Period start</Label>
              <Input id="ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={save.isPending} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pe">Period end</Label>
              <Input id="pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={save.isPending} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={save.isPending}
              maxLength={2000}
              placeholder="Shown on the invoice PDF and Stripe hosted page."
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save details
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ReadOnlyHeader({ invoice }: { invoice: import("@/lib/invoices").Invoice }) {
  return (
    <Card>
      <CardContent className="grid gap-4 py-4 sm:grid-cols-4">
        <Field label="Due" value={invoice.due_date} />
        <Field label="Period" value={invoice.period_start && invoice.period_end ? `${invoice.period_start} → ${invoice.period_end}` : "—"} />
        <Field label="Sent" value={invoice.sent_at ? new Date(invoice.sent_at).toLocaleString() : "—"} />
        <Field label="Paid" value={invoice.paid_at ? new Date(invoice.paid_at).toLocaleString() : "—"} />
        {invoice.notes && (
          <div className="sm:col-span-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Notes</div>
            <p className="mt-1 whitespace-pre-wrap text-sm">{invoice.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
    </div>
  );
}

function TotalsCard({ invoice }: { invoice: import("@/lib/invoices").Invoice }) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="ml-auto max-w-xs space-y-1 text-sm">
          <Row label="Subtotal" value={formatCentsUsd(invoice.subtotal_cents)} />
          {invoice.tax_cents > 0 && (
            <Row label="Tax" value={formatCentsUsd(invoice.tax_cents)} />
          )}
          <Separator className="my-2" />
          <Row label="Total" value={formatCentsUsd(invoice.total_cents)} bold />
          {invoice.status === "paid" && (
            <Row
              label="Paid"
              value={formatCentsUsd(invoice.amount_paid_cents)}
              tone="positive"
            />
          )}
          {invoice.platform_fee_cents > 0 && (
            <p className="pt-2 text-xs text-muted-foreground">
              Includes a {formatCentsUsd(invoice.platform_fee_cents)} Mane Line platform fee deducted at payout.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "positive";
}) {
  const valueCls = [
    "tabular-nums",
    bold ? "font-semibold" : "",
    tone === "positive" ? "text-emerald-700" : "",
  ].filter(Boolean).join(" ");
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueCls}>{value}</span>
    </div>
  );
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  onConfirm,
  destructive,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="flex justify-end gap-2 pt-2">
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pending}>Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={pending}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
