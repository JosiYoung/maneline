import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Phone,
  Send,
  ShoppingCart,
  Sparkles,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useCart } from "@/lib/cart";
import { formatPrice, type ShopProduct } from "@/lib/shop";
import { supabase } from "@/lib/supabase";
import {
  ChatRateLimitError,
  fetchProtocolsByIds,
  listTurns,
  sendMessage,
  type ChatbotRunRow,
  type HydratedProtocol,
} from "@/lib/chat";
import { CONVERSATIONS_QUERY_KEY } from "./ChatIndex";

type TurnView =
  | {
      kind: "user";
      id: string;
      text: string;
    }
  | {
      kind: "assistant";
      id: string;
      text: string;          // "" while streaming, fills in as tokens arrive
      streaming: boolean;
      fallback: "none" | "kv_keyword";
      protocolIds: string[]; // resolved lazily via fetchProtocolsByIds
      protocols?: HydratedProtocol[]; // already-hydrated (fallback path)
    }
  | {
      kind: "emergency";
      id: string;
      matchedKeyword: string;
    };

export default function ConversationView() {
  const params = useParams<{ conversationId?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isNew = !params.conversationId || params.conversationId === "new";
  const conversationId = isNew ? null : params.conversationId ?? null;

  // Historical turns, loaded once when a concrete id is in the URL.
  const history = useQuery<ChatbotRunRow[]>({
    queryKey: ["chat", "turns", conversationId ?? "new"],
    queryFn: () =>
      conversationId ? listTurns(conversationId) : Promise.resolve([]),
    enabled: !!conversationId,
    staleTime: 30 * 1000,
  });

  // Live in-session turns (appended as the user sends + model streams).
  const [liveTurns, setLiveTurns] = useState<TurnView[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [vetPhone, setVetPhone] = useState<string | null>(null);
  // Hydrated product cards keyed by chatbot_runs.id so history turns (which
  // only carry retrieved_protocol_ids) can show the same ProtocolRow as a
  // fresh liveTurn. Populated lazily once history.data arrives.
  const [hydratedById, setHydratedById] = useState<
    Record<string, HydratedProtocol[]>
  >({});
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Pick up any vet_phone the owner has on any of their animals — used
  // for the emergency banner tap-to-copy. Simple "first animal with a
  // number" rule for v1; richer per-animal selection is deferred.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("animals")
        .select("vet_phone")
        .not("vet_phone", "is", null)
        .is("archived_at", null)
        .limit(1);
      if (!cancelled) {
        const first = Array.isArray(data) && data[0] ? (data[0].vet_phone as string) : null;
        setVetPhone(first);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Merge server history with live turns. When history reloads after a
  // send (e.g., navigation to the new conversation page), drop any live
  // turns that are now represented in history to avoid duplicates.
  const allTurns: TurnView[] = useMemo(() => {
    const fromHistory: TurnView[] = (history.data ?? []).flatMap<TurnView>((r) => {
      if (r.role === "user") {
        return [{
          kind: "user",
          id: r.id,
          text: r.user_text ?? "",
        }];
      }
      if (r.role === "assistant") {
        if (r.fallback === "emergency" || r.emergency_triggered) {
          return [{
            kind: "emergency",
            id: r.id,
            matchedKeyword: "",
          }];
        }
        const protocolIds = r.retrieved_protocol_ids ?? [];
        return [{
          kind: "assistant",
          id: r.id,
          text: r.response_text ?? "",
          streaming: false,
          fallback: r.fallback === "kv_keyword" ? "kv_keyword" : "none",
          protocolIds,
          protocols: hydratedById[r.id],
        }];
      }
      return [];
    });
    return [...fromHistory, ...liveTurns];
  }, [history.data, liveTurns, hydratedById]);

  // Hydrate protocols for history assistant turns (liveTurns have their own
  // effect below). Runs once per history snapshot: anything already in
  // hydratedById is skipped, so no loop.
  useEffect(() => {
    const rows = history.data ?? [];
    const pending = rows.filter(
      (r) =>
        r.role === "assistant" &&
        (r.retrieved_protocol_ids?.length ?? 0) > 0 &&
        !hydratedById[r.id]
    );
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        pending.map(async (r) => {
          try {
            const hydrated = await fetchProtocolsByIds(
              r.retrieved_protocol_ids ?? []
            );
            return [r.id, hydrated] as const;
          } catch {
            return null;
          }
        })
      );
      if (cancelled) return;
      setHydratedById((prev) => {
        const next = { ...prev };
        for (const entry of results) {
          if (entry) next[entry[0]] = entry[1];
        }
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [history.data, hydratedById]);

  // Auto-scroll to bottom on new turn / new token.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [allTurns.length, liveTurns]);

  // Lazy-hydrate protocols for streamed assistant turns once they have ids.
  useEffect(() => {
    const target = liveTurns.find(
      (t): t is Extract<TurnView, { kind: "assistant" }> =>
        t.kind === "assistant" &&
        !t.streaming &&
        t.protocolIds.length > 0 &&
        !t.protocols
    );
    if (!target) return;
    let cancelled = false;
    (async () => {
      try {
        const hydrated = await fetchProtocolsByIds(target.protocolIds);
        if (cancelled) return;
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.kind === "assistant" && t.id === target.id
              ? { ...t, protocols: hydrated }
              : t
          )
        );
      } catch {
        /* non-fatal — ProtocolRow just won't render cards */
      }
    })();
    return () => { cancelled = true; };
  }, [liveTurns]);

  async function handleSend() {
    const msg = draft.trim();
    if (!msg || sending) return;
    setDraft("");
    setSending(true);

    // Optimistic user bubble.
    const userTempId = `u_${Date.now()}`;
    const assistantTempId = `a_${Date.now()}`;
    setLiveTurns((prev) => [
      ...prev,
      { kind: "user", id: userTempId, text: msg },
      {
        kind: "assistant",
        id: assistantTempId,
        text: "",
        streaming: true,
        fallback: "none",
        protocolIds: [],
      },
    ]);

    try {
      const result = await sendMessage(msg, conversationId ?? undefined);
      const finalConvId = result.conversation_id;

      // If this was a brand-new conversation, swap the URL to the real id
      // (no reload — keep the in-flight stream / state).
      if (isNew && finalConvId) {
        navigate(`/app/chat/${finalConvId}`, { replace: true });
      }
      qc.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });

      // Once a branch settles, the server has persisted the turn pair. Pull
      // fresh history and clear optimistic liveTurns so we don't render the
      // same user/assistant bubbles twice (once from history, once live).
      const settle = async () => {
        if (finalConvId) {
          await qc.invalidateQueries({ queryKey: ["chat", "turns", finalConvId] });
        }
        setLiveTurns([]);
      };

      if (result.kind === "emergency") {
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTempId
              ? {
                  kind: "emergency",
                  id: assistantTempId,
                  matchedKeyword: result.matched_keyword,
                }
              : t
          )
        );
        setSending(false);
        void settle();
        return;
      }

      if (result.kind === "fallback") {
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTempId && t.kind === "assistant"
              ? {
                  ...t,
                  text: result.message,
                  streaming: false,
                  fallback: "kv_keyword",
                  protocolIds: result.protocols.map((p) => p.id),
                  protocols: result.protocols,
                }
              : t
          )
        );
        setSending(false);
        void settle();
        return;
      }

      // Streaming path.
      const protocolIds = result.protocolIds;
      result.onToken((tok) => {
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTempId && t.kind === "assistant"
              ? { ...t, text: t.text + tok }
              : t
          )
        );
      });
      result.onDone(() => {
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTempId && t.kind === "assistant"
              ? { ...t, streaming: false, protocolIds }
              : t
          )
        );
        setSending(false);
        void settle();
      });
      result.onError((err) => {
        toast.error(err.message || "Chat stream ended early.");
        setLiveTurns((prev) =>
          prev.map((t) =>
            t.id === assistantTempId && t.kind === "assistant"
              ? { ...t, streaming: false }
              : t
          )
        );
        setSending(false);
      });
    } catch (err) {
      // Remove the pending assistant bubble; keep the user bubble.
      setLiveTurns((prev) => prev.filter((t) => t.id !== assistantTempId));
      if (err instanceof ChatRateLimitError) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Chat failed.");
      }
      setSending(false);
    }
  }

  return (
    <div className="flex h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-10rem)] flex-col gap-4">
      <header className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate("/app/chat")}
          className="-ml-2"
        >
          <ArrowLeft size={16} className="mr-1" />
          Chats
        </Button>
        <h1 className="font-display text-lg text-primary">
          {isNew ? "New chat" : "Chat"}
        </h1>
      </header>

      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto rounded-lg border border-border bg-muted/20 p-3"
      >
        {history.isLoading && !isNew ? (
          <TurnsSkeleton />
        ) : allTurns.length === 0 ? (
          <EmptyPrompt />
        ) : (
          allTurns.map((t) => (
            <TurnBubble
              key={t.id}
              turn={t}
              vetPhone={vetPhone}
            />
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-end gap-2"
      >
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe what's going on with your horse…"
          rows={2}
          className="min-h-[3rem] resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          disabled={sending}
        />
        <Button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="h-12 shrink-0"
        >
          <Send size={16} />
          <span className="sr-only">Send</span>
        </Button>
      </form>
    </div>
  );
}

function EmptyPrompt() {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <Sparkles size={28} strokeWidth={1.5} className="text-muted-foreground" aria-hidden />
      <p className="text-sm font-medium text-foreground">
        Tell the brain what's going on.
      </p>
      <p className="max-w-sm text-xs text-muted-foreground">
        "My mare seems off today, she isn't finishing her grain and her manure
        is loose" — the more detail, the better.
      </p>
    </div>
  );
}

function TurnBubble({
  turn,
  vetPhone,
}: {
  turn: TurnView;
  vetPhone: string | null;
}) {
  if (turn.kind === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap">{turn.text}</p>
        </div>
      </div>
    );
  }

  if (turn.kind === "emergency") {
    return (
      <div className="flex justify-start">
        <Alert variant="destructive" className="max-w-[95%]">
          <AlertTriangle size={18} />
          <AlertTitle>This sounds serious — call your vet now.</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              The Protocol Brain won't answer this one. Signs like these need
              eyes on your horse right now.
            </p>
            {vetPhone ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(vetPhone);
                  toast.success("Vet number copied.");
                }}
              >
                <Phone size={14} className="mr-1" />
                Copy vet number ({vetPhone})
              </Button>
            ) : (
              <p className="text-xs opacity-80">
                Add your vet's phone number on any animal's profile so we can
                surface it here next time.
              </p>
            )}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // assistant
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[95%] rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
        {turn.streaming && turn.text.length === 0 ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-2 w-16" />
          </div>
        ) : (
          <p className="whitespace-pre-wrap">{turn.text}</p>
        )}
        {turn.fallback === "kv_keyword" ? (
          <p className="mt-2 text-xs italic text-muted-foreground">
            Served from the keyword index — our AI brain is warming up.
          </p>
        ) : null}
      </div>
      {turn.protocols && turn.protocols.length > 0 ? (
        <ProtocolRow protocols={turn.protocols} />
      ) : null}
    </div>
  );
}

