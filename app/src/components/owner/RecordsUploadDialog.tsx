import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ANIMALS_QUERY_KEY, listAnimals } from "@/lib/animals";
import { RecordsUploader } from "./RecordsUploader";

// Thin wrapper around RecordsUploader. The uploader itself assumes
// (animalId, animalName) — this dialog lets callers from Records show
// a picker first, so an owner with several animals doesn't have to
// navigate into AnimalDetail just to upload a Coggins.
export function RecordsUploadDialog({
  initialAnimalId,
  trigger,
}: {
  initialAnimalId?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [animalId, setAnimalId] = useState<string>(initialAnimalId ?? "");

  const animalsQuery = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }],
    queryFn: () => listAnimals({ includeArchived: false }),
    enabled: open,
  });

  const animals = animalsQuery.data ?? [];
  const selected = animals.find((a) => a.id === animalId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setAnimalId(initialAnimalId ?? "");
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Plus size={16} />
            Upload record
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a record</DialogTitle>
          <DialogDescription>
            Coggins, vaccines, dental, farrier — your vault, your rules.
          </DialogDescription>
        </DialogHeader>

        {!initialAnimalId && animals.length > 0 ? (
          <div className="space-y-1.5">
            <Label htmlFor="animal_picker">Animal</Label>
            <select
              id="animal_picker"
              value={animalId}
              onChange={(e) => setAnimalId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Choose an animal…</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.barn_name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {animalId && selected ? (
          <RecordsUploader
            animalId={animalId}
            animalName={selected.barn_name}
            onUploaded={() => setOpen(false)}
          />
        ) : !initialAnimalId ? (
          <p className="text-sm text-muted-foreground">
            Pick an animal to continue.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
