import { forwardRef, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Paperclip, ShoppingBag, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  EXPENSES_QUERY_KEY,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_OPTIONS,
  createExpense,
  parseDollarsToCents,
  todayIsoDate,
  type ExpenseCategory,
  type ExpenseRecorderRole,
} from "@/lib/expenses";
import {
  createExpenseDraftCheckout,
  formatPrice,
  type ShopProduct,
} from "@/lib/shop";
import { ProductPicker } from "@/components/shop/ProductPicker";
import {
  EXPENSE_RECEIPT_MIME,
  MAX_UPLOAD_BYTES,
  commitUpload,
  requestPresign,
  uploadToR2,
} from "@/lib/uploads";

// ExpenseForm — shared between owner (on AnimalDetail) and trainer
// (on ExpensesIndex + AnimalReadOnly). The caller passes the role so
// the INSERT row stamps the correct `recorder_role` to satisfy the
// split owner/trainer INSERT policies (migration 00009:257-294).
//
// Amount is entered as dollars in a text input with `$` leading
// adornment; Zod refines the string → integer cents on submit.
// No in-expense Silver Lining picker here — Prompt 3.8 layers that on.

const schema = z.object({
  animal_id: z.string().uuid(),
  category: z.enum(EXPENSE_CATEGORIES),
  occurred_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  amount_input: z
    .string()
    .trim()
    .min(1, "Enter an amount.")
    .refine((v) => {
      const c = parseDollarsToCents(v);
      return c != null && c >= 1 && c <= 100_000_00;
    }, "Amount must be between $0.01 and $100,000."),
  vendor: z
    .string()
    .trim()
    .max(200, "200 characters max.")
    .optional()
    .or(z.literal("")),
  notes: z
    .string()
    .trim()
    .max(4000, "4000 characters max.")
    .optional()
    .or(z.literal("")),
});

type FormValues = z.input<typeof schema>;

export interface ExpenseFormProps {
  animalId: string;
  recorderRole: ExpenseRecorderRole;
  defaultCategory?: ExpenseCategory;
  sessionId?: string | null;
  onCreated?: () => void;
  onCancel?: () => void;
}

