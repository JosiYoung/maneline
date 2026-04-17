import { useMutation } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { readUrlFor } from "@/lib/uploads";
import { notify } from "@/lib/toast";
import { mapSupabaseError } from "@/lib/errors";
import {
  isExpired,
  isExpiringSoon,
  type TrainerVetRecord,
} from "@/lib/trainerAnimals";

// VetRecordsList — trainer-side read-only list of an animal's vet records.
// Signed-GET URL flow mirrors the owner-side RecentRecordRow in
// pages/app/AnimalDetail.tsx; the /api/uploads/read-url Worker handler
// already verifies trainer access via do_i_have_access_to_animal.
//
// Expired Coggins get a destructive badge so trainers can flag stale
// paperwork before a haul or a show. 30-day "Expiring soon" chip matches
// the owner attention surface.

function fmt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function VetRecordsList({
  records,
}: {
  records: TrainerVetRecord[];
}) {
  if (records.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No vet records on file for this animal yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {records.map((r) => (
        <VetRecordRow key={r.id} record={r} />
      ))}
    </ul>
  );
}

function VetRecordRow({ record }: { record: TrainerVetRecord }) {
  const view = useMutation({
    mutationFn: async () => {
      if (!record.object_key) throw new Error("File missing");
      const { get_url } = await readUrlFor(record.object_key);
      window.open(get_url, "_blank", "noopener,noreferrer");
    },
    onError: (err) => notify.error(mapSupabaseError(err as Error)),
  });

  const expired = isExpired(record.expires_on);
  const expiringSoon = !expired && isExpiringSoon(record.expires_on);

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex min-w-0 items-center gap-3">
        <FileText size={18} className="shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-medium">{cap(record.record_type)}</p>
            {expired && (
              <Badge
                variant="outline"
                className="border-destructive bg-destructive/10 text-destructive"
              >
                Expired
              </Badge>
            )}
            {expiringSoon && (
              <Badge variant="outline" className="border-[#C4552B] text-[#C4552B]">
                Due soon
              </Badge>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {[
              record.issued_on && `Issued ${fmt(record.issued_on)}`,
              record.expires_on && `Expires ${fmt(record.expires_on)}`,
              record.issuing_provider,
            ]
              .filter(Boolean)
              .join(" · ") || "No dates"}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => view.mutate()}
        disabled={view.isPending || !record.object_key}
        aria-label={`View ${record.record_type}`}
      >
        <ExternalLink size={14} />
      </Button>
    </li>
  );
}
