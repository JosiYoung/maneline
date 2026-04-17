import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ANIMALS_QUERY_KEY,
  createTestAnimal,
  listAnimals,
  type Animal,
} from "@/lib/animals";
import { cn } from "@/lib/utils";

// AnimalsIndex — /app/animals
//
// Shows active animals by default; a toggle reveals archived ones.
// Edit / archive are reached via /app/animals/:id.
export default function AnimalsIndex() {
  const [includeArchived, setIncludeArchived] = useState(false);

  const query = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived }],
    queryFn: () => listAnimals({ includeArchived }),
  });

  // Dev-only debug hook for the 1.4 verify block.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as {
      __manelineDebug?: { createTestAnimal: () => Promise<Animal> };
    }).__manelineDebug = { createTestAnimal };
  }, []);

  const animals = query.data ?? [];
  const activeCount = animals.filter((a) => a.archived_at == null).length;
  const archivedCount = animals.filter((a) => a.archived_at != null).length;

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-primary">Animals</h1>
          <p className="text-sm text-muted-foreground">
            Your barn. Create, edit, archive — never delete.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link to="/app/animals/new">
            <Plus size={16} />
            Add animal
          </Link>
        </Button>
      </header>

      <div className="flex items-center gap-3 text-sm">
        <label className="flex items-center gap-2 text-muted-foreground">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="text-xs text-muted-foreground">
          {activeCount} active{includeArchived ? ` · ${archivedCount} archived` : ""}
        </span>
      </div>

      {query.isLoading ? (
        <AnimalListSkeleton />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load your animals</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>Please refresh or check your internet connection.</p>
          </CardContent>
        </Card>
      ) : animals.length === 0 ? (
        <EmptyState includeArchived={includeArchived} />
      ) : (
        <ul className="space-y-3">
          {animals.map((a) => (
            <AnimalRow key={a.id} animal={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

function AnimalRow({ animal }: { animal: Animal }) {
  const archived = animal.archived_at != null;
  return (
    <li>
      <Link
        to={`/app/animals/${animal.id}`}
        className={cn(
          "block rounded-lg border border-border bg-card p-4 transition-colors",
          "hover:border-primary hover:bg-muted",
          archived && "opacity-60"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-lg text-foreground">
              {animal.barn_name}
            </p>
            <p className="text-xs text-muted-foreground">
              {[animal.species, animal.breed, animal.sex]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
          {archived ? (
            <Badge variant="outline">Archived</Badge>
          ) : animal.year_born ? (
            <Badge variant="secondary">{animal.year_born}</Badge>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

function EmptyState({ includeArchived }: { includeArchived: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {includeArchived
            ? "No animals — archived or active."
            : "No animals yet."}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Add your first horse or dog and start uploading records.
        </p>
        <Button asChild size="sm">
          <Link to="/app/animals/new">Add animal</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

function AnimalListSkeleton() {
  return (
    <ul className="space-y-3">
      {[0, 1, 2].map((i) => (
        <li
          key={i}
          className="h-[72px] animate-pulse rounded-lg border border-border bg-muted/40"
        />
      ))}
    </ul>
  );
}
