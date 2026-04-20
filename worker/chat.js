/**
 * Mane Line — /api/chat RAG + streaming helpers (Phase 4.3).
 *
 * Pure library code (no Response building) used by handleChat() in
 * worker.js. Split out so the handler there stays scannable.
 *
 * Bindings expected on env:
 *   AI                    — Workers AI ([ai] binding)
 *   VECTORIZE_PROTOCOLS   — Vectorize index (768 / cosine)
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   ML_RL                 — KV binding for the daily rate-limit counter
 */

import {
  CHAT_MODEL,
  embedText,
  queryProtocolVectors,
} from './workers-ai.js';
import { matchEmergencyKeyword } from './emergency-keywords.js';

export const RATE_LIMIT_DAILY = 30;
export const HISTORY_TURNS    = 8;
export const RAG_TOP_K        = 5;
export const AI_TIMEOUT_MS    = 8000;
export const CHAT_TEMPERATURE = 0.2;

/**
 * Safety-framed system prompt. Intentionally verbose + explicit.
 * The Worker rebuilds context on every turn from chatbot_runs, so
 * prompt drift can't creep in from a long-open tab.
 */
export const SYSTEM_PROMPT = [
  'You are the Mane Line Protocol Brain — a supportive assistant for horse owners in the Silver Lining Herbs community.',
  '',
  'Your job: help the owner recognise what their horse might need and point them to a Silver Lining protocol when one fits, always framed as "owners in similar situations have used…" — never as a diagnosis.',
  '',
  'Strict rules:',
  '1. You are NOT a veterinarian. Never prescribe, diagnose, or give dosages outside what the Silver Lining protocol documents specify.',
  '2. For any sign of acute distress (colic, choke, bleeding, seizure, inability to stand, foal not nursing, etc.) respond ONLY with "This sounds serious — call your vet now." Do not recommend supplements in that case.',
  '3. Ground every recommendation in the <retrieved_protocols> block. If nothing there fits, say so plainly and suggest the owner check with their vet — do not invent a protocol.',
  '4. Keep replies short (under 120 words). Plain language. No markdown headings.',
  '5. When you reference a protocol, use its number and name exactly as given (e.g., "Protocol #17 Colic Eaz"). Never invent numbers.',
  '6. Close with one concrete next step — "Try X for a week and watch for Y" — unless rule 2 applied.',
].join('\n');

/* =============================================================
   Emergency short-circuit
   ============================================================= */

export function detectEmergency(message) {
  return matchEmergencyKeyword(message);
}

/* =============================================================
   Rate limit — 30 msg/user/day, key per calendar day (UTC)
   ============================================================= */

function todayUtcString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function incrementDailyRateLimit(env, userId) {
  if (!env.ML_RL) {
    return { ok: true, remaining: RATE_LIMIT_DAILY };
  }
  const key = `chat:rate:${userId}:${todayUtcString()}`;
  const raw = await env.ML_RL.get(key);
  const parsed = raw ? Number(raw) : 0;
  const next = Number.isFinite(parsed) ? parsed + 1 : 1;

  // 48h TTL — the "next midnight UTC" reset is soft; key name rolls
  // over on date anyway so keeping yesterday's bucket around for an
  // extra day is harmless and survives clock-skew races.
  await env.ML_RL.put(key, String(next), { expirationTtl: 60 * 60 * 48 });

  return {
    ok: next <= RATE_LIMIT_DAILY,
    remaining: Math.max(0, RATE_LIMIT_DAILY - next),
    count: next,
  };
}

/* =============================================================
   Supabase REST helpers (service_role; all chat writes are admin)
   ============================================================= */

async function sbFetch(env, path, init = {}) {
  const headers = {
    'content-type': 'application/json',
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    ...(init.headers || {}),
  };
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

async function sbJson(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : null; } catch { return null; }
}

/* =============================================================
   Conversation + turn bookkeeping
   ============================================================= */

