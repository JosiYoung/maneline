/**
 * Mane Line — Workers AI + Vectorize helpers (Phase 4).
 *
 * Server-side wrappers used by the /api/ai/embed,
 * /api/protocols/embed-index, and (Phase 4.3) /api/chat routes.
 *
 * Bindings expected (wrangler.toml):
 *   env.AI                     — [ai] binding
 *   env.VECTORIZE_PROTOCOLS    — [[vectorize]] binding, 768-dim cosine
 *
 * Model choices (locked per docs/phase-4-plan.md §4 decision 1):
 *   EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'  → 768 dims
 *   CHAT_MODEL  = '@cf/meta/llama-3.3-70b-instruct'
 *
 * Never import this module from the SPA — the AI binding only
 * exists inside the Worker isolate.
 */

export const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
export const CHAT_MODEL  = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const EMBED_DIMS  = 768;

/**
 * Embed a single piece of text and return the raw 768-dim vector.
 *
 * Workers AI returns `{ shape: [n, 768], data: number[n][] }` for
 * batched input — we always send one string at a time here to keep
 * error handling simple.
 */
export async function embedText(env, text) {
  if (!env?.AI) {
    throw new Error('ai_binding_missing');
  }
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (!trimmed) {
    throw new Error('embed_text_empty');
  }

  const result = await env.AI.run(EMBED_MODEL, { text: [trimmed] });
  const vec = Array.isArray(result?.data) ? result.data[0] : null;
  if (!Array.isArray(vec) || vec.length !== EMBED_DIMS) {
    throw new Error(
      `embed_bad_shape:${Array.isArray(vec) ? vec.length : 'null'}`
    );
  }
  return vec;
}

/**
 * Upsert a single protocol vector into the maneline-protocols index.
 * `id` must be the protocol row's uuid (stringified); metadata is
 * surfaced back on query() so /api/chat can hydrate from Supabase
 * without extra round-trips when it doesn't need the full body.
 */
export async function upsertProtocolVector(env, id, values, metadata) {
  if (!env?.VECTORIZE_PROTOCOLS) {
    throw new Error('vectorize_binding_missing');
  }
  if (!id || typeof id !== 'string') {
    throw new Error('upsert_bad_id');
  }
  if (!Array.isArray(values) || values.length !== EMBED_DIMS) {
    throw new Error('upsert_bad_values');
  }

  const res = await env.VECTORIZE_PROTOCOLS.upsert([
    { id, values, metadata: metadata ?? {} },
  ]);
  return { mutationId: res?.mutationId ?? null, count: res?.count ?? 1 };
}

/**
 * Query the protocol index for the top-K nearest neighbours to a
 * query vector. Returns the raw matches — caller decides which
 * protocol_ids to hydrate from Supabase.
 *
 * Used by Phase 4.3 /api/chat; kept here so embed + query live in
 * the same module.
 */
export async function queryProtocolVectors(env, vector, topK = 5) {
  if (!env?.VECTORIZE_PROTOCOLS) {
    throw new Error('vectorize_binding_missing');
  }
  if (!Array.isArray(vector) || vector.length !== EMBED_DIMS) {
    throw new Error('query_bad_vector');
  }
  const res = await env.VECTORIZE_PROTOCOLS.query(vector, {
    topK,
    returnMetadata: 'all',
  });
  return Array.isArray(res?.matches) ? res.matches : [];
}
