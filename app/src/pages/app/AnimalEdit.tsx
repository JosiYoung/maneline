import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";

import { AnimalForm } from "@/components/owner/AnimalForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ANIMALS_QUERY_KEY, getAnimal } from "@/lib/animals";

// AnimalEdit — /app/animals/:id/edit
export default function AnimalEdit() {
  const { id = "" } = useParams();
  const query = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, id],
    queryFn: () => getAnimal(id),
    enabled: Boolean(id),
  });

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          to={`/app/animals/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={16} />
          Back
        </Link>
        <h1 className="font-display text-2xl text-primary">
          {query.data ? `Edit ${query.data.barn_name}` : "Edit animal"}
        </h1>
      </header>

      {query.isLoading ? (
        <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
      ) : query.isError || !query.data ? (
        <Card>
          <CardHeader>
            <CardTitle>We couldn't load this animal.</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            It may have been archived or you may not have access.
          </CardContent>
        </Card>
      ) : (
        <AnimalForm mode="edit" animalId={id} initial={query.data} />
      )}
    </div>
  );
}