export async function getOrCreateConversation(env, userId, conversationId, firstMessage) {
  if (conversationId) {
    // Verify the caller owns the conversation (service-role bypasses RLS,
    // so we enforce the join here).
    const res = await sbFetch(
      env,
      `conversations?id=eq.${encodeURIComponent(conversationId)}&owner_id=eq.${encodeURIComponent(userId)}&select=id,title&limit=1`
    );
    const rows = await sbJson(res);
    if (Array.isArray(rows) && rows[0]?.id) {
      return { id: rows[0].id, created: false };
    }
    // Fall through — bad id, create a new one instead of 404ing mid-turn.
  }

  const title = (firstMessage || '').trim().slice(0, 60) || 'New chat';
  const res = await sbFetch(env, 'conversations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{ owner_id: userId, title }]),
  });
  const rows = await sbJson(res);
  if (!Array.isArray(rows) || !rows[0]?.id) {
    throw new Error(`conversation_insert_failed:${res.status}`);
  }
  return { id: rows[0].id, created: true };
}

export async function nextTurnIndex(env, conversationId) {
  const res = await sbFetch(
    env,
    `chatbot_runs?conversation_id=eq.${encodeURIComponent(conversationId)}&select=turn_index&order=turn_index.desc&limit=1`
  );
  const rows = await sbJson(res);
  const max = Array.isArray(rows) && rows[0] ? Number(rows[0].turn_index) : -1;
  return Number.isFinite(max) ? max + 1 : 0;
}

export async function getRecentHistory(env, conversationId, limit = HISTORY_TURNS) {
  const res = await sbFetch(
    env,
    `chatbot_runs?conversation_id=eq.${encodeURIComponent(conversationId)}&role=in.(user,assistant)&select=role,user_text,response_text,turn_index&order=turn_index.desc&limit=${limit}`
  );
  const rows = await sbJson(res);
  if (!Array.isArray(rows)) return [];
  // Chronological order back to the caller.
  return rows.reverse().map((r) => ({
    role: r.role,
    content: r.role === 'user' ? (r.user_text ?? '') : (r.response_text ?? ''),
  })).filter((m) => m.content.length > 0);
}

export async function insertChatbotRun(env, row) {
  const res = await sbFetch(env, 'chatbot_runs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([row]),
  });
  return res.ok;
}

