import { useQuery } from "@tanstack/react-query";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ADMIN_KPIS_QUERY_KEY,
  formatCents,
  formatPercent,
  getAdminKpis,
} from "@/lib/admin";
import { mapSupabaseError } from "@/lib/errors";

// AdminDashboard — /admin
//
// Four KPI tiles fed by GET /api/admin/kpis. The Worker routes every
// call through service_role and writes an `admin.kpis.read` audit row.

export default function AdminDashboard() {
  const kpisQ = useQuery({
    queryKey: ADMIN_KPIS_QUERY_KEY,
    queryFn: getAdminKpis,
    // KPIs can be a few minutes stale — no need to refetch on focus.
    staleTime: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Overview</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Live activity + commerce for the last 7 and 30 days.
        </p>
      </div>

      {kpisQ.isLoading ? (
        <KpiSkeletonGrid />
      ) : kpisQ.isError ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Couldn't load KPIs. {mapSupabaseError(kpisQ.error as Error)}
          </CardContent>
        </Card>
      ) : kpisQ.data ? (
        <KpiGrid
          wau={kpisQ.data.wau}
          mau={kpisQ.data.mau}
          gmv={kpisQ.data.gmv_30d_cents}
          attach={kpisQ.data.attach_rate_30d}
          asOf={kpisQ.data.as_of}
        />
      ) : null}
    </div>
  );
}

function KpiGrid({
  wau,
  mau,
  gmv,
  attach,
  asOf,
}: {
  wau: number;
  mau: number;
  gmv: number;
  attach: number;
  asOf: string;
}) {
  const stamp = new Date(asOf).toLocaleString();
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Weekly active users"
          sub="Signed-in users in the last 7 days"
          value={wau.toLocaleString()}
        />
        <Tile
          label="Monthly active users"
          sub="Signed-in users in the last 30 days"
          value={mau.toLocaleString()}
        />
        <Tile
          label="Gross merchandise value"
          sub="Total paid order value, last 30 days"
          value={formatCents(gmv)}
        />
        <Tile
          label="Shop attach rate"
          sub="Share of active owners who placed a paid order in 30d"
          value={formatPercent(attach)}
        />
      </div>
      <p className="text-xs text-muted-foreground">As of {stamp}</p>
    </>
  );
}

function Tile({ label, sub, value }: { label: string; sub: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{sub}</div>
      </CardContent>
    </Card>
  );
}

function KpiSkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-28 animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </div>
  );
}
