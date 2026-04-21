import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ADMIN_INVOICES_QUERY_KEY,
  listAdminInvoices,
  type AdminInvoiceRow,
  type AdminInvoiceTab,
} from "@/lib/adminInvoices";
import type { InvoiceStatus } from "@/lib/database.types";
import { mapSupabaseError } from "@/lib/errors";

// /admin/invoices — Phase 7 PR #8.
//
// Read-only visibility into every trainer direct-charge invoice. No
// mutation verbs here: voids, sends, and finalizes go through the
// trainer's own portal so audit_log attributes them to the trainer,
// not the admin. Triage path: click through to the Stripe hosted
// page (system of record) for refunds / collections.

const TAB_ORDER: AdminInvoiceTab[] = ["open", "paid", "void", "draft", "all"];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatCents(cents: number | null | undefined, currency: string | null): string {
  if (cents == null) return "—";
  const ccy = (currency || "usd").toUpperCase();
  return `${(cents / 100).toFixed(2)} ${ccy}`;
}

function statusVariant(
  status: InvoiceStatus
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "paid") return "default";
  if (status === "open") return "secondary";
  if (status === "void" || status === "uncollectible") return "destructive";
  return "outline";
}

function payerCell(row: AdminInvoiceRow): { name: string; detail: string } {
  const name =
    row.owner_display_name ||
    row.adhoc_name ||
    row.owner_email ||
    row.adhoc_email ||
    "(unknown)";
  const detail = row.owner_email || row.adhoc_email || "";
  return { name, detail };
}

export default function InvoicesIndex() {
  const [tab, setTab] = useState<AdminInvoiceTab>("open");

  const q = useQuery({
    queryKey: [...ADMIN_INVOICES_QUERY_KEY, { tab }] as const,
    queryFn: () => listAdminInvoices(tab),
    refetchInterval: 60_000,
  });

  const rows = q.data ?? [];
  const errorMessage = useMemo(
    () => (q.isError ? mapSupabaseError(q.error as Error) : null),
    [q.isError, q.error]
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-foreground">Invoices</h1>
        <p className="text-sm text-muted-foreground">
          Trainer direct-charge invoices across all connected accounts.
          Read-only — use the Stripe link to refund or collect.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as AdminInvoiceTab)}>
        <TabsList>
          {TAB_ORDER.map((t) => (
            <TabsTrigger key={t} value={t}>
              {labelForTab(t)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trainer</TableHead>
                <TableHead>Payer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Stripe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    Loading invoices…
                  </TableCell>
                </TableRow>
              ) : errorMessage ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-destructive">
                    {errorMessage}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground">
                    No invoices in this view.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const payer = payerCell(row);
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground">
                            {row.trainer_display_name || row.trainer_email || "(trainer)"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {row.trainer_email || row.trainer_id.slice(0, 8)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="text-foreground">{payer.name}</span>
                          {payer.detail ? (
                            <span className="text-xs text-muted-foreground">
                              {payer.detail}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.status)}>
                          {row.status}
                        </Badge>
                        {row.invoice_number ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {row.invoice_number}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="text-foreground">
                          {formatCents(row.total_cents, row.currency)}
                        </span>
                        {row.platform_fee_cents > 0 ? (
                          <div className="text-xs text-muted-foreground">
                            fee {formatCents(row.platform_fee_cents, row.currency)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {row.amount_paid_cents > 0
                            ? formatCents(row.amount_paid_cents, row.currency)
                            : "—"}
                        </span>
                        {row.paid_at ? (
                          <div className="text-xs text-muted-foreground">
                            {formatDate(row.paid_at)}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(row.due_date)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.stripe_hosted_invoice_url ? (
                          <a
                            href={row.stripe_hosted_invoice_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            View
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function labelForTab(t: AdminInvoiceTab): string {
  switch (t) {
    case "open":           return "Open";
    case "paid":           return "Paid";
    case "void":           return "Void";
    case "draft":          return "Draft";
    case "uncollectible":  return "Uncollectible";
    case "all":            return "All";
    default:               return String(t);
  }
}