export async function touchConversation(env, conversationId) {
  await sbFetch(
    env,
    `conversations?id=eq.${encodeURIComponent(conversationId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
    }
  );
}

/* =============================================================
   Protocol hydration — fetch full rows + linked products for the
   top-K Vectorize matches so the model sees titles/bodies and the
   client can render ProductCards inline.
   ============================================================= */

export async function hydrateProtocols(env, protocolIds) {
  if (!Array.isArray(protocolIds) || protocolIds.length === 0) return [];

  const idsList = protocolIds.map(encodeURIComponent).join(',');
  const res = await sbFetch(
    env,
    `protocols?id=in.(${idsList})&select=id,number,name,description,use_case,body_md,category,linked_sku_codes,product_id`
  );
  const rows = await sbJson(res);
  if (!Array.isArray(rows)) return [];

  // Hydrate any linked_sku_codes into product rows (Phase 3 products).
  const allCodes = Array.from(
    new Set(
      rows.flatMap((r) => Array.isArray(r.linked_sku_codes) ? r.linked_sku_codes : [])
    )
  );
  let productsBySku = {};
  if (allCodes.length > 0) {
    const codesList = allCodes.map(encodeURIComponent).join(',');
    const pRes = await sbFetch(
      env,
      // Full ShopProduct shape so the client can reuse <ProductCard/> +
      // useCart.addItem(shopify_variant_id) without a second lookup.
      `products?sku=in.(${codesList})&archived_at=is.null&select=id,shopify_variant_id,handle,sku,title,description,image_url,price_cents,currency,category,inventory_qty,available,last_synced_at`
    );
    const pRows = await sbJson(pRes);
    if (Array.isArray(pRows)) {
      for (const p of pRows) productsBySku[p.sku] = p;
    }
  }

  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    name: r.name,
    description: r.description,
    use_case: r.use_case,
    body_md: r.body_md,
    category: r.category,
    products: (r.linked_sku_codes ?? [])
      .map((code) => productsBySku[code])
      .filter(Boolean),
  }));
}

/* =============================================================
   Message composition
   ============================================================= */

export function composeMessages(retrieved, history, userMessage) {
  const retrievedBlock = retrieved.length === 0
    ? 'No protocols retrieved for this query.'
    : retrieved.map((p, i) => {
        const header = p.number ? `Protocol ${p.number} — ${p.name}` : p.name;
        const body = [p.description, p.use_case, p.body_md]
          .filter(Boolean)
          .join('\n');
        return `[${i + 1}] ${header}\n${body}`;
      }).join('\n\n');

  const systemWithContext = [
    SYSTEM_PROMPT,
    '',
    '<retrieved_protocols>',
    retrievedBlock,
    '</retrieved_protocols>',
  ].join('\n');

  return [
    { role: 'system', content: systemWithContext },
    ...history,
    { role: 'user', content: userMessage },
  ];
}

/* =============================================================
   KV-keyword fallback — used when Workers AI errors or times out.
   Matches message tokens against protocols.keywords (and name +
   number as a bonus) via a service-role SELECT; returns top-3 by
   match count.
   ============================================================= */

export async function kvKeywordFallback(env, message) {
  const res = await sbFetch(
    env,
    `protocols?published=eq.true&archived_at=is.null&select=id,number,name,description,keywords,linked_sku_codes&limit=200`
  );
  const rows = await sbJson(res);
  if (!Array.isArray(rows) || rows.length === 0) return [];

  const tokens = (message || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

  const scored = rows.map((r) => {
    const bag = [
      ...(Array.isArray(r.keywords) ? r.keywords : []),
      r.number || '',
      r.name || '',
      r.description || '',
    ].join(' ').toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (bag.includes(t)) score += 1;
    }
    return { row: r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored
    .filter((s) => s.score > 0)
    .slice(0, 3)
    .map((s) => s.row);
}

export const FALLBACK_CANNED_MESSAGE =
  "Our brain is warming up — here's what usually helps in situations like yours. If symptoms are sharp or getting worse, call your vet.";

/* =============================================================
   Streaming — run Workers AI with an 8s first-token timeout, then
   return a tee'd stream: one branch forwards to the client as SSE,
   the other accumulates text for the chatbot_runs audit row.
   ============================================================= */

export async function runChatModelWithTimeout(env, messages) {
  // env.AI.run's third-arg options don't reliably support AbortSignal in
  // Workers — race the promise against a timer instead. The timeout is
  // "start of stream", not full-response; once we have the ReadableStream
  // it can take as long as it needs to finish.
  const runPromise = env.AI.run(
    CHAT_MODEL,
    { messages, stream: true, temperature: CHAT_TEMPERATURE },
  );

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`ai_timeout_${AI_TIMEOUT_MS}ms`)),
      AI_TIMEOUT_MS
    );
  });

  try {
    const stream = await Promise.race([runPromise, timeoutPromise]);
    clearTimeout(timer);
    return stream;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Parse a Workers AI SSE chunk and extract the delta text. The upstream
 * format is `data: {"response":"..."}` lines separated by blank lines,
 * terminated by `data: [DONE]`. Returns '' for non-data lines / [DONE].
 */
export function extractSseDelta(line) {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith('data:')) return '';
  const payload = trimmed.slice(5).trim();
  if (!payload || payload === '[DONE]') return '';
  try {
    const obj = JSON.parse(payload);
    return typeof obj?.response === 'string' ? obj.response : '';
  } catch {
    return '';
  }
}

/**
 * Tee a ReadableStream so the caller can forward one branch to the
 * client while the returned Promise resolves to the accumulated text
 * from the other branch. Promise resolves after the stream closes.
 */
export function teeAndAccumulate(stream) {
  const [clientBranch, auditBranch] = stream.tee();
  const accumulated = (async () => {
    const reader = auditBranch.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        text += extractSseDelta(line);
      }
    }
    if (buf) text += extractSseDelta(buf);
    return text;
  })();
  return { clientBranch, accumulated };
}