export function ExpenseForm({
  animalId,
  recorderRole,
  defaultCategory = "other",
  sessionId,
  onCreated,
  onCancel,
}: ExpenseFormProps) {
  const queryClient = useQueryClient();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      animal_id: animalId,
      category: defaultCategory,
      occurred_on: todayIsoDate(),
      amount_input: "",
      vendor: "",
      notes: "",
    },
  });

  const category = watch("category");
  const [selectedProduct, setSelectedProduct] = useState<ShopProduct | null>(null);
  const [buying, setBuying] = useState(false);
  const [receipt, setReceipt] = useState<{
    r2_object_id: string;
    name: string;
  } | null>(null);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleReceiptSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!EXPENSE_RECEIPT_MIME.has(file.type)) {
      notify.error("Use PDF, JPG, PNG, HEIC, or WEBP.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      notify.error("Receipt must be 25 MB or less.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setReceiptUploading(true);
    try {
      const presign = await requestPresign({
        kind: "expense_receipt",
        contentType: file.type,
        byteSize: file.size,
        animalId,
      });
      await uploadToR2(presign.put_url, file);
      const committed = await commitUpload({
        kind: "expense_receipt",
        object_key: presign.object_key,
        animal_id: animalId,
      });
      setReceipt({ r2_object_id: committed.r2_object_id, name: file.name });
      notify.success("Receipt attached.");
    } catch (err) {
      const msg = mapSupabaseError(err as Error);
      notify.error(msg);
    } finally {
      setReceiptUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeReceipt() {
    setReceipt(null);
  }

  function handleProductSelect(product: ShopProduct | null) {
    setSelectedProduct(product);
    if (product) {
      setValue("amount_input", (product.price_cents / 100).toFixed(2), {
        shouldValidate: true,
        shouldDirty: true,
      });
      setValue("vendor", "Silver Lining", {
        shouldValidate: false,
        shouldDirty: true,
      });
    }
  }

  async function handleBuyNow() {
    if (!selectedProduct) return;
    const values = getValues();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.occurred_on)) {
      notify.error("Pick a date before buying.");
      return;
    }
    setBuying(true);
    try {
      const res = await createExpenseDraftCheckout({
        variantId: selectedProduct.shopify_variant_id,
        expenseDraft: {
          animal_id:    animalId,
          recorder_role: recorderRole,
          category:     "supplement",
          occurred_on:  values.occurred_on,
          notes:        values.notes?.trim() || null,
        },
      });
      window.location.assign(res.url);
    } catch (err) {
      const msg = mapSupabaseError(err as Error);
      notify.error(msg);
      setSubmitError(msg);
      setBuying(false);
    }
  }

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const cents = parseDollarsToCents(values.amount_input);
      if (cents == null) throw new Error("Amount must be a valid dollar value.");
      return createExpense(
        {
          animal_id:    animalId,
          category:     values.category,
          occurred_on:  values.occurred_on,
          amount_cents: cents,
          vendor:       values.vendor?.trim() || null,
          notes:        values.notes?.trim() || null,
          receipt_r2_object_id: receipt?.r2_object_id ?? null,
          session_id:           sessionId ?? null,
        },
        recorderRole,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EXPENSES_QUERY_KEY });
      notify.success("Expense saved.");
      reset({
        animal_id: animalId,
        category: defaultCategory,
        occurred_on: todayIsoDate(),
        amount_input: "",
        vendor: "",
        notes: "",
      });
      setReceipt(null);
      setSubmitError(null);
      onCreated?.();
    },
    onError: (err) => {
      const msg = mapSupabaseError(err as Error);
      setSubmitError(msg);
      notify.error(msg);
    },
  });

  const disabled = isSubmitting || mutation.isPending;

  return (
    <form
      onSubmit={handleSubmit((v) => mutation.mutate(v))}
      className="space-y-5"
      noValidate
    >
      <input type="hidden" {...register("animal_id")} value={animalId} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="expense-category"
          label="Category"
          error={errors.category?.message}
          required
        >
          <NativeSelect id="expense-category" {...register("category")}>
            {EXPENSE_CATEGORY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field
          id="expense-date"
          label="Date"
          error={errors.occurred_on?.message}
          required
        >
          <Input
            id="expense-date"
            type="date"
            max={todayIsoDate()}
            {...register("occurred_on")}
          />
        </Field>
      </div>

      {category === "supplement" && (
        <div className="space-y-1.5">
          <Label>Silver Lining product (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Pick a supplement to auto-fill the amount and vendor — or use
            "Buy now" to order it from Silver Lining and have the expense
            logged automatically when payment clears.
          </p>
          <ProductPicker
            selectedVariantId={selectedProduct?.shopify_variant_id ?? null}
            onSelect={handleProductSelect}
            disabled={disabled || buying}
          />
          {selectedProduct && (
            <p className="text-xs text-muted-foreground">
              Selected:{" "}
              <span className="text-foreground">{selectedProduct.title}</span>{" "}
              — {formatPrice(selectedProduct.price_cents)}
            </p>
          )}
        </div>
      )}

      <Field
        id="expense-amount"
        label="Amount (USD)"
        error={errors.amount_input?.message}
        required
      >
        <div className="relative">
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground"
            aria-hidden="true"
          >
            $
          </span>
          <Input
            id="expense-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            className="pl-7"
            placeholder="0.00"
            {...register("amount_input")}
          />
        </div>
      </Field>

      <Field
        id="expense-vendor"
        label="Vendor (optional)"
        error={errors.vendor?.message}
      >
        <Input
          id="expense-vendor"
          type="text"
          maxLength={200}
          placeholder="e.g. Triple Crown, Dr. Patel DVM"
          {...register("vendor")}
        />
      </Field>

      <Field
        id="expense-notes"
        label="Notes (optional)"
        error={errors.notes?.message}
      >
        <Textarea
          id="expense-notes"
          rows={3}
          maxLength={4000}
          placeholder="What the charge covered, anything unusual, who approved it."
          {...register("notes")}
        />
      </Field>

      <div className="space-y-1.5">
        <Label htmlFor="expense-receipt">Receipt (optional)</Label>
        {receipt ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-input bg-muted/30 px-3 py-2">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <Paperclip className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">{receipt.name}</span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={removeReceipt}
              disabled={disabled}
              aria-label="Remove receipt"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <>
            <input
              ref={fileInputRef}
              id="expense-receipt"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic,image/webp"
              onChange={handleReceiptSelect}
              disabled={disabled || receiptUploading}
              className={cn(
                "flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm",
                "file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs file:font-medium",
                "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            />
            <p className="text-xs text-muted-foreground">
              {receiptUploading
                ? "Uploading…"
                : "PDF, JPG, PNG, HEIC, or WEBP. Max 25 MB."}
            </p>
          </>
        )}
      </div>

      {submitError && (
        <p className="text-sm text-destructive" role="alert">
          {submitError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={disabled || buying}
          >
            Cancel
          </Button>
        )}
        {category === "supplement" && selectedProduct && (
          <Button
            type="button"
            onClick={handleBuyNow}
            disabled={disabled || buying}
            className="bg-accent text-accent-foreground hover:bg-accent/90"
          >
            <ShoppingBag size={16} className="mr-2" aria-hidden="true" />
            {buying
              ? "Redirecting…"
              : `Buy now · ${formatPrice(selectedProduct.price_cents)}`}
          </Button>
        )}
        <Button type="submit" disabled={disabled || buying || receiptUploading}>
          {disabled ? "Saving…" : "Save expense"}
        </Button>
      </div>
    </form>
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
      className,
    )}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";
