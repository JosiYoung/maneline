import { supabase } from "./supabase";
import type { ShopProduct } from "./shop";

// Chat data layer — Phase 4.4.
//
// The SPA talks to /api/chat (Worker) for the streamed RAG loop and to
// Supabase (via supabase-js + RLS) for the prior-conversation list.
// Phase 4.6 will extend sendMessage to thread `conversation_id` through
// to /api/shop/checkout so in-chat purchases stamp orders.source='chat'.

export interface ConversationRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatbotRunRow {
  id: string;
  conversation_id: string;
  turn_index: number;
  role: "user" | "assistant" | "system";
  user_text: string | null;
  response_text: string | null;
  retrieved_protocol_ids: string[] | null;
  fallback: "none" | "kv_keyword" | "emergency";
  emergency_triggered: boolean;
  model_id: string | null;
  latency_ms: number | null;
  created_at: string;
}

export interface HydratedProtocol {
  id: string;
  number: string | null;
  name: string;
  description: string | null;
  use_case: string | null;
  body_md: string | null;
  category: string | null;
  products: ShopProduct[];
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return { Authorization: `Bearer ${token}` };
}

/* =============================================================
   Supabase-direct reads (RLS scopes to owner)
   ============================================================= */

export async function listConversations(): Promise<ConversationRow[]> {
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as ConversationRow[];
}

export async function listTurns(conversationId: string): Promise<ChatbotRunRow[]> {
  const { data, error } = await supabase
    .from("chatbot_runs")
    .select(
      "id, conversation_id, turn_index, role, user_text, response_text, retrieved_protocol_ids, fallback, emergency_triggered, model_id, latency_ms, created_at"
    )
    .eq("conversation_id", conversationId)
    .order("turn_index", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ChatbotRunRow[];
}

/* =============================================================
   /api/chat — dispatch + stream handling
   ============================================================= */

export interface ChatEmergencyResult {
  kind: "emergency";
  conversation_id: string;
  matched_keyword: string;
  remaining: number;
}

export interface ChatFallbackResult {
  kind: "fallback";
  conversation_id: string;
  message: string;
  protocols: HydratedProtocol[];
  remaining: number;
}

export interface ChatStreamResult {
  kind: "stream";
  conversation_id: string;
  protocolIds: string[];
  model: string | null;
  remaining: number;
  onToken: (cb: (token: string) => void) => void;
  onDone:  (cb: (fullText: string) => void) => void;
  onError: (cb: (err: Error) => void) => void;
  abort:   () => void;
}

export type SendMessageResult =
  | ChatEmergencyResult
  | ChatFallbackResult
  | ChatStreamResult;

/**
 * Parse a Workers AI SSE line. Same shape the Worker tees through:
 *   data: {"response":"...","tool_calls":[],"p":"..."}
 *   data: [DONE]
 */
function parseSseDelta(line: string): string {
  const t = line.trimStart();
  if (!t.startsWith("data:")) return "";
  const payload = t.slice(5).trim();
  if (!payload || payload === "[DONE]") return "";
  try {
    const obj = JSON.parse(payload) as { response?: unknown };
    return typeof obj.response === "string" ? obj.response : "";
  } catch {
    return "";
  }
}

/**
 * Send a chat message. Returns a discriminated-union result:
 *   - emergency: short-circuit, no model call
 *   - fallback:  AI down, keyword match with canned copy
 *   - stream:    Workers AI SSE; subscribe to onToken / onDone / onError
 */
export async function sendMessage(
  message: string,
  conversationId?: string
): Promise<SendMessageResult> {
  const headers = {
    ...(await authHeader()),
    "content-type": "application/json",
    accept: "text/event-stream",
  };

  const controller = new AbortController();
  const res = await fetch("/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    }),
    signal: controller.signal,
  });

  if (res.status === 429) {
    throw new ChatRateLimitError();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body && typeof body.error === "string" && body.error) ||
        `Chat failed (${res.status})`
    );
  }

  const contentType = res.headers.get("content-type") ?? "";

  // Non-streaming: either emergency or AI-failure fallback.
  if (contentType.includes("application/json")) {
    const body = (await res.json()) as {
      emergency?: boolean;
      matched_keyword?: string;
      fallback?: string;
      message?: string;
      protocols?: HydratedProtocol[];
      conversation_id: string;
      remaining: number;
    };
    if (body.emergency) {
      return {
        kind: "emergency",
        conversation_id: body.conversation_id,
        matched_keyword: body.matched_keyword ?? "",
        remaining: body.remaining,
      };
    }
    if (body.fallback === "kv_keyword") {
      return {
        kind: "fallback",
        conversation_id: body.conversation_id,
        message: body.message ?? "",
        protocols: body.protocols ?? [],
        remaining: body.remaining,
      };
    }
    throw new Error("Unrecognized chat response.");
  }

  // Streaming path.
  const convId = res.headers.get("x-conversation-id") ?? "";
  const model  = res.headers.get("x-model");
  const remainingHdr = res.headers.get("x-rate-limit-remaining");
  const remaining = remainingHdr ? Number(remainingHdr) : 0;
  const protocolIdsRaw = res.headers.get("x-protocol-ids") ?? "";
  const protocolIds = protocolIdsRaw
    ? protocolIdsRaw.split(",").filter(Boolean)
    : [];

  const tokenListeners: Array<(t: string) => void> = [];
  const doneListeners:  Array<(t: string) => void> = [];
  const errorListeners: Array<(e: Error) => void> = [];
  let accumulated = "";

  (async () => {
    if (!res.body) {
      errorListeners.forEach((cb) => cb(new Error("No stream body.")));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          const delta = parseSseDelta(line);
          if (delta) {
            accumulated += delta;
            tokenListeners.forEach((cb) => cb(delta));
          }
        }
      }
      if (buf) {
        const delta = parseSseDelta(buf);
        if (delta) {
          accumulated += delta;
          tokenListeners.forEach((cb) => cb(delta));
        }
      }
      doneListeners.forEach((cb) => cb(accumulated));
    } catch (err) {
      errorListeners.forEach((cb) =>
        cb(err instanceof Error ? err : new Error(String(err)))
      );
    }
  })();

  return {
    kind: "stream",
    conversation_id: convId,
    protocolIds,
    model,
    remaining,
    onToken: (cb) => { tokenListeners.push(cb); },
    onDone:  (cb) => { doneListeners.push(cb); },
    onError: (cb) => { errorListeners.push(cb); },
    abort:   () => controller.abort(),
  };
}

