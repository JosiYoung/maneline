import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Card, CardContent } from "@/components/ui/card";
import { formatCentsUsd } from "@/lib/expenses";
import {
  BUSINESS_QUERY_KEY,
  fetchBusinessData,
  computeSummary,
  computeMonthly,
  computeByHorse,
  computeByBarn,
  computeByClient,
  formatHours,
  type BusinessPeriod,
} from "@/lib/trainerBusiness";

import { PeriodToggle } from "@/components/trainer/business/PeriodToggle";
import { KpiTile } from "@/components/trainer/business/KpiTile";
import { NetBreakdown } from "@/components/trainer/business/NetBreakdown";
import { GoalProgressCard } from "@/components/trainer/business/GoalProgressCard";
import {
  RevenueVsExpensesChart,
  ProfitByHorseChart,
  ProfitByBarnChart,
  ProfitByClientChart,
} from "@/components/trainer/business/BusinessCharts";

// BusinessDashboard — /trainer/business
//
// Phase 7 PR #2 (read-only). Pulls succeeded session_payments, archived-
// clean training_sessions, and trainer-recorded expenses. Aggregates
// client-side into KPI tiles and 4 Recharts visuals. No writes here.
//
// Goal ring, invoicing, branding, and per-client billing mode land in
// later PRs.

export default function BusinessDashboard() {
  const [period, setPeriod] = useState<BusinessPeriod>("last_30d");

  const q = useQuery({
    queryKey: [...BUSINESS_QUERY_KEY, period],
    queryFn: () => fetchBusinessData(period),
  });

  const summary = useMemo(
    () => (q.data ? computeSummary(q.data, period) : null),
    [q.data, period]
  );
  const monthly    = useMemo(() => (q.data ? computeMonthly(q.data) : []), [q.data]);
  const byHorse    = useMemo(() => (q.data ? computeByHorse(q.data) : []), [q.data]);
  const byBarn     = useMemo(() => (q.data ? computeByBarn(q.data) : []), [q.data]);
  const byClient   = useMemo(() => (q.data ? computeByClient(q.data) : []), [q.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl">Business</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Revenue, expenses, and profit across your roster. Net figures
            subtract the Mane Line platform fee and the estimated Stripe
            processing fee.
          </p>
        </div>
        <PeriodToggle value={period} onChange={setPeriod} />
      </div>

      {q.isLoading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Loading your business data…
          </CardContent>
        </Card>
      )}

      {q.isError && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-destructive">
            Couldn't load your business data. Try refreshing the page.
          </CardContent>
        </Card>
      )}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <KpiTile
              label="Gross"
              value={formatCentsUsd(summary.grossCents)}
              sublabel={`${summary.paymentsCount} payment${summary.paymentsCount === 1 ? "" : "s"}`}
            />
            <KpiTile
              label="Net to you"
              value={formatCentsUsd(summary.netCents)}
              tone="positive"
              tooltip={
                <NetBreakdown
                  grossCents={summary.grossCents}
                  platformFeeCents={summary.platformFeeCents}
                  stripeFeeCentsEst={summary.stripeFeeCentsEst}
                  netCents={summary.netCents}
                />
              }
            />
            <KpiTile
              label="Expenses"
              value={formatCentsUsd(summary.expensesCents)}
              tone="muted"
              sublabel="Trainer-recorded"
            />
            <KpiTile
              label="Profit"
              value={formatCentsUsd(summary.netOfExpensesCents)}
              tone={summary.netOfExpensesCents >= 0 ? "positive" : "negative"}
              sublabel="Net − expenses"
            />
            <KpiTile
              label="Margin"
              value={summary.marginPct === null ? "—" : `${summary.marginPct.toFixed(1)}%`}
              tone={
                summary.marginPct === null ? "muted"
                : summary.marginPct >= 0   ? "positive"
                : "negative"
              }
              sublabel="Profit ÷ gross"
            />
            <KpiTile
              label="Hours logged"
              value={formatHours(summary.hoursLogged)}
              sublabel={
                summary.effectiveHourlyRateCents === null
                  ? `${summary.sessionsCount} sessions`
                  : `${formatCentsUsd(summary.effectiveHourlyRateCents)}/hr net`
              }
            />
          </div>

          <GoalProgressCard />

          <div className="grid gap-4 lg:grid-cols-2">
            <RevenueVsExpensesChart data={monthly} />
            <ProfitByHorseChart data={byHorse} />
            <ProfitByBarnChart data={byBarn} />
            <ProfitByClientChart data={byClient} />
          </div>

          {summary.grossCents === 0 && summary.expensesCents === 0 && (
            <Card>
              <CardContent className="py-6 text-center text-xs text-muted-foreground">
                No revenue or expenses in this period yet. Log a session or
                record an expense to see it here.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
