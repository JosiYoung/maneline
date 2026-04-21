import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2, ImageOff, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { useAuthStore } from "@/lib/authStore";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  TRAINER_BRANDING_QUERY_KEY,
  fetchTrainerBranding,
  upsertInvoiceSettings,
  normalizeHex,
  syncBrandingToStripe,
  DEFAULT_SETTINGS,
} from "@/lib/trainerBranding";
import {
  requestPresign,
  uploadToR2,
  commitUpload,
  readUrlFor,
  TRAINER_LOGO_MIME,
  MAX_LOGO_BYTES,
} from "@/lib/uploads";

// BrandingSection — /trainer/account → "Invoice branding".
//
// Two controls: logo upload (R2 via /api/uploads/{sign,commit} with
// kind='trainer_logo') and brand hex picker. The hex saves into
// trainer_invoice_settings; the logo key lands on trainer_profiles.
//
// Hex picker uses the native <input type="color"> so we don't pull in a
// color-picker dep. It always emits lowercase #rrggbb which satisfies
// the DB regex check (see migration 00018).

const FALLBACK_HEX = "#0f766e"; // teal-700, matches our default chart accent.

export function BrandingSection() {
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
  const profile = brandingQ.data?.profile;

  // Keep the hex input controlled and seed from server. We persist on
  // blur, so local edits are free until the user commits them.
  const [hex, setHex] = useState<string>(FALLBACK_HEX);
  useEffect(() => {
    setHex(normalizeHex(settings?.brand_hex) ?? FALLBACK_HEX);
  }, [settings?.brand_hex]);

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoLoading, setLogoLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLogoUrl(null);
    const key = profile?.invoice_logo_r2_key ?? null;
    if (!key) return;
    setLogoLoading(true);
    readUrlFor(key)
      .then((r) => {
        if (!cancelled) setLogoUrl(r.get_url);
      })
      .catch(() => {
        if (!cancelled) setLogoUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLogoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile?.invoice_logo_r2_key]);

  const syncMutation = useMutation({
    mutationFn: () => syncBrandingToStripe(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRAINER_BRANDING_QUERY_KEY });
    },
  });

  // Best-effort propagate to Stripe. We ignore failures for auto-sync
  // triggered by save/upload — the UI surfaces a dedicated error state
  // via the manual "Sync to Stripe" button, and the next manual sync
  // will retry. The only case we suppress is no_connect_account, which
  // is expected pre-onboarding.
  async function autoSync() {
    try {
      await syncMutation.mutateAsync();
    } catch (err) {
      const code = (err as Error & { code?: string })?.code;
      if (code && code !== "no_connect_account") {
        notify.error("Saved locally, but Stripe sync failed. Retry from the sync button.");
      }
    }
  }

  const saveHex = useMutation({
    mutationFn: async (nextHex: string | null) => {
      if (!userId) throw new Error("Not signed in.");
      return upsertInvoiceSettings(userId, {
        default_due_net_days:
          settings?.default_due_net_days ?? DEFAULT_SETTINGS.default_due_net_days,
        auto_finalize_day:
          settings?.auto_finalize_day ?? DEFAULT_SETTINGS.auto_finalize_day,
        footer_memo: settings?.footer_memo ?? null,
        brand_hex: nextHex,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRAINER_BRANDING_QUERY_KEY });
      notify.success("Brand color saved");
      autoSync();
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-upload of the same file
    if (!file) return;

    if (!TRAINER_LOGO_MIME.has(file.type)) {
      notify.error("Logo must be PNG, JPG, or WebP.");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      notify.error("Logo must be under 2 MB.");
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const presign = await requestPresign({
        kind: "trainer_logo",
        contentType: file.type,
        byteSize: file.size,
      });
      await uploadToR2(presign.put_url, file, (f) =>
        setUploadProgress(Math.round(f * 100))
      );
      await commitUpload({
        kind: "trainer_logo",
        object_key: presign.object_key,
      });
      queryClient.invalidateQueries({ queryKey: TRAINER_BRANDING_QUERY_KEY });
      notify.success("Logo uploaded");
      autoSync();
    } catch (err) {
      notify.error(
        (err as Error & { code?: string })?.code === "rate_limited"
          ? "Too many uploads. Try again in a minute."
          : mapSupabaseError(err as Error)
      );
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Invoice branding</CardTitle>
        <p className="text-sm text-muted-foreground">
          Your logo and color appear on the invoices you send. Upload a
          square-ish PNG or JPG under 2 MB for best results.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div
            className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted/40"
            aria-label="Current invoice logo preview"
          >
            {logoLoading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : logoUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <img
                src={logoUrl}
                alt="Invoice logo"
                className="h-full w-full object-contain"
              />
            ) : (
              <ImageOff className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={onPickFile}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !userId}
            >
              {uploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading {uploadProgress}%
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {profile?.invoice_logo_r2_key ? "Replace logo" : "Upload logo"}
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              PNG, JPG, or WebP · up to 2 MB
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="brand-hex">Brand color</Label>
          <div className="flex items-center gap-3">
            <Input
              id="brand-hex"
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              onBlur={() => {
                const normalized = normalizeHex(hex);
                const currentStored = normalizeHex(settings?.brand_hex);
                if (normalized !== currentStored) saveHex.mutate(normalized);
              }}
              className="h-10 w-16 cursor-pointer p-1"
              aria-label="Pick brand color"
              disabled={saveHex.isPending || !userId}
            />
            <code className="text-sm text-muted-foreground">{hex}</code>
            {settings?.brand_hex && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setHex(FALLBACK_HEX);
                  saveHex.mutate(null);
                }}
                disabled={saveHex.isPending}
              >
                Reset
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Used as the accent color on invoice headers and your hosted
            payment page.
          </p>
        </div>

        <BrandingSyncRow
          syncedAt={profile?.branding_synced_at ?? null}
          pending={syncMutation.isPending}
          onSync={() => {
            syncMutation.mutate(undefined, {
              onSuccess: () => notify.success("Branding synced to Stripe"),
              onError: (err) => {
                const e = err as Error & { code?: string };
                notify.error(
                  e.code === "no_connect_account"
                    ? "Finish Stripe Connect onboarding before syncing branding."
                    : e.message || "Stripe sync failed."
                );
              },
            });
          }}
        />
      </CardContent>
    </Card>
  );
}

function BrandingSyncRow({
  syncedAt,
  pending,
  onSync,
}: {
  syncedAt: string | null;
  pending: boolean;
  onSync: () => void;
}) {
  const label = syncedAt
    ? `Last synced to Stripe ${formatRelative(syncedAt)}`
    : "Not yet synced to Stripe. Save a color or upload a logo to push it.";
  return (
    <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">{label}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSync}
        disabled={pending}
      >
        {pending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="mr-2 h-4 w-4" />
        )}
        Sync to Stripe
      </Button>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
