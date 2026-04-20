import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, ImageIcon, Video } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getVetShare, type VetShareBundle } from "@/lib/vetShare";

// VetView — /vet/:token
//
// Anonymous, read-only bundle scoped to a single animal's 12-month
// record. The token is the credential; Worker /api/vet/:token enforces
// rate limits, expiry, and scope. Presigned R2 URLs expire in 5 minutes
// — if the tab sits around the vet can refresh the page to re-fetch.
export default function VetView() {
  const { token = "" } = useParams<{ token: string }>();
  const hasToken = token.length > 0;

  const query = useQuery<VetShareBundle>({
    queryKey: ["vet_share", token],
    queryFn: () => getVetShare(token),
    enabled: hasToken,
    // Presigned URLs are 5m — don't cache aggressively, but don't thrash either.
    staleTime: 60 * 1000,
    retry: false,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <header className="space-y-1 border-b border-border pb-4">
        <div className="font-display text-2xl text-primary">
          Mane Line · Vet View
        </div>
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Shared record (read-only)
        </div>
      </header>

      {!hasToken ? (
        <ErrorCard
          title="Link is missing its access code"
          body="Ask the horse owner to re-share the record."
        />
      ) : query.isLoading ? (
        <LoadingSkeleton />
      ) : query.isError ? (
        <ErrorFromCode error={query.error as Error} />
      ) : query.data ? (
        <Bundle data={query.data} />
      ) : null}
    </main>
  );
}

function Bundle({ data }: { data: VetShareBundle }) {
  const { share, animal, records, media } = data;
  const expires = new Date(share.expires_at);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>{animal.barn_name}</span>
            <Badge variant="secondary">
              {cap(animal.species)}
              {animal.year_born ? ` · ${animal.year_born}` : ""}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 text-sm">
          <Detail label="Breed" value={animal.breed ?? "—"} />
          <Detail label="Sex" value={animal.sex ? cap(animal.sex) : "—"} />
          <Detail label="Discipline" value={animal.discipline ?? "—"} />
          <Detail
            label="Link expires"
            value={expires.toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          />
        </CardContent>
      </Card>

      {share.scope.records && (
        <Card>
          <CardHeader>
            <CardTitle>Records</CardTitle>
          </CardHeader>
          <CardContent>
            {records.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No records on file in the last 12 months.
              </p>
            ) : (
              <ul className="space-y-2">
                {records.map((r) => (
                  <RecordRow key={r.id} record={r} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      {share.scope.media && (
        <Card>
          <CardHeader>
            <CardTitle>Photos &amp; videos</CardTitle>
          </CardHeader>
          <CardContent>
            {media.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No photos or videos on file.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {media.map((m) => (
                  <MediaTile key={m.id} item={m} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Separator />

      <p className="text-xs text-muted-foreground">
        This view is a snapshot shared by the owner. It is read-only and the
        link may be revoked at any time.
      </p>
    </>
  );
}

function RecordRow({
  record,
}: {
  record: VetShareBundle["records"][number];
}) {
  const subtitleBits = [
    record.issued_on && `Issued ${fmtDate(record.issued_on)}`,
    record.expires_on && `Expires ${fmtDate(record.expires_on)}`,
    record.issuing_provider,
  ].filter(Boolean);

  return (
    <li className="flex items-start justify-between gap-3 rounded-md border border-border bg-card p-3">
      <div className="flex min-w-0 items-start gap-2">
        <FileText size={16} className="mt-0.5 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {cap(record.record_type)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {subtitleBits.length > 0 ? subtitleBits.join(" · ") : "No dates"}
          </p>
          {record.notes && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
              {record.notes}
            </p>
          )}
        </div>
      </div>
      {record.file?.url ? (
        <Button asChild size="sm" variant="outline">
          <a href={record.file.url} target="_blank" rel="noopener noreferrer">
            <Download size={14} />
            Download
          </a>
        </Button>
      ) : (
        <span className="text-xs text-muted-foreground">File unavailable</span>
      )}
    </li>
  );
}

function MediaTile({
  item,
}: {
  item: VetShareBundle["media"][number];
}) {
  const isPhoto = item.kind === "photo";
  return (
    <li className="overflow-hidden rounded-md border border-border bg-card">
      {item.file?.url ? (
        isPhoto ? (
          <a href={item.file.url} target="_blank" rel="noopener noreferrer">
            <img
              src={item.file.url}
              alt={item.caption ?? "Animal photo"}
              className="h-32 w-full object-cover"
              loading="lazy"
            />
          </a>
        ) : (
          <div className="flex h-32 items-center justify-center bg-muted/40">
            <Button asChild size="sm" variant="outline">
              <a href={item.file.url} target="_blank" rel="noopener noreferrer">
                <Video size={14} />
                Play
              </a>
            </Button>
          </div>
        )
      ) : (
        <div className="flex h-32 items-center justify-center bg-muted/40 text-muted-foreground">
          <ImageIcon size={20} />
        </div>
      )}
      {item.caption && (
        <p className="truncate px-2 py-1 text-xs text-muted-foreground">
          {item.caption}
        </p>
      )}
    </li>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="text-foreground">{value}</p>
    </div>
  );
}

function ErrorFromCode({ error }: { error: Error }) {
  const code = (error as Error & { code?: string }).code;
  if (code === "revoked") {
    return (
      <ErrorCard
        title="This link has been revoked"
        body="The horse owner has revoked access. Ask them to send a new link."
      />
    );
  }
  if (code === "expired") {
    return (
      <ErrorCard
        title="This link has expired"
        body="Ask the horse owner to share a fresh link."
      />
    );
  }
  if (code === "rate_limited") {
    return (
      <ErrorCard
        title="Too many requests"
        body="Please wait a moment before reloading."
      />
    );
  }
  return (
    <ErrorCard
      title="Couldn't load this record"
      body="The link may be invalid. Double-check the URL with the horse owner."
    />
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardContent className="py-6">
        <strong className="block">{title}</strong>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </CardContent>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <>
      <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/40" />
      <div className="h-64 animate-pulse rounded-lg border border-border bg-muted/40" />
    </>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function cap(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}
