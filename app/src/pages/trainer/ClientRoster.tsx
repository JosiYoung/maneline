import { useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import { supabase } from "@/lib/supabase";
import {
  TRAINER_CLIENTS_QUERY_KEY,
  activeOrGrace,
  listClientGrants,
} from "@/lib/trainerAccess";

// ClientRoster — /trainer/clients/:ownerId
//
// The Open button on the trainer Dashboard / Clients tab brings owner-
// or ranch-scoped grants here, since those scopes don't have a single
// animal target. We list every animal RLS lets us see for that owner —
// `do_i_have_access_to_animal` filters by the trainer's active-or-grace
// grants, so a trainer can never enumerate animals they're not actually
// granted on. Optional `?ranch=:ranchId` narrows the list to one ranch
// (used when the originating grant was scope='ranch').

type RosterAnimal = {
  id: string;
  barn_name: string;
  species: string;
  breed: string | null;
  sex: string | null;
  year_born: number | null;
  discipline: string | null;
  archived_at: string | null;
};

const TRAINER_CLIENT_ROSTER_QUERY_KEY = ["trainer_client_roster"] as const;

async function listAnimalsForOwner(
  ownerId: string,
  ranchId: string | null,
): Promise<RosterAnimal[]> {
  // Animals don't have a direct ranch_id; ranch placement lives on
  // stall_assignments → stalls. When the originating grant was scope=
  // 'ranch' we narrow by current stall assignments on that ranch.
  let allowedIds: string[] | null = null;
  if (ranchId) {
    const { data: stallRows, error: stallErr } = await supabase
      .from("stall_assignments")
      .select("animal_id, stalls!inner(ranch_id)")
      .is("unassigned_at", null)
      .eq("stalls.ranch_id", ranchId);
    if (stallErr) throw stallErr;
    allowedIds = Array.from(
      new Set(((stallRows ?? []) as Array<{ animal_id: string }>).map((r) => r.animal_id)),
    );
    if (allowedIds.length === 0) return [];
  }

  let q = supabase
    .from("animals")
    .select("id,barn_name,species,breed,sex,year_born,discipline,archived_at")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("barn_name", { ascending: true });

  if (allowedIds) q = q.in("id", allowedIds);

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as RosterAnimal[];
}

export default function ClientRoster() {
  const { ownerId = "" } = useParams();
  const [search] = useSearchParams();
  const ranchId = search.get("ranch");

  // Pull the same client-grant list the Dashboard uses so we can show
  // the owner name + scope context at the top of the roster without a
  // second round-trip just for that.
  const grantsQ = useQuery({
    queryKey: TRAINER_CLIENTS_QUERY_KEY,
    queryFn: listClientGrants,
  });

  const ownerContext = useMemo(() => {
    const rows = activeOrGrace(grantsQ.data ?? []);
    const byOwner = rows.filter((g) => g.owner_id === ownerId);
    if (byOwner.length === 0) return null;
    const first = byOwner[0];
    const ranchName = ranchId
      ? byOwner.find((g) => g.ranch_id === ranchId)?.ranch_name ?? null
      : null;
    return {
      name: first.owner_display_name ?? first.owner_email ?? "Owner",
      email: first.owner_email,
      ranchName,
      hasOwnerAll: byOwner.some((g) => g.scope === "owner_all"),
    };
  }, [grantsQ.data, ownerId, ranchId]);

  const animalsQ = useQuery({
    queryKey: [...TRAINER_CLIENT_ROSTER_QUERY_KEY, ownerId, ranchId ?? ""],
    queryFn: () => listAnimalsForOwner(ownerId, ranchId),
    enabled: Boolean(ownerId),
  });

  const animals = animalsQ.data ?? [];

  return (
    <div className="space-y-6">
      <Link
        to="/trainer/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Clients
      </Link>

      <header className="space-y-1">
        <h1 className="text-3xl">{ownerContext?.name ?? "Client roster"}</h1>
        <p className="text-sm text-muted-foreground">
          {ownerContext?.ranchName
            ? `Animals on ${ownerContext.ranchName}.`
            : ownerContext?.hasOwnerAll
              ? "All animals you have access to for this client."
              : "Animals you have access to for this client."}
          {ownerContext?.email ? ` · ${ownerContext.email}` : ""}
        </p>
      </header>

      {animalsQ.isLoading && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Loading roster…
          </CardContent>
        </Card>
      )}

      {animalsQ.isError && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            Couldn't load this client's roster. Try refreshing the page.
          </CardContent>
        </Card>
      )}

      {!animalsQ.isLoading && !animalsQ.isError && animals.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>No animals visible yet</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              The owner's grant is active, but they don't have any animals
              on file{ownerContext?.ranchName ? ` for ${ownerContext.ranchName}` : ""}{" "}
              right now. Check back once they've added a horse.
            </p>
          </CardContent>
        </Card>
      )}

      {animals.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {animals.map((a) => (
            <RosterAnimalCard key={a.id} animal={a} />
          ))}
        </div>
      )}
    </div>
  );
}

function RosterAnimalCard({ animal }: { animal: RosterAnimal }) {
  const subtitle =
    [animal.species, animal.breed, animal.sex].filter(Boolean).join(" · ") ||
    "No details yet";

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-foreground">
              {animal.barn_name}
            </p>
            {animal.year_born ? (
              <Badge variant="secondary">{animal.year_born}</Badge>
            ) : null}
          </div>
          <p className="mt-1 truncate text-sm text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <Button asChild size="sm" variant="ghost">
          <Link
            to={`/trainer/animals/${animal.id}`}
            aria-label={`Open ${animal.barn_name}`}
          >
            Open <ArrowRight size={14} />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
