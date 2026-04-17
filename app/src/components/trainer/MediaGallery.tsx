import { useEffect, useState } from "react";
import { Play } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { readUrlFor } from "@/lib/uploads";
import type { TrainerAnimalMedia } from "@/lib/trainerAnimals";

// MediaGallery — read-only photo / video grid for the trainer animal view.
// Each tile fetches a 5-min signed GET URL via the Worker's
// /api/uploads/read-url (verifies trainer access via
// do_i_have_access_to_animal). We swap the placeholder for an <img> once
// the URL resolves; videos render as a click-to-open tile rather than a
// full <video> embed so we don't autoplay across a roster.
//
// The URLs expire after 5 minutes; that's fine for a passive grid — by
// the time the trainer comes back, useQuery in the parent refetches.

function fmt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function MediaGallery({ media }: { media: TrainerAnimalMedia[] }) {
  if (media.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No photos or videos on file for this animal yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
      {media.map((m) => (
        <MediaTile key={m.id} media={m} />
      ))}
    </div>
  );
}

function MediaTile({ media }: { media: TrainerAnimalMedia }) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!media.object_key) {
      setErr(true);
      return;
    }
    readUrlFor(media.object_key)
      .then(({ get_url }) => {
        if (!cancelled) setUrl(get_url);
      })
      .catch(() => {
        if (!cancelled) setErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, [media.object_key]);

  const label = media.caption ?? (media.kind === "video" ? "Video" : "Photo");
  const date = fmt(media.taken_on);

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {err && (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Unable to load
          </div>
        )}
        {!err && !url && (
          <div className="h-full animate-pulse bg-muted/60" />
        )}
        {!err && url && media.kind === "photo" && (
          <img
            src={url}
            alt={label}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
        {!err && url && media.kind === "video" && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative flex h-full items-center justify-center bg-black/70 text-white"
            aria-label={`Open ${label}`}
          >
            <Play size={36} className="opacity-90" />
          </a>
        )}
        {media.kind === "video" && (
          <div className="absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white">
            Video
          </div>
        )}
      </div>
      <CardContent className="p-3 text-xs text-muted-foreground">
        <p className="truncate text-foreground">{label}</p>
        {date && <p>{date}</p>}
      </CardContent>
    </Card>
  );
}
