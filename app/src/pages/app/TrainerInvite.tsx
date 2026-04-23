import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { ACCESS_QUERY_KEY, grantAccess, TrainerProRequiredError } from "@/lib/access";
import { ANIMALS_QUERY_KEY, listAnimals } from "@/lib/animals";

const schema = z
  .object({
    trainer_email: z.string().trim().toLowerCase().email("Enter a valid email."),
    scope: z.enum(["animal", "ranch", "owner_all"]),
    animal_id: z.string().optional().or(z.literal("")),
    ranch_id:  z.string().optional().or(z.literal("")),
    notes:     z.string().trim().max(500, "Notes must be 500 characters or fewer.").optional().or(z.literal("")),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "animal" && !v.animal_id) {
      ctx.addIssue({ code: "custom", path: ["animal_id"], message: "Pick an animal." });
    }
    // Phase 1 doesn't surface ranch picker — the table is empty on owner
    // signup. We allow scope=ranch only when the server accepts it; the
    // UI just exposes animal + owner_all picks.
  });

type FormValues = z.input<typeof schema>;

// TrainerInvite — /app/trainers/invite
//
// Owner picks a trainer email + scope and submits. The Worker
// resolves the email to an approved trainer and writes the grant.
export default function TrainerInvite() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const animalsQuery = useQuery({
    queryKey: [...ANIMALS_QUERY_KEY, { includeArchived: false }],
    queryFn: () => listAnimals({ includeArchived: false }),
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      trainer_email: "",
      scope: "animal",
      animal_id: "",
      ranch_id: "",
      notes: "",
    },
  });

  const scope = watch("scope");

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      grantAccess({
        trainer_email: values.trainer_email,
        scope: values.scope,
        animal_id: values.scope === "animal" ? values.animal_id || null : null,
        ranch_id:  values.scope === "ranch"  ? values.ranch_id  || null : null,
        notes:     values.notes || null,
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ACCESS_QUERY_KEY });
      notify.success(
        `${res.trainer.display_name || res.trainer.email} now has access.`
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
        notify.error("No approved trainer with that email. Ask them to sign up and get approved first.");
        return;
      }
      if (code === "trainer_not_approved") {
        notify.error("That trainer's application is still pending review.");
        return;
      }
      notify.error(mapSupabaseError(err as Error));
    },
  });

  const disabled = isSubmitting || mutation.isPending;
  const animals = animalsQuery.data ?? [];

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
          They'll only see the animal, ranch, or roster you choose.
        </p>
      </header>

      <form
        onSubmit={handleSubmit((v) => mutation.mutate(v))}
        className="space-y-5"
        noValidate
      >
        <Field id="trainer_email" label="Trainer email" error={errors.trainer_email?.message} required>
          <Input
            id="trainer_email"
            type="email"
            autoComplete="off"
            placeholder="trainer@example.com"
            {...register("trainer_email")}
          />
        </Field>

        <Field id="scope" label="Scope" error={errors.scope?.message} required>
          <NativeSelect id="scope" {...register("scope")}>
            <option value="animal">A single animal</option>
            <option value="owner_all">All of my animals</option>
          </NativeSelect>
        </Field>

        {scope === "animal" ? (
          <Field id="animal_id" label="Animal" error={errors.animal_id?.message} required>
            <NativeSelect id="animal_id" {...register("animal_id")}>
              <option value="">Choose an animal…</option>
              {animals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.barn_name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        ) : null}

        <Field id="notes" label="Notes (optional)" error={errors.notes?.message}>
          <Textarea
            id="notes"
            rows={3}
            placeholder="What are they helping with? (Visible only to you.)"
            {...register("notes")}
          />
        </Field>

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="outline" onClick={() => navigate(-1)} disabled={disabled}>
            Cancel
          </Button>
          <Button type="submit" disabled={disabled}>
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
      className
    )}
    {...props}
  />
);
