import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { ClientCard } from "@/components/trainer/ClientCard";
import {
  activeOrGrace,
  listClientGrants,
  TRAINER_CLIENTS_QUERY_KEY,
} from "@/lib/trainerAccess";

// TrainerDashboard — /trainer landing page.
//
// Surfaces the active-or-grace client roster using ClientCard. Full
// Clients view (sortable Table) lives at /trainer/clients. Grace
// countdowns come from lib/access.ts:daysLeftInGrace so trainers know
// when a client drops off.
const DASHBOARD_ROSTER_LIMIT = 6;

export default function TrainerDashboard() {
  const q = useQuery({
    queryKey: TRAINER_CLIENTS_QUERY_KEY,
    queryFn: listClientGrants,
  });

  const roster = activeOrGrace(q.data ?? []);
  const preview = roster.slice(0, DASHBOARD_ROSTER_LIMIT);
  const overflow = Math.max(0, roster.length - preview.length);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Dashboard</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your Mane Line trainer hub. Active clients below; session logging
          and payouts ship in the next drop.
        </p>
      </div>

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 className="font-display text-xl text-primary">Your clients</h2>
          {roster.length > 0 && (
            <Button asChild size="sm" variant="ghost">
              <Link to="/trainer/clients">
                View all <ArrowRight size={14} />
              </Link>
            </Button>
          )}
        </div>

        {q.isLoading && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Loading your roster…
            </CardContent>
          </Card>
        )}

        {q.isError && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-destructive">
              Couldn't load your clients. Try refreshing the page.
            </CardContent>
          </Card>
        )}

        {!q.isLoading && !q.isError && roster.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>No clients yet</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Owners grant you access to an animal, ranch, or their full
                roster from the Mane Line owner portal. Once a grant is
                active, the horse shows up here.
              </p>
              <p>
                Session logging, payout onboarding, and invoicing land in
                the next Phase 2 drops.
              </p>
            </CardContent>
          </Card>
        )}

        {preview.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2">
            {preview.map((g) => (
              <ClientCard key={g.id} grant={g} />
            ))}
          </div>
        )}

        {overflow > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            + {overflow} more · see{" "}
            <Link to="/trainer/clients" className="underline underline-offset-2">
              all clients
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}
