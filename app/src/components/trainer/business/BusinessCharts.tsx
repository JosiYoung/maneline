import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCentsUsd } from "@/lib/expenses";
import type { EntityProfit, MonthlyPoint } from "@/lib/trainerBusiness";

// Chart colors sourced from Tailwind tokens. We stick to HEX here so
// Recharts' SVG output doesn't lean on CSS vars that could shift on
// dark-mode swap — brand_hex overrides ship in a later PR.
const COLOR_REVENUE = "#0f766e";   // teal-700 (positive)
const COLOR_EXPENSE = "#b45309";   // amber-700 (cost)
const COLOR_NET_POS = "#16a34a";   // green-600
const COLOR_NET_NEG = "#dc2626";   // red-600
const COLOR_MUTED   = "#94a3b8";   // slate-400

const dollarTick = (v: number) => `$${Math.round(v / 100).toLocaleString()}`;
const monthTick = (ym: string) => {
  // ym = "YYYY-MM"
  const [y, m] = ym.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString(undefined, { month: "short" });
};

function ChartFrame({ title, subtitle, children, empty }: {
  title: string; subtitle?: string; empty?: boolean; children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="pt-0">
        {empty ? (
          <p className="py-8 text-center text-xs text-muted-foreground">
            No data in this period yet.
          </p>
        ) : (
          <div className="h-60 w-full">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

export function RevenueVsExpensesChart({ data }: { data: MonthlyPoint[] }) {
  const empty = data.length === 0;
  return (
    <ChartFrame
      title="Revenue vs expenses"
      subtitle="Net revenue collected vs trainer-recorded expenses, by month."
      empty={empty}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis dataKey="month" tickFormatter={monthTick} fontSize={11} stroke={COLOR_MUTED} />
          <YAxis tickFormatter={dollarTick} fontSize={11} stroke={COLOR_MUTED} width={60} />
          <Tooltip
            formatter={(v) => formatCentsUsd(Number(v))}
            labelFormatter={(l) => monthTick(String(l))}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Bar dataKey="revenue" name="Net revenue" fill={COLOR_REVENUE} radius={[4, 4, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses"    fill={COLOR_EXPENSE} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

function HorizontalProfitChart({
  title, subtitle, data,
}: { title: string; subtitle?: string; data: EntityProfit[] }) {
  const empty = data.length === 0 || data.every((d) => d.net === 0);
  // Reverse so the biggest net lands at the top of the bar chart.
  const sorted = [...data].sort((a, b) => a.net - b.net);

  return (
    <ChartFrame title={title} subtitle={subtitle} empty={empty}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={sorted}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
          <XAxis type="number" tickFormatter={dollarTick} fontSize={11} stroke={COLOR_MUTED} />
          <YAxis
            type="category"
            dataKey="label"
            fontSize={11}
            stroke={COLOR_MUTED}
            width={110}
          />
          <Tooltip
            formatter={(v) => formatCentsUsd(Number(v))}
            contentStyle={{ fontSize: 12, borderRadius: 6 }}
          />
          <Bar dataKey="net" name="Net profit" radius={[0, 4, 4, 0]}>
            {sorted.map((d) => (
              <Cell key={d.key} fill={d.net >= 0 ? COLOR_NET_POS : COLOR_NET_NEG} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

export function ProfitByHorseChart({ data }: { data: EntityProfit[] }) {
  return (
    <HorizontalProfitChart
      title="Profit by horse"
      subtitle="Net revenue minus trainer-recorded expenses, per animal (top 10)."
      data={data}
    />
  );
}

export function ProfitByBarnChart({ data }: { data: EntityProfit[] }) {
  return (
    <HorizontalProfitChart
      title="Profit by barn"
      subtitle="Best-effort via ranch-scoped grants. Per-animal grants show as Unassigned."
      data={data}
    />
  );
}

export function ProfitByClientChart({ data }: { data: EntityProfit[] }) {
  return (
    <HorizontalProfitChart
      title="Profit by client"
      subtitle="Net revenue minus attributed expenses, per owner (top 10)."
      data={data}
    />
  );
}
