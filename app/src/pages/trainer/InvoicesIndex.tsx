import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Plus, FileText, ExternalLink, Repeat } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
import {
  INVOICES_QUERY_KEY,
  listInvoices,
  formatInvoiceStatus,
  invoiceStatusTone,
  subjectLabel,
  type Invoice,
  type InvoiceListFilter,
} from "@/lib/invoices";
import { NewInvoiceDialog } from "@/components/trainer/invoices/NewInvoiceDialog";

// InvoicesIndex — /trainer/invoices
//
// Tabs = Stripe's own invoice statuses. "Draft" is the composing
// surface; "Open" covers sent-but-unpaid; "Paid" and "Void" are the
// terminal states. We don't surface 'uncollectible' as its own tab
// since it's a manual Stripe action and rare — those rows fall into
// Void visually until we learn otherwise.

const TABS: { value: InvoiceListFilter; label: string }[] = [
  { value: "all",   label: "All" },
  { value: "draft", label: "Draft" },
  { value: "open",  label: "Open" },
  { value: "paid",  label: "Paid" },
  { value: "void",  label: "Void" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function InvoicesIndex() {
  const trainerId = useAuthStore((s) => s.session?.user.id) ?? null;
  const [tab, setTab] = useState<InvoiceListFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const q = useQuery({
    queryKey: [...INVOICES_QUERY_KEY, tab] as const,
    queryFn: () => {
      if (!trainerId) throw new Error("Not signed in.");
      return listInvoices(trainerId, tab);
    },
    enabled: Boolean(trainerId),
  });

  const rows = q.data ?? [];

  const totals = useMemo(() => {
    const draftCents = rows
      .filter((r) => r.status === "draft")
      .reduce((a, r) => a + r.total_cents, 0);
    const openCents = rows
      .filter((r) => r.status === "open")
      .reduce((a, r) => a + r.total_cents, 0);
    const paidCents = rows
      .filter((r) => r.status === "paid")
      .reduce((a, r) => a + r.amount_paid_cents, 0);
    return { draftCents, openCents, paidCents };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl">Invoices</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Branded Stripe invoices paid directly to you. Drafts are editable;
            finalized invoices live on Stripe's hosted page.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link to="/trainer/invoices/recurring">
              <Repeat className="mr-2 h-4 w-4" />
              Recurring
            </Link>
          </Button>
          <Button type="button" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New invoice
          </Button>
        </div>
      </div>

      {tab === "all" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="Drafts total"  value={totals.draftCents} />
          <SummaryTile label="Open (unpaid)" value={totals.openCents}  tone="warning" />
          <SummaryTile label="Paid to date"  value={totals.paidCents}  tone="positive" />
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as InvoiceListFilter)}>
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.value} value={t.value} className="mt-4">
            {q.isLoading && <LoadingCard />}
            {q.isError && <ErrorCard />}
            {!q.isLoading && !q.isError && rows.length === 0 && (
              <EmptyCard onNew={() => setDialogOpen(true)} />
            )}
            {!q.isLoading && !q.isError && rows.length > 0 && (
              <InvoiceTable rows={rows} />
            )}
          </TabsContent>
        ))}
      </Tabs>

      <NewInvoiceDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "positive" | "warning";
}) {
  const toneCls =
    tone === "positive" ? "text-emerald-700"
    : tone === "warning" ? "text-amber-700"
    : "text-foreground";
  return (
    <Card>
      <CardContent className="py-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>
          {formatCentsUsd(value)}
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Loading invoices…
      </CardContent>
    </Card>
  );
}

function ErrorCard() {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-destructive">
        Couldn't load invoices. Try refreshing the page.
      </CardContent>
    </Card>
  );
}

function EmptyCard({ onNew }: { onNew: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <FileText className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="text-sm text-muted-foreground">
            No invoices here yet.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onNew}>
          <Plus className="mr-2 h-4 w-4" />
          Create your first invoice
        </Button>
      </CardContent>
    </Card>
  );
}

function InvoiceTable({ rows }: { rows: Invoice[] }) {
  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Client</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="text-right">Paid</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell className="font-medium">
                <Link
                  to={`/trainer/invoices/${inv.id}`}
                  className="hover:underline"
                >
                  {subjectLabel(inv)}
                </Link>
                {inv.invoice_number && (
                  <div className="text-xs text-muted-foreground">
                    #{inv.invoice_number}
                  </div>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={invoiceStatusTone(inv.status)}>
                  {formatInvoiceStatus(inv.status)}
                </Badge>
              </TableCell>
              <TableCell>{formatDate(inv.due_date)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCentsUsd(inv.total_cents)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {inv.status === "paid"
                  ? formatCentsUsd(inv.amount_paid_cents)
                  : "—"}
              </TableCell>
              <TableCell className="text-right">
                {inv.stripe_hosted_invoice_url && (
                  <a
                    href={inv.stripe_hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Open Stripe hosted invoice"
                  >
                    Stripe
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  </a>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
