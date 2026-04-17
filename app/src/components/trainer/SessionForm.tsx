import { forwardRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import {
  SESSIONS_QUERY_KEY,
  SESSION_TYPE_OPTIONS,
  createSession,
} from "@/lib/sessions";

// SessionForm — trainer-only, mounted at /trainer/sessions/new?animal=:id.
//
// Logging is NEVER gated on Stripe Connect status — Cedric's explicit
// policy (industry is trust-based). We only show an informational banner
// when the trainer hasn't completed Connect onboarding so they know the
// invoice side won't fire yet.

const schema = z.object({
  animal_id: z.string().uuid({ message: "Pick an animal." }),
  session_type: z.enum([
    "ride", "groundwork", "bodywork", "health_check", "lesson", "other",
  ]),
  started_at: z
    .string()
    .min(1, "Pick a date and time.")
    .refine((v) => !Number.isNaN(new Date(v).getTime()), "Invalid date."),
  duration_minutes: z.coerce
    .number()
    .int("Whole minutes only.")
    .min(5, "At least 5 minutes.")
    .max(600, "No more than 10 hours."),
  title: z
    .string()
    .trim()
    .min(1, "Give it a short title.")
    .max(120, "120 characters max."),
  notes: z.string().trim().max(4000, "4000 characters max.").optional().or(z.literal("")),
  price_dollars: z
    .union([z.literal(""), z.coerce.number().min(0).max(10_000)])
    .optional(),
});

type FormValues = z.input<typeof schema>;

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function SessionForm({
  defaultAnimalId,
}: {
  defaultAnimalId?: string | null;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // RLS on `animals` (animals_access_select, migration 00002:326) lets
  // the trainer SELECT every animal they currently have access to — a
  // plain list of accessible animals for the picker.
  const animalsQuery = useQuery({
    queryKey: ["trainer_accessible_animals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("animals")
        .select("id,barn_name,owner_id")
        .is("archived_at", null)
        .order("barn_name", { ascending: true });
      if (error) throw error;
      if (!data || data.length === 0) return [];
      const ownerIds = Array.from(new Set(data.map((a) => a.owner_id)));
      const { data: owners } = await supabase
        .from("user_profiles")
        .select("user_id,display_name,email")
        .in("user_id", ownerIds);
      const oMap = new Map<string, string>();
      for (const o of owners ?? []) {
        oMap.set(o.user_id, o.display_name ?? o.email ?? "Owner");
      }
      return data.map((a) => ({
        id: a.id,
        barn_name: a.barn_name,
        owner_name: oMap.get(a.owner_id) ?? "Owner",
      }));
    },
  });

  const connectQuery = useQuery({
    queryKey: ["v_my_connect_account"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_my_connect_account")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      animal_id: defaultAnimalId ?? "",
      session_type: "ride",
      started_at: toLocalInputValue(new Date()),
      duration_minutes: 60,
      title: "",
      notes: "",
      price_dollars: "",
    },
  });

  useEffect(() => {
    if (defaultAnimalId) setValue("animal_id", defaultAnimalId);
  }, [defaultAnimalId, setValue]);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const priceDollars =
        typeof values.price_dollars === "number" ? values.price_dollars : null;
      return createSession({
        animal_id: values.animal_id,
        session_type: values.session_type,
        started_at: new Date(values.started_at).toISOString(),
        duration_minutes: Number(values.duration_minutes),
        title: values.title.trim(),
        notes: values.notes?.trim() || null,
        trainer_price_cents:
          priceDollars == null ? null : Math.round(priceDollars * 100),
      });
    },
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      notify.success("Session logged.");
      navigate(`/trainer/sessions/${row.id}`);
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const disabled = isSubmitting || mutation.isPending;
  const animalOptions = animalsQuery.data ?? [];

  const connectReady = connectQuery.data?.charges_enabled === true;
  const showConnectBanner = !connectQuery.isLoading && !connectReady;

  return (
    <form
      onSubmit={handleSubmit((v) => mutation.mutate(v))}
      className="space-y-6"
      noValidate
    >
      {showConnectBanner && (
        <Card className="border-accent/40 bg-accent/5">
          <CardContent className="py-4 text-sm text-foreground">
            <p>
              Payments aren't wired up yet. You can still log sessions and
              send invoices — once you finish payout setup, any pending
              charges go through automatically.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Session details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <Field id="animal_id" label="Animal" error={errors.animal_id?.message} required>
            <NativeSelect id="animal_id" {...register("animal_id")}>
              <option value="">Choose an animal…</option>
              {animalOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.barn_name} · {a.owner_name}
                </option>
              ))}
            </NativeSelect>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id="session_type"
              label="Type"
              error={errors.session_type?.message}
              required
            >
              <NativeSelect id="session_type" {...register("session_type")}>
                {SESSION_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>

            <Field
              id="duration_minutes"
              label="Duration (minutes)"
              error={errors.duration_minutes?.message}
              required
            >
              <Input
                id="duration_minutes"
                type="number"
                inputMode="numeric"
                min={5}
                max={600}
                {...register("duration_minutes")}
              />
            </Field>
          </div>

          <Field id="started_at" label="Started at" error={errors.started_at?.message} required>
            <Input
              id="started_at"
              type="datetime-local"
              {...register("started_at")}
            />
          </Field>

          <Field id="title" label="Title" error={errors.title?.message} required>
            <Input
              id="title"
              type="text"
              placeholder="Groundwork — desensitizing to clippers"
              maxLength={120}
              {...register("title")}
            />
          </Field>

          <Field id="notes" label="Notes" error={errors.notes?.message}>
            <Textarea
              id="notes"
              rows={4}
              placeholder="What you worked on, how it went, anything the owner should know."
              maxLength={4000}
              {...register("notes")}
            />
          </Field>

          <Field
            id="price_dollars"
            label="Price (USD, optional)"
            error={errors.price_dollars?.message}
            hint={
              connectReady
                ? "Leave blank for unpaid / comp sessions."
                : "Save the number now — we'll collect once your Connect account is ready."
            }
          >
            <div className="relative">
              <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
                $
              </span>
              <Input
                id="price_dollars"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                className="pl-7"
                placeholder="0.00"
                {...register("price_dollars")}
              />
            </div>
          </Field>
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate(-1)}
          disabled={disabled}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={disabled}>
          {disabled ? "Logging…" : "Log session"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
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
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

const NativeSelect = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
      "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
