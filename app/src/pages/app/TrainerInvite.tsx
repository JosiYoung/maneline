import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  ACCESS_QUERY_KEY,
  TRAINER_DIRECTORY_QUERY_KEY,
  grantAccess,
  listApprovedTrainers,
  TrainerProRequiredError,
} from "@/lib/access";
import { ANIMALS_QUERY_KEY, listAnimals } from "@/lib/animals";

// TrainerInvite — /app/trainers/invite
//
// Owner picks a trainer from the system directory + a scope.
// "A single animal" requires picking an animal; "All of my animals"
// does not. Submit calls /api/access/grant which writes the row.
//
// Plain useState (no react-hook-form): RHF + native <select> kept
// triggering "Invalid input" / "Pick a scope" errors because the
// form's internal value lagged the visible default option. Direct
// state is bulletproof here and the form is small enough that the
// extra structure didn't earn its keep.
type Scope = "animal" | "owner_all";

export default function TrainerInvite() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [trainerUserId, setTrainerUserId] = useState<string>("");
  const [scope, setScope] = useState<Scope>("animal");
  const [animalId, setAnimalId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [submitted, setSubmitted] = useState(false);

  const trainersQuery = useQuery({
    queryKey: TRAINER_DIRECTORY_QUERY_KEY,
    queryFn: listApprovedTrainers,
  });
  const trainers = trainersQuery.data ?? [];

  const animalsQuery = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }],
    queryFn: () => listAnimals({ includeArchived: false }),
  });
  const animals = animalsQuery.data ?? [];

  const selectedTrainer = useMemo(
    () => trainers.find((t) => t.user_id === trainerUserId) ?? null,
    [trainers, trainerUserId],
  );

  const errors = useMemo(() => {
    const e: Partial<Record<"trainer" | "animal" | "notes", string>> = {};
    if (!trainerUserId) e.trainer = "Pick a trainer.";
    if (scope === "animal" && !animalId) e.animal = "Pick an animal.";
    if (notes.length > 500) e.notes = "Notes must be 500 characters or fewer.";
    return e;
  }, [trainerUserId, scope, animalId, notes]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!selectedTrainer) {
        throw new Error("Pick a trainer.");
      }
      return grantAccess({
        trainer_email: selectedTrainer.email,
        scope,
        animal_id: scope === "animal" ? animalId || null : null,
        ranch_id: null,
        notes: notes.trim() || null,
      });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY });
      notify.success(
        `${res.trainer.display_name || res.trainer.email} now has access.`,
      );
      navigate("/app/trainers");
    },
    onError: (err) => {
      if (err instanceof TrainerProRequiredError) {
        notify.error(err.message);
        return;
      }
      const code = (err as Error & { code?: string }).code;
      if (code === "trainer_not_found") {
        notify.error(
          "That trainer's profile isn't visible. Have them sign up and get approved first.",
        );
        return;
      }
      if (code === "trainer_not_approved") {
        notify.error("That trainer's application is still pending review.");
        return;
      }
      notify.error(mapSupabaseError(err as Error));
    },
  });

  const disabled = mutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    mutation.mutate();
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <Link
          to="/app/trainers"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft size={16} />
          Trainers
        </Link>
        <h1 className="font-display text-2xl text-primary">Invite a trainer</h1>
        <p className="text-sm text-muted-foreground">
          Pick a trainer from the directory and choose what they can see.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <Field
          id="trainer"
          label="Trainer"
          error={submitted ? errors.trainer : undefined}
          required
        >
          {trainersQuery.isLoading ? (
            <div className="h-10 animate-pulse rounded-md border border-border bg-muted/40" />
          ) : trainersQuery.isError ? (
            <p className="text-sm text-destructive">
              Couldn't load trainers. Refresh and try again.
            </p>
          ) : trainers.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No approved trainers yet. When trainers sign up and get approved,
              they'll show up here.
            </div>
          ) : (
            <NativeSelect
              id="trainer"
              value={trainerUserId}
              onChange={(e) => setTrainerUserId(e.target.value)}
              disabled={disabled}
            >
              <option value="">Choose a trainer…</option>
              {trainers.map((t) => (
                <option key={t.user_id} value={t.user_id}>
                  {t.display_name ? `${t.display_name} (${t.email})` : t.email}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>

        <Field id="scope" label="Scope" required>
          <NativeSelect
            id="scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as Scope)}
            disabled={disabled}
          >
            <option value="animal">A single animal</option>
            <option value="owner_all">All of my animals</option>
          </NativeSelect>
        </Field>

        {scope === "animal" && (
          <Field
            id="animal_id"
            label="Animal"
            error={submitted ? errors.animal : undefined}
            required
          >
            {animalsQuery.isLoading ? (
              <div className="h-10 animate-pulse rounded-md border border-border bg-muted/40" />
            ) : animals.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">
                You don't have any animals yet. Add one first, then invite a trainer.
              </div>
            ) : (
              <NativeSelect
                id="animal_id"
                value={animalId}
                onChange={(e) => setAnimalId(e.target.value)}
                disabled={disabled}
              >
                <option value="">Choose an animal…</option>
                {animals.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.barn_name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}

        <Field
          id="notes"
          label="Notes (optional)"
          error={submitted ? errors.notes : undefined}
        >
          <Textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are they helping with? (Visible only to you.)"
            disabled={disabled}
          />
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate(-1)}
            disabled={disabled}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={disabled || trainers.length === 0}>
            {disabled ? "Sending…" : "Grant access"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}
        {required && <span className="ml-1 text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

const NativeSelect = ({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
      "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className,
    )}
    {...props}
  />
);
