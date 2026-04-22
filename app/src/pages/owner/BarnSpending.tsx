import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
  LineChart,
  Line,
} from "recharts";
import { Download, FileText, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  SPENDING_QUERY_KEY,
  formatUsdCents,
  getSpending,
  spendingCsvUrl,
  type SpendingGroupBy,
  type SpendingResponse,
} from "@/lib/barn";
import { mapSupabaseError } from "@/lib/errors";
import { BarnSubNav } from "@/components/owner/BarnSubNav";
import { OwnerExpenseDialog } from "@/components/owner/OwnerExpenseDialog";

// BarnSpending — /app/barn/spending.
//
// Year-scoped rollup of this owner's expenses. Top-line total, a
// grouping toggle (category / animal / ranch), three charts, and a
// drill-in table. CSV export is wired; PDF export is TECH_DEBT
// phase-8:04-01 pending Cloudflare Browser Rendering.

const CHART_COLORS = [
  "#ea580c", // orange-600
  "#0f766e", // teal-700
  "#7c3aed", // violet-600
  "#b45309", // amber-700
  "#16a34a", // green-600
  "#dc2626", // red-600
  "#0284c7", // sky-600
  "#c026d3", // fuchsia-600
  "#475569", // slate-600
];

function yearOptions(): number[] {
  const now = new Date().getUTCFullYear();
  return [now, now - 1, now - 2, now - 3, now - 4];
}

const monthTick = (ym: string) => {
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: "short" });
};
const dollarTick = (v: number) => `$${Math.round(v / 100).toLocaleString()}`;

export default function BarnSpending() {
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [groupBy, setGroupBy] = useState<SpendingGroupBy>("category");
  const [logOpen, setLogOpen] = useState(false);

  const spendingQ = useQuery({
    queryKey: SPENDING_QUERY_KEY(year, groupBy),
    queryFn: () => getSpending(year, groupBy),
  });

  const data: SpendingResponse | undefined = spendingQ.data;

  const pieData = useMemo(() => {
    if (!data) return [];
    return data.totals.map((t) => ({
      name: t.label,
      value: t.total_cents,
      key: t.key,
    }));
  }, [data]);

  const timelineData = useMemo(() => {
    if (!data) return [];
    return data.monthly_timeline.map((p) => ({
      month: p.month,
      total: p.total_cents,
    }));
  }, [data]);

  return (
    <div className="space-y-6">
      <BarnSubNav />
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-display text-2xl text-primary">Barn spending</h1>
          <p className="text-sm text-muted-foreground">
            Where the money is going, by category, horse, or ranch.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="year-select" className="text-sm">
            Year:
          </Label>
          <select
            id="year-select"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            {yearOptions().map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <Button size="sm" type="button" onClick={() => setLogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Log expense
          </Button>
          <a href={spendingCsvUrl(year)} download>
            <Button variant="outline" size="sm" type="button">
              <Download className="mr-1 h-4 w-4" />
              CSV
            </Button>
          </a>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="PDF export coming soon (phase-8:04-01)"
          >
            <FileText className="mr-1 h-4 w-4" />
            PDF
          </Button>
        </div>
      </header>

      {spendingQ.isLoading ? (
        <SpendingSkeleton />
      ) : spendingQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Could not load spending: {mapSupabaseError(spendingQ.error)}
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total spend in {data.year}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-display text-4xl text-primary">
                {formatUsdCents(data.grand_total_cents)}
              </p>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2">
            <Label className="text-sm">Group by:</Label>
            <div className="inline-flex overflow-hidden rounded-md border border-input">
              {(["category", "animal", "ranch"] as SpendingGroupBy[]).map(
                (g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGroupBy(g)}
                    className={
                      "px-3 py-1.5 text-sm capitalize " +
                      (groupBy === g
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted")
                    }
                  >
                    {g}
                  </button>
                )
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Share of total</CardTitle>
                <p className="text-xs text-muted-foreground">
                  Slice of each {groupBy} against the year total.
                </p>
              </CardHeader>
              <CardContent>
                {pieData.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No expenses recorded for {data.year}.
                  </p>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={90}
                          paddingAngle={2}
                        >
                          {pieData.map((_, i) => (
                            <Cell
                              key={i}
                              fill={CHART_COLORS[i % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(v) => formatUsdCents(Number(v))}
                          contentStyle={{ fontSize: 12, borderRadius: 6 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  By {groupBy} (top totals)
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Ranked from highest to lowest for {data.year}.
                </p>
              </CardHeader>
              <CardContent>
                {data.totals.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    No expenses recorded for {data.year}.
                  </p>
                ) : (
                  <div className="h-64 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={[...data.totals].slice(0, 10).reverse()}
                        layout="vertical"
                        margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          horizontal={false}
                          stroke="#e2e8f0"
                        />
                        <XAxis
                          type="number"
                          tickFormatter={dollarTick}
                          fontSize={11}
                          stroke="#94a3b8"
                        />
                        <YAxis
                          type="category"
                          dataKey="label"
                          fontSize={11}
                          stroke="#94a3b8"
                          width={110}
                        />
                        <Tooltip
                          formatter={(v) => formatUsdCents(Number(v))}
                          contentStyle={{ fontSize: 12, borderRadius: 6 }}
                        />
                        <Bar
                          dataKey="total_cents"
                          name="Total"
                          radius={[0, 4, 4, 0]}
                        >
                          {data.totals.slice(0, 10).map((_, i) => (
                            <Cell
                              key={i}
                              fill={CHART_COLORS[i % CHART_COLORS.length]}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Monthly trend</CardTitle>
              <p className="text-xs text-muted-foreground">
                Month-over-month spend across every {groupBy}.
              </p>
            </CardHeader>
            <CardContent>
              {timelineData.every((p) => p.total === 0) ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No monthly activity in {data.year}.
                </p>
              ) : (
                <div className="h-60 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={timelineData}
                      margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="#e2e8f0"
                      />
                      <XAxis
                        dataKey="month"
                        tickFormatter={monthTick}
                        fontSize={11}
                        stroke="#94a3b8"
                      />
                      <YAxis
                        tickFormatter={dollarTick}
                        fontSize={11}
                        stroke="#94a3b8"
                        width={60}
                      />
                      <Tooltip
                        formatter={(v) => formatUsdCents(Number(v))}
                        labelFormatter={(l) => monthTick(String(l))}
                        contentStyle={{ fontSize: 12, borderRadius: 6 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="#0f766e"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Detail</CardTitle>
              <p className="text-xs text-muted-foreground">
                {groupBy === "animal"
                  ? "Click a row to open the horse's cost-basis page."
                  : `Expenses grouped by ${groupBy}.`}
              </p>
            </CardHeader>
            <CardContent>
              {data.totals.length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No expenses to show.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="capitalize">{groupBy}</TableHead>
                      <TableHead className="text-right">Entries</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.totals.map((t) => (
                      <TableRow key={t.key}>
                        <TableCell className="font-medium">
                          {groupBy === "animal" && t.key !== "unknown" ? (
                            <Link
                              to={`/app/barn/spending/animals/${t.key}`}
                              className="text-primary underline-offset-2 hover:underline"
                            >
                              {t.label}
                            </Link>
                          ) : (
                            t.label
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {t.entry_count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatUsdCents(t.total_cents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      <OwnerExpenseDialog open={logOpen} onClose={() => setLogOpen(false)} />
    </div>
  );
}

function SpendingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
