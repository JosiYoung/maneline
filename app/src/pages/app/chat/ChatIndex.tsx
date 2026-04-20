import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  listConversations,
  type ConversationRow,
} from "@/lib/chat";

export const CONVERSATIONS_QUERY_KEY = ["chat", "conversations"] as const;

// ChatIndex — /app/chat
//
// Lists the owner's prior conversations (RLS scopes to auth.uid())
// and exposes a "Start new" CTA that routes to /app/chat/new. The
// ConversationView page handles both :conversationId and the "new"
// sentinel (create-on-first-send).
export default function ChatIndex() {
  const navigate = useNavigate();
  const query = useQuery<ConversationRow[]>({
    queryKey: CONVERSATIONS_QUERY_KEY,
    queryFn: listConversations,
    staleTime: 30 * 1000,
  });

  const rows = query.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl text-primary">Protocol Brain</h1>
          <p className="text-sm text-muted-foreground">
            Ask about your horse. Answers draw from Silver Lining Herbs
            protocols — not a substitute for your vet.
          </p>
        </div>
        <Button
          onClick={() => navigate("/app/chat/new")}
          className="shrink-0"
        >
          <Plus size={16} className="mr-1" />
          Start new
        </Button>
      </header>

      {query.isLoading ? (
        <ConversationsSkeleton />
      ) : query.isError ? (
        <Card>
          <CardHeader>
            <CardTitle>Couldn't load your chats</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {query.error instanceof Error
              ? query.error.message
              : "Unknown error."}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState onStart={() => navigate("/app/chat/new")} />
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id}>
              <Link
                to={`/app/chat/${c.id}`}
                className="block rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="line-clamp-1 text-sm font-medium text-foreground">
                    {c.title?.trim() || "Untitled chat"}
                  </p>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatRelative(c.updated_at)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <MessageCircle
          size={36}
          strokeWidth={1.5}
          className="text-muted-foreground"
          aria-hidden
        />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            No chats yet
          </p>
          <p className="text-xs text-muted-foreground">
            Start one by asking about your horse's latest quirk or symptom.
          </p>
        </div>
        <Button onClick={onStart} size="sm">
          <Plus size={14} className="mr-1" />
          Start new
        </Button>
      </CardContent>
    </Card>
  );
}

function ConversationsSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <li key={i}>
          <Skeleton className="h-12 w-full" />
        </li>
      ))}
    </ul>
  );
}

// Minimal "x min ago" without pulling in date-fns.
function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(then).toLocaleDateString();
}
