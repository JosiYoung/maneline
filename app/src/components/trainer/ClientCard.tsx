import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { daysLeftInGrace, statusFor } from "@/lib/access";
import type { ClientGrant } from "@/lib/trainerAccess";

// ClientCard — compact roster tile used on the trainer dashboard.
// Shows owner + animal (or ranch, for scope=ranch/owner_all), grant
// scope label, and a status badge with grace countdown when applicable.
// Clicking the row opens the read-only animal view (Prompt 2.4).

function scopeLabel(grant: ClientGrant): string {
  switch (grant.scope) {
    case "animal":
      return grant.animal_barn_name ?? "Animal";
    case "ranch":
      return grant.ranch_name ? `Ranch · ${grant.ranch_name}` : "Ranch";
    case "owner_all":
      return "All animals";
    default:
      return grant.scope;
  }
}

export function ClientCard({ grant }: { grant: ClientGrant }) {
  const status = statusFor(grant);
  const grace = status === "grace" ? daysLeftInGrace(grant) : 0;

  const ownerLine =
    grant.owner_display_name ?? grant.owner_email ?? "Owner";

  // Animal-scope grants link to the read-only animal page; the broader
  // scopes don't have a single animal target, so the CTA is disabled
  // until Prompt 2.3 adds a dedicated roster drill-down.
  const animalHref = grant.animal_id ? `/trainer/animals/${grant.animal_id}` : null;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground">{ownerLine}</p>
            {status === "active" && <Badge>Active</Badge>}
            {status === "grace" && (
              <Badge variant="secondary">
                Grace · {grace} day{grace === 1 ? "" : "s"} left
              </Badge>
            )}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {scopeLabel(grant)}
          </p>
        </div>
        {animalHref ? (
          <Button asChild size="sm" variant="ghost">
            <Link to={animalHref} aria-label={`Open ${grant.animal_barn_name ?? "animal"}`}>
              Open <ArrowRight size={14} />
            </Link>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" disabled>
            Open
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
