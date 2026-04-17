import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { VetRecordsList } from "@/components/trainer/VetRecordsList";
import { MediaGallery } from "@/components/trainer/MediaGallery";
import {
  TRAINER_ANIMAL_MEDIA_QUERY_KEY,
  TRAINER_ANIMAL_QUERY_KEY,
  TRAINER_ANIMAL_RECORDS_QUERY_KEY,
  getAnimalForTrainer,
  listMediaForTrainer,
  listVetRecordsForTrainer,
  type Animal,
} from "@/lib/trainerAnimals";

// AnimalReadOnly — /trainer/animals/:id.
//
// Trainer-facing snapshot of an animal they've been granted access to.
// Every read is RLS-gated through do_i_have_access_to_animal (migrations
// 00002:344, 00005:179, 00005:215) so an expired or revoked grant makes
// getAnimalForTrainer return a 404, not a partially-rendered page.
//
// Sessions tab is scaffolded empty — Prompt 2.5 populates it with the
// shared SessionsList once session logging lands.

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function AnimalReadOnly() {
  const { id = "" } = useParams();

  const animalQ = useQuery({
    queryKey: [...TRAINER_ANIMAL_QUERY_KEY, id],
    queryFn: () => getAnimalForTrainer(id),
    enabled: Boolean(id),
    retry: false,
  });

  const recordsQ = useQuery({
    queryKey: [...TRAINER_ANIMAL_RECORDS_QUERY_KEY, id],
    queryFn: () => listVetRecordsForTrainer(id),
    enabled: Boolean(id) && animalQ.isSuccess,
  });

  const mediaQ = useQuery({
    queryKey: [...TRAINER_ANIMAL_MEDIA_QUERY_KEY, id],
    queryFn: () => listMediaForTrainer(id),
    enabled: Boolean(id) && animalQ.isSuccess,
  });

  return (
    <div className="space-y-6">
      <Link
        to="/trainer/clients"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} />
        Clients
      </Link>

      {animalQ.isLoading && (
        <div className="h-48 animate-pulse rounded-lg border border-border bg-muted/40" />
      )}

      {animalQ.isError && (
        <Card>
          <CardHeader>
            <CardTitle>We couldn't load this animal.</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            The owner may have revoked your access, or the grant has
            expired. Return to your client roster to see who you still
            have active grants from.
          </CardContent>
        </Card>
      )}

      {animalQ.isSuccess && (
        <>
          <AnimalHeader animal={animalQ.data} />

          <Tabs defaultValue="records">
            <TabsList>
              <TabsTrigger value="records">Vet records</TabsTrigger>
              <TabsTrigger value="media">Media</TabsTrigger>
              <TabsTrigger value="sessions">Sessions</TabsTrigger>
            </TabsList>

            <TabsContent value="records">
              {recordsQ.isLoading && (
                <div className="h-24 animate-pulse rounded-md bg-muted/40" />
              )}
              {recordsQ.isError && (
                <Card>
                  <CardContent className="py-6 text-sm text-destructive">
                    Couldn't load records. Try refreshing the page.
                  </CardContent>
                </Card>
              )}
              {recordsQ.isSuccess && (
                <VetRecordsList records={recordsQ.data} />
              )}
            </TabsContent>

            <TabsContent value="media">
              {mediaQ.isLoading && (
                <div className="h-24 animate-pulse rounded-md bg-muted/40" />
              )}
              {mediaQ.isError && (
                <Card>
                  <CardContent className="py-6 text-sm text-destructive">
                    Couldn't load media. Try refreshing the page.
                  </CardContent>
                </Card>
              )}
              {mediaQ.isSuccess && <MediaGallery media={mediaQ.data} />}
            </TabsContent>

            <TabsContent value="sessions">
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  Session logging ships in the next drop. You'll be able
                  to log rides, groundwork, and bodywork here — with or
                  without payments wired up.
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function AnimalHeader({ animal }: { animal: Animal }) {
  const archived = animal.archived_at != null;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-primary">
            {animal.barn_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[animal.species, animal.breed, animal.sex]
              .filter(Boolean)
              .join(" · ") || "No details yet"}
          </p>
        </div>
        {archived ? (
          <Badge variant="outline">Archived</Badge>
        ) : animal.year_born ? (
          <Badge variant="secondary">{animal.year_born}</Badge>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <Detail label="Species" value={cap(animal.species)} />
          <Detail label="Breed" value={animal.breed ?? "—"} />
          <Detail label="Sex" value={animal.sex ? cap(animal.sex) : "—"} />
          <Detail
            label="Year born"
            value={animal.year_born?.toString() ?? "—"}
          />
          <Detail label="Discipline" value={animal.discipline ?? "—"} />
          <Detail label="Status" value={archived ? "Archived" : "Active"} />
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}
