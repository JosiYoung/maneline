import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/lib/authStore";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  TRAINER_BRANDING_QUERY_KEY,
  fetchTrainerBranding,
  upsertInvoiceSettings,
  DEFAULT_SETTINGS,
} from "@/lib/trainerBranding";

// InvoiceDefaultsSection — /trainer/account → "Invoice defaults".
//
// Three knobs that feed the monthly auto-finalize cron + PDF renderer:
//   • Net days     — added to invoice_date to compute due_date
//   • Auto-finalize day — 1..28. Cron at UTC midnight finalizes drafts
//                         whose trainer's day-of-month matches today in
//                         their stored invoice_timezone.
//   • Footer memo  — text appended to PDF + hosted page (≤500 chars)
//
// All three live on trainer_invoice_settings. Row is created lazily on
// first save, so brand_hex is carried through on every upsert to avoid
// clobbering what BrandingSection just wrote.

const FOOTER_MAX = 500;

export function InvoiceDefaultsSection() {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id) ?? null;

  const brandingQ = useQuery({
    queryKey: TRAINER_BRANDING_QUERY_KEY,
    queryFn: () => {
      if (!userId) throw new Error("Not signed in.");
      return fetchTrainerBranding(userId);
    },
    enabled: Boolean(userId),
  });

  const settings = brandingQ.data?.settings;

  const [netDays, setNetDays] = useState<string>(
    String(DEFAULT_SETTINGS.default_due_net_days)
  );
  const [autoDay, setAutoDay] = useState<string>(
    String(DEFAULT_SETTINGS.auto_finalize_day)
  );
  const [memo, setMemo] = useState<string>("");

  useEffect(() => {
    setNetDays(
      String(settings?.default_due_net_days ?? DEFAULT_SETTINGS.default_due_net_days)
    );
    setAutoDay(
      String(settings?.auto_finalize_day ?? DEFAULT_SETTINGS.auto_finalize_day)
    );
    setMemo(settings?.footer_memo ?? "");
  }, [settings?.default_due_net_days, settings?.auto_finalize_day, settings?.footer_memo]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("Not signed in.");
      const parsedNet = Number(netDays);
      const parsedAuto = Number(autoDay);
      if (!Number.isInteger(parsedNet) || parsedNet < 0 || parsedNet > 120) {
        throw new Error("Net days must be a whole number between 0 and 120.");
      }
      if (!Number.isInteger(parsedAuto) || parsedAuto < 1 || parsedAuto > 28) {
        throw new Error("Auto-finalize day must be between 1 and 28.");
      }
      const trimmedMemo = memo.trim();
      if (trimmedMemo.length > FOOTER_MAX) {
        throw new Error(`Footer memo must be ${FOOTER_MAX} characters or fewer.`);
      }
      return upsertInvoiceSettings(userId, {
        default_due_net_days: parsedNet,
        auto_finalize_day: parsedAuto,
        footer_memo: trimmedMemo || null,
        brand_hex: settings?.brand_hex ?? null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRAINER_BRANDING_QUERY_KEY });
      notify.success("Invoice defaults saved");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    save.mutate();
  }

  const memoLen = memo.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Invoice defaults</CardTitle>
        <p className="text-sm text-muted-foreground">
          Controls when invoices finalize, when they're due, and the
          footer text shown on every invoice you send.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="net-days">Payment terms (net days)</Label>
              <Input
                id="net-days"
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                value={netDays}
                onChange={(e) => setNetDays(e.target.value)}
                disabled={save.isPending || !userId}
              />
              <p className="text-xs text-muted-foreground">
                Days after invoice date until payment is due. Default 15.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="auto-day">Auto-finalize day of month</Label>
              <Input
                id="auto-day"
                type="number"
                inputMode="numeric"
                min={1}
                max={28}
                value={autoDay}
                onChange={(e) => setAutoDay(e.target.value)}
                disabled={save.isPending || !userId}
              />
              <p className="text-xs text-muted-foreground">
                We send monthly drafts on this day in your timezone. 1–28
                only so it fires every month.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="footer-memo">Footer memo (optional)</Label>
            <Textarea
              id="footer-memo"
              rows={3}
              maxLength={FOOTER_MAX}
              placeholder="Thanks for your business! Payment details at the link above."
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              disabled={save.isPending || !userId}
            />
            <p className="text-xs text-muted-foreground">
              {memoLen}/{FOOTER_MAX} characters. Appears on the PDF and
              Stripe-hosted payment page.
            </p>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={save.isPending || !userId}>
              {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save defaults
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