function ProtocolRow({ protocols }: { protocols: HydratedProtocol[] }) {
  return (
    <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
      {protocols.map((p) => (
        <ProtocolCard key={p.id} protocol={p} />
      ))}
    </div>
  );
}

function ProtocolCard({ protocol }: { protocol: HydratedProtocol }) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {protocol.number ? `Protocol ${protocol.number} — ` : ""}
          {protocol.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-xs">
        {protocol.description ? (
          <p className="line-clamp-3 text-muted-foreground">
            {protocol.description}
          </p>
        ) : null}
        {protocol.products.length > 0 ? (
          <div className="space-y-2">
            {protocol.products.map((pr) => (
              <ProductRow key={pr.shopify_variant_id} product={pr} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProductRow({ product }: { product: ShopProduct }) {
  const { addItem } = useCart();
  const outOfStock = !product.available;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-background/50 p-2"
      )}
    >
      <Link
        to={`/app/shop/${encodeURIComponent(product.handle)}`}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="line-clamp-1 text-xs font-medium text-foreground">
            {product.title}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatPrice(product.price_cents)}
          </p>
        </div>
      </Link>
      <Button
        size="sm"
        variant="secondary"
        disabled={outOfStock}
        onClick={() => {
          addItem(product.shopify_variant_id, 1);
          toast.success(`${product.title} added to cart.`);
        }}
      >
        <ShoppingCart size={14} className="mr-1" />
        {outOfStock ? "Out" : "Add"}
      </Button>
    </div>
  );
}

function TurnsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Skeleton className="h-8 w-40" /></div>
      <div className="flex justify-start"><Skeleton className="h-16 w-72" /></div>
      <div className="flex justify-end"><Skeleton className="h-8 w-32" /></div>
    </div>
  );
}
