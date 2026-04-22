import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  ANIMALS_QUERY_KEY,
  createAnimal,
  updateAnimal,
  BarnModeRequiredError,
  type Animal,
  type AnimalInput,
} from "@/lib/animals";
import { BarnModePaywallDialog } from "./BarnModePaywallDialog";

// Species → allowed sex values. Keeps the Sex select honest (no
// dog-shaped "stallion" entries).
const SEX_BY_SPECIES = {
  horse: ["mare", "gelding", "stallion"] as const,
  dog:   ["male", "female"] as const,
};

const CURRENT_YEAR = new Date().getFullYear();

const animalSchema = z.object({
  barn_name: z
    .string()
    .trim()
    .min(1, "Barn name is required.")
    .max(40, "Barn name must be 40 characters or fewer."),
  species: z.enum(["horse", "dog"]),
  breed: z
    .string()
    .trim()
    .max(60, "Breed must be 60 characters or fewer.")
    .optional()
    .or(z.literal("")),
  sex: z.enum(["mare", "gelding", "stallion", "male", "female"]).optional().or(z.literal("")),
  year_born: z
    .union([
      z.coerce
        .number()
        .int()
        .gte(1990, `Year born must be between 1990 and ${CURRENT_YEAR}.`)
        .lte(CURRENT_YEAR, `Year born must be between 1990 and ${CURRENT_YEAR}.`),
      z.literal(""),
    ])
    .optional(),
  discipline: z
    .string()
    .trim()
    .max(60, "Discipline must be 60 characters or fewer.")
    .optional()
    .or(z.literal("")),
});

type AnimalFormValues = z.input<typeof animalSchema>;

export type AnimalFormProps =
  | { mode: "create"; initial?: never; animalId?: never }
  | { mode: "edit"; initial: Animal; animalId: string };

export function AnimalForm(props: AnimalFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [paywall, setPaywall] = useState<{ open: boolean; count: number | null }>({
    open: false, count: null,
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AnimalFormValues>({
    resolver: zodResolver(animalSchema),
    defaultValues: props.mode === "edit" ? toFormValues(props.initial) : {
      barn_name: "",
      species: "horse",
      breed: "",
      sex: "",
      year_born: "",
      discipline: "",
    },
  });

  const species = watch("species");
  const sexOptions = SEX_BY_SPECIES[species] ?? SEX_BY_SPECIES.horse;

  const mutation = useMutation({
    mutationFn: async (values: AnimalFormValues) => {
      const payload = toInput(values);
      if (props.mode === "create") return createAnimal(payload);
      return updateAnimal(props.animalId, payload);
    },
    onSuccess: (animal) => {
      queryClient.invalidateQueries({ queryKey: ANIMALS_QUERY_KEY });
      notify.success(
        props.mode === "create"
          ? `${animal.barn_name} added.`
          : `${animal.barn_name} updated.`
      );
      navigate(props.mode === "create" ? "/app/animals" : `/app/animals/${animal.id}`);
    },
    onError: (err) => {
      if (err instanceof BarnModeRequiredError) {
        setPaywall({ open: true, count: err.currentHorseCount });
        return;
      }
      notify.error(mapSupabaseError(err as Error));
    },
  });

  const disabled = isSubmitting || mutation.isPending;

  return (
    <>
    <BarnModePaywallDialog
      open={paywall.open}
      onClose={() => setPaywall({ open: false, count: null })}
      currentHorseCount={paywall.count}
    />
    <form
      onSubmit={handleSubmit((values) => mutation.mutate(values))}
      className="space-y-5"
      noValidate
    >
      <Field
        id="barn_name"
        label="Barn name"
        error={errors.barn_name?.message}
        required
      >
        <Input
          id="barn_name"
          autoComplete="off"
          placeholder="Duchess"
          {...register("barn_name")}
        />
      </Field>

      <Field
        id="species"
        label="Species"
        error={errors.species?.message}
        required
      >
        <NativeSelect id="species" {...register("species")}>
          <option value="horse">Horse</option>
          <option value="dog">Dog</option>
        </NativeSelect>
      </Field>

      <Field id="breed" label="Breed" error={errors.breed?.message}>
        <Input
          id="breed"
          autoComplete="off"
          placeholder={species === "horse" ? "Quarter Horse" : "Australian Shepherd"}
          {...register("breed")}
        />
      </Field>

      <Field id="sex" label="Sex" error={errors.sex?.message}>
        <NativeSelect id="sex" {...register("sex")}>
          <option value="">—</option>
          {sexOptions.map((value) => (
            <option key={value} value={value}>
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <Field id="year_born" label="Year born" error={errors.year_born?.message}>
        <Input
          id="year_born"
          type="number"
          inputMode="numeric"
          min={1990}
          max={CURRENT_YEAR}
          placeholder={String(CURRENT_YEAR - 5)}
          {...register("year_born")}
        />
      </Field>

      <Field
        id="discipline"
        label="Discipline"
        error={errors.discipline?.message}
      >
        <Input
          id="discipline"
          autoComplete="off"
          placeholder="Ranch, Dressage, Trail…"
          {...register("discipline")}
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
        <Button type="submit" disabled={disabled}>
          {disabled
            ? "Saving…"
            : props.mode === "create"
              ? "Add animal"
              : "Save changes"}
        </Button>
      </div>
    </form>
    </>
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

// Native <select> styled to match Input. Keeps scope tight — we have only
// two dropdowns (species, sex), both small enums; the full shadcn Select
// primitive would be overkill here.
const NativeSelect = ({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
      "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
);

function toFormValues(a: Animal): AnimalFormValues {
  return {
    barn_name:  a.barn_name,
    species:    a.species,
    breed:      a.breed ?? "",
    sex:        a.sex ?? "",
    year_born:  a.year_born != null ? String(a.year_born) as unknown as number : "",
    discipline: a.discipline ?? "",
  };
}

function toInput(v: AnimalFormValues): AnimalInput {
  const breed = typeof v.breed === "string" ? v.breed.trim() : "";
  const discipline = typeof v.discipline === "string" ? v.discipline.trim() : "";
  const sex = v.sex ? (v.sex as AnimalInput["sex"]) : null;
  const yearRaw = v.year_born;
  const year_born =
    yearRaw === "" || yearRaw == null
      ? null
      : typeof yearRaw === "number"
        ? yearRaw
        : Number(yearRaw);

  return {
    barn_name:  v.barn_name.trim(),
    species:    v.species,
    breed:      breed === "" ? null : breed,
    sex,
    year_born,
    discipline: discipline === "" ? null : discipline,
  };
}