export class ChatRateLimitError extends Error {
  constructor() {
    super("Daily chat limit reached — resets at midnight UTC.");
    this.name = "ChatRateLimitError";
  }
}

/**
 * Protocol hydration for historical turns loaded from Supabase.
 * When the /api/chat stream completes live the protocol bodies are
 * already embedded in the response headers / fallback payload. For a
 * cold-loaded conversation we re-hit the Worker so linked products
 * resolve server-side (same query hydrateProtocols uses).
 *
 * Cheap shortcut: inline a service_role-free RLS read.
 */
export async function fetchProtocolsByIds(
  ids: string[]
): Promise<HydratedProtocol[]> {
  if (ids.length === 0) return [];

  const { data: protos, error } = await supabase
    .from("protocols")
    .select(
      "id, number, name, description, use_case, body_md, category, linked_sku_codes"
    )
    .in("id", ids);
  if (error) throw new Error(error.message);

  const allCodes = Array.from(
    new Set((protos ?? []).flatMap((p) => (p.linked_sku_codes ?? []) as string[]))
  );
  let productsBySku: Record<string, ShopProduct> = {};
  if (allCodes.length > 0) {
    const { data: prods, error: pErr } = await supabase
      .from("products")
      .select(
        "id, shopify_variant_id, handle, sku, title, description, image_url, price_cents, currency, category, inventory_qty, available, last_synced_at"
      )
      .in("sku", allCodes)
      .is("archived_at", null);
    if (pErr) throw new Error(pErr.message);
    for (const p of (prods ?? []) as ShopProduct[]) {
      productsBySku[p.sku] = p;
    }
  }

  // Preserve the retrieval order from `ids`.
  const byId = new Map<string, HydratedProtocol>();
  for (const p of protos ?? []) {
    byId.set(p.id as string, {
      id: p.id as string,
      number: (p.number as string | null) ?? null,
      name: p.name as string,
      description: (p.description as string | null) ?? null,
      use_case: (p.use_case as string | null) ?? null,
      body_md: (p.body_md as string | null) ?? null,
      category: (p.category as string | null) ?? null,
      products: ((p.linked_sku_codes ?? []) as string[])
        .map((code) => productsBySku[code])
        .filter(Boolean),
    });
  }
  return ids.map((id) => byId.get(id)).filter(Boolean) as HydratedProtocol[];
}
