import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target, Pencil } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/lib/authStore";
import { formatCentsUsd } from "@/lib/expenses";
import {
  GOALS_QUERY_KEY,
  fetchCurrentMonthGoalProgress,
  progressFraction,
  formatMonthLabel,
} from "@/lib/trainerGoals";
import { formatHours } from "@/lib/trainerBusiness";
import { GoalEditDialog } from "./GoalEditDialog";

// GoalProgressCard — /trainer/business "Monthly goal" card.
//
// Two SVG rings side-by-side: revenue (gross MTD vs target) + hours
// (logged MTD vs target). Either target can be unset; the
// corresponding ring shows a dashed placeholder in that case.
//
// Rings stay capped at 100% visually when the trainer blows past the
// target — the numeric label next to the ring tells the full story
// ("$9,200 of $8,000 · 115%"), so there's no visual ambiguity.

const RING_SIZE = 96;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

function Ring({
  fraction,
  color,
  label,
}: {
  fraction: number | null;
  color: string;
  label: string;
}) {
  const pct = fraction == null ? 0 : Math.round(fraction * 100);
  const dashoffset =
    fraction == null ? RING_CIRC : RING_CIRC * (1 - Math.min(1, fraction));

  return (
    <svg
      width={RING_SIZE}
      height={RING_SIZE}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={RING_STROKE}
        strokeDasharray={fraction == null ? "4 4" : undefined}
        opacity={fraction == null ? 0.6 : 1}
      />
      {fraction != null && (
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRC}
          strokeDashoffset={dashoffset}
          transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
        />
      )}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-foreground"
        style={{ fontSize: 18, fontWeight: 600 }}
      >
        {fraction == null ? "—" : `${pct}%`}
      </text>
    </svg>
  );
}

export function GoalProgressCard() {
  const trainerId = useAuthStore((s) => s.session?.user.id) ?? null;
  const [editOpen, setEditOpen] = useState(false);

  const q = useQuery({
    queryKey: GOALS_QUERY_KEY,
    queryFn: () => {
      if (!trainerId) throw new Error("Not signed in.");
      return fetchCurrentMonthGoalProgress(trainerId);
    },
    enabled: Boolean(trainerId),
    retry: false,
  });

  if (!trainerId || q.isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Monthly goal</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Loading…
        </CardContent>
      </Card>
    );
  }

  // Goals rely on migration 00018 (trainer_goals + trainer_month_start).
  // If the migration hasn't shipped yet the RPC 404s — degrade silently
  // so the rest of the dashboard keeps working.
  if (q.isError || !q.data) {
    return null;
  }

  const { goal, grossCentsMtd, hoursLoggedMtd, monthStart } = q.data;
  const hasAnyTarget =
    Boolean(goal?.revenue_target_cents) || Boolean(goal?.hours_target);

  const revFrac = progressFraction(grossCentsMtd, goal?.revenue_target_cents ?? null);
  const hrFrac  = progressFraction(hoursLoggedMtd, goal?.hours_target ?? null);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
        <div>
          <CardTitle className="text-base">Monthly goal</CardTitle>
          <p className="text-xs text-muted-foreground">
            {formatMonthLabel(monthStart)} · month-to-date
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setEditOpen(true)}
        >
          {hasAnyTarget ? (
            <>
              <Pencil className="mr-2 h-3.5 w-3.5" />
              Edit
            </>
          ) : (
            <>
              <Target className="mr-2 h-3.5 w-3.5" />
              Set goal
            </>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        {hasAnyTarget ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <GoalRow
              ring={
                <Ring
                  fraction={revFrac}
                  color="#0f766e"
                  label="Revenue progress"
                />
              }
              title="Revenue"
              actualLabel={formatCentsUsd(grossCentsMtd)}
              targetLabel={
                goal?.revenue_target_cents
                  ? `of ${formatCentsUsd(goal.revenue_target_cents)}`
                  : "No target set"
              }
              fraction={revFrac}
            />
            <GoalRow
              ring={
                <Ring
                  fraction={hrFrac}
                  color="#0369a1"
                  label="Hours progress"
                />
              }
              title="Hours"
              actualLabel={formatHours(hoursLoggedMtd)}
              targetLabel={
                goal?.hours_target
                  ? `of ${formatHours(Number(goal.hours_target))}`
                  : "No target set"
              }
              fraction={hrFrac}
            />
          </div>
        ) : (
          <div className="flex flex-col items-start gap-2 py-2">
            <p className="text-sm text-muted-foreground">
              Set a monthly revenue or hours goal to track progress
              against your book.
            </p>
          </div>
        )}
      </CardContent>

      <GoalEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        trainerId={trainerId}
        monthStart={monthStart}
        initialRevenueCents={goal?.revenue_target_cents ?? null}
        initialHours={goal?.hours_target == null ? null : Number(goal.hours_target)}
      />
    </Card>
  );
}

function GoalRow({
  ring,
  title,
  actualLabel,
  targetLabel,
  fraction,
}: {
  ring: React.ReactNode;
  title: string;
  actualLabel: string;
  targetLabel: string;
  fraction: number | null;
}) {
  const overagePct =
    fraction != null && fraction > 1
      ? Math.round(fraction * 100)
      : null;

  return (
    <div className="flex items-center gap-4">
      {ring}
      <div className="space-y-0.5 text-sm">
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-foreground">{actualLabel}</div>
        <div className="text-xs text-muted-foreground">
          {targetLabel}
          {overagePct != null && (
            <span className="ml-1 font-medium text-emerald-600">
              · {overagePct}%
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
