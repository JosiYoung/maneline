import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { ArchiveExpenseDialog } from "./ArchiveExpenseDialog";
import {
  EXPENSE_CATEGORIES,
  expenseCategoryLabel,
  formatCentsUsd,
  type ExpenseCategory,
  type ExpenseWithContext,
} from "@/lib/expenses";

// ExpensesList — reusable table. Used by:
//   - AnimalDetail owner tab (scoped to one animal; showAnimal=false)
//   - AnimalReadOnly trainer tab (scoped to one animal; showAnimal=false)
//   - /trainer/expenses (all animals, showAnimal=true)
//
// Filtering is client-side over the already-RLS-scoped list. Tabs
// reflect the *visible* categories (i.e. only categories with ≥1 row
// in the current archived/active view) — avoids a sea of empty pills.

type CategoryTab = "all" | ExpenseCategory;

export function ExpensesList({
  expenses,
  emptyText = "No expenses logged yet.",
  showAnimal,
  showArchivedToggle = true,
  animalLinkHref,
}: {
  expenses: ExpenseWithContext[];
  emptyText?: string;
  showAnimal: boolean;
  showArchivedToggle?: boolean;
  /** Given an animal id, produce the URL to link its name to. Trainer vs. owner path. */
  animalLinkHref?: (animalId: string) => string;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [tab, setTab] = useState<CategoryTab>("all");

  const visibleRows = useMemo(() => {
    const base = showArchived
      ? expenses
      : expenses.filter((e) => e.archived_at == null);
    if (tab === "all") return base;
    return base.filter((e) => e.category === tab);
  }, [expenses, showArchived, tab]);

  const categoriesInView = useMemo(() => {
    const base = showArchived
      ? expenses
      : expenses.filter((e) => e.archived_at == null);
    const set = new Set<ExpenseCategory>();
    for (const e of base) set.add(e.category);
    return EXPENSE_CATEGORIES.filter((c) => set.has(c));
  }, [expenses, showArchived]);

  const total = useMemo(() => {
    return visibleRows
      .filter((e) => e.archived_at == null) // don't roll archived into totals
      .reduce((sum, e) => sum + e.amount_cents, 0);
  }, [visibleRows]);

  const hasRows = expenses.length > 0;
  const hasVisibleRows = visibleRows.length > 0;

  return (
    <div className="space-y-4">
      {hasRows && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs value={tab} onValueChange={(v) => setTab(v as CategoryTab)}>
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              {categoriesInView.map((c) => (
                <TabsTrigger key={c} value={c}>
                  {expenseCategoryLabel(c)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {showArchivedToggle && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Show archived
            </label>
          )}
        </div>
      )}

      {!hasRows ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : !hasVisibleRows ? (
        <p className="text-sm text-muted-foreground">
          No expenses in this view.
        </p>
      ) : (
        <div className="rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Date</TableHead>
                <TableHead>Category</TableHead>
                {showAnimal && <TableHead>Animal</TableHead>}
                <TableHead>Vendor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Recorded by</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((e) => (
                <ExpenseRowView
                  key={e.id}
                  expense={e}
                  showAnimal={showAnimal}
                  animalLinkHref={animalLinkHref}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {hasVisibleRows && (
        <div className="flex items-center justify-end gap-2 pr-1 text-sm">
          <span className="text-muted-foreground">Total in view</span>
          <span className="font-display text-base tabular-nums text-foreground">
            {formatCentsUsd(total)}
          </span>
        </div>
      )}
    </div>
  );
}

function ExpenseRowView({
  expense,
  showAnimal,
  animalLinkHref,
}: {
  expense: ExpenseWithContext;
  showAnimal: boolean;
  animalLinkHref?: (animalId: string) => string;
}) {
  const archived = expense.archived_at != null;
  return (
    <TableRow className={archived ? "opacity-60" : undefined}>
      <TableCell className="whitespace-nowrap text-sm">
        {formatDate(expense.occurred_on)}
      </TableCell>
      <TableCell>
        <CategoryChip category={expense.category} />
      </TableCell>
      {showAnimal && (
        <TableCell className="text-sm">
          {animalLinkHref ? (
            <Link
              to={animalLinkHref(expense.animal_id)}
              className="text-primary hover:underline"
            >
              {expense.animal_barn_name ?? "—"}
            </Link>
          ) : (
            expense.animal_barn_name ?? "—"
          )}
        </TableCell>
      )}
      <TableCell className="text-sm text-muted-foreground">
        {expense.vendor || "—"}
      </TableCell>
      <TableCell className="text-right font-display text-sm tabular-nums">
        {formatCentsUsd(expense.amount_cents)}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {expense.recorder_display_name ?? "—"}
        <span className="ml-1 text-xs uppercase tracking-wide">
          ({expense.recorder_role})
        </span>
      </TableCell>
      <TableCell className="text-right">
        {archived ? (
          <Badge variant="outline">Archived</Badge>
        ) : (
          <ArchiveExpenseDialog
            expenseId={expense.id}
            summary={`${expenseCategoryLabel(expense.category)} · ${formatCentsUsd(
              expense.amount_cents,
            )}`}
          />
        )}
      </TableCell>
    </TableRow>
  );
}

function CategoryChip({ category }: { category: ExpenseCategory }) {
  const label = expenseCategoryLabel(category);
  switch (category) {
    case "feed":
    case "tack":
      return <Badge variant="secondary">{label}</Badge>;
    case "vet":
      return (
        <Badge className="border-transparent bg-destructive/15 text-destructive hover:bg-destructive/15">
          {label}
        </Badge>
      );
    case "supplement":
      return (
        <Badge className="bg-accent text-accent-foreground hover:bg-accent">
          {label}
        </Badge>
      );
    default:
      return <Badge variant="outline">{label}</Badge>;
  }
}

function formatDate(iso: string): string {
  // Parse as a local date, not UTC, so "2026-04-17" doesn't drift by a
  // timezone offset into the previous day when rendered.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
