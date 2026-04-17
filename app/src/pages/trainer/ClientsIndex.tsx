import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
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

import { daysLeftInGrace, statusFor } from "@/lib/access";
import {
  activeOrGrace,
  listClientGrants,
  TRAINER_CLIENTS_QUERY_KEY,
  type ClientGrant,
} from "@/lib/trainerAccess";

// ClientsIndex — /trainer/clients.
//
// Full roster as a shadcn Table (FRONTEND-UI-GUIDE §3.4). RLS on
// animal_access_grants + user_profiles_select_granted_owner (migration
// 00007) already constrains results to the signed-in trainer's active
// or grace clients; we drop expired rows client-side so a future
// "Expired history" tab can reuse the same query.

function scopeLine(g: ClientGrant): string {
  if (g.scope === "animal") return g.animal_barn_name ?? "—";
  if (g.scope === "ranch") return g.ranch_name ?? "—";
  return "All animals";
}

function formatGranted(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export default function ClientsIndex() {
  const q = useQuery({
    queryKey: TRAINER_CLIENTS_QUERY_KEY,
    queryFn: listClientGrants,
  });

  const rows = activeOrGrace(q.data ?? []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl">Clients</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every owner who's granted you access to at least one animal.
        </p>
      </header>

      {q.isLoading && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading your roster…
          </CardContent>
        </Card>
      )}

      {q.isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Couldn't load your clients. Try refreshing the page.
          </CardContent>
        </Card>
      )}

      {!q.isLoading && !q.isError && rows.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No clients yet. Owners invite trainers from their Mane Line portal
            — once a grant is active, they'll appear here.
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Granted</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => {
                const status = statusFor(g);
                const grace = status === "grace" ? daysLeftInGrace(g) : 0;
                const animalHref = g.animal_id ? `/trainer/animals/${g.animal_id}` : null;
                return (
                  <TableRow key={g.id}>
                    <TableCell className="font-medium">
                      {g.owner_display_name ?? g.owner_email ?? "—"}
                      <div className="text-xs text-muted-foreground">
                        {g.owner_email ?? ""}
                      </div>
                    </TableCell>
                    <TableCell>{scopeLine(g)}</TableCell>
                    <TableCell>{formatGranted(g.granted_at)}</TableCell>
                    <TableCell>
                      {status === "active" && <Badge>Active</Badge>}
                      {status === "grace" && (
                        <Badge variant="secondary">
                          Grace · {grace}d
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {animalHref ? (
                        <Button asChild size="sm" variant="ghost">
                          <Link to={animalHref}>
                            Open animal <ArrowRight size={14} />
                          </Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled>
                          Open
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
