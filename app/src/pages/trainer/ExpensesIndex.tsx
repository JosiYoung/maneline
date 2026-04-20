import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExpensesList } from "@/components/expenses/ExpensesList";
import { EXPENSES_QUERY_KEY, listMyExpenses } from "@/lib/expenses";

// ExpensesIndex — /trainer/expenses.
//
// All expenses across every animal the trainer currently has access
// to. RLS (expenses_trainer_select, migration 00009:251) enforces
// the animal-grant check on every row; we don't re-filter here.
//
// No "Add expense" CTA at this surface — expenses are always created
// against a specific animal from /trainer/animals/:id. Keeps the
// per-animal context in front of the trainer at creation time.
export default function ExpensesIndex() {
  const query = useQuery({
    queryKey: [...EXPENSES_QUERY_KEY, "trainer", "all"],
    queryFn: () => listMyExpenses(),
  });

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl text-primary">Expenses</h1>
        <p className="text-sm text-muted-foreground">
          Every expense logged across animals you have access to. Create
          new expenses from an animal page.
        </p>
      </header>

      {query.isLoading ? (
        <div className="h-32 animate-pulse rounded-md border border-border bg-muted/40" />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load expenses</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Please refresh the page or try again in a moment.
          </CardContent>
        </Card>
      ) : (
        <ExpensesList
          expenses={query.data ?? []}
          showAnimal
          emptyText="No expenses logged on any of your animals yet."
          animalLinkHref={(id) => `/trainer/animals/${id}`}
        />
      )}
    </div>
  );
}
