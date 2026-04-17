/**
 * Workers AI integration — Phase 0 PLACEHOLDER.
 *
 * This is the "Protocol Brain" surface: symptom classification, text
 * embedding, and LLM chat completion. The binding `env.AI` is declared
 * in wrangler.toml today so the skeleton compiles, but nothing below
 * actually calls it — every function returns deterministic mock output
 * that the UI can render against.
 *
 * When Phase 4 lands, these wrappers move to the Worker (or a Worker
 * route) so the `AI` binding is in scope, and the SPA calls them
 * through a /api/* endpoint instead of importing them directly. The
 * mock shapes below lock the response contract so the UI doesn't
 * change when we flip.
 *
 * Default models once live (subject to model-catalog review):
 *   classifySymptom → @cf/meta/llama-3.1-8b-instruct (JSON-mode prompt)
 *   embedText       → @cf/baai/bge-base-en-v1.5     (768-dim, cosine)
 *   chatComplete    → @cf/meta/llama-3.1-70b-instruct (or anthropic via bind)
 *
 * Flip plan: see docs/INTEGRATIONS.md §Workers AI.
 */

export interface SymptomClassification {
  labels: string[];          // e.g. ["gut", "ulcer_risk"]
  confidence: number;        // 0..1
  model: string;             // which model produced this
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompleteArgs {
  system: string;
  messages: ChatMessage[];
}

export interface ChatCompleteResult {
  content: string;
  model: string;
  finish_reason: 'stop' | 'length' | 'tool_call' | 'mock';
}

// TODO(Phase 4): replace mock with env.AI.run('@cf/meta/llama-3.1-...')
// called from a Worker route. See FEATURE_MAP §4.4 (Protocol Brain).
export async function classifySymptom(
  text: string
): Promise<SymptomClassification> {
  // Cheap keyword heuristic so demo screens aren't totally static.
  const lower = text.toLowerCase();
  const labels: string[] = [];
  if (/ulcer|gut|colic|gastric/.test(lower)) labels.push('gut');
  if (/hoof|lamin|abscess/.test(lower))      labels.push('hoof');
  if (/lame|limp|soundness/.test(lower))     labels.push('soundness');
  if (/cough|nasal|wind/.test(lower))        labels.push('respiratory');
  if (labels.length === 0) labels.push('general');

  return {
    labels,
    confidence: 0.42,   // flag value so humans can tell it's mock
    model: 'mock/keyword-v0',
  };
}

// TODO(Phase 4): replace mock with env.AI.run('@cf/baai/bge-base-en-v1.5').
// See FEATURE_MAP §4.4 and the Vectorize setup in wrangler.toml.
export async function embedText(text: string): Promise<number[]> {
  // Return a deterministic 768-long pseudo-embedding so Vectorize
  // upserts don't choke on shape during integration tests. Values
  // are derived from the input so identical text → identical vector.
  const dims = 768;
  const out = new Array<number>(dims);
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) {
    seed ^= text.charCodeAt(i);
    seed = (seed * 16777619) >>> 0;
  }
  for (let i = 0; i < dims; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    // Map to roughly [-1, 1].
    out[i] = (seed / 0xffffffff) * 2 - 1;
  }
  return out;
}

// TODO(Phase 4): replace mock with env.AI.run('@cf/meta/llama-3.1-70b-instruct')
// OR a routed call to an external Claude/OpenAI model via an AI Gateway
// binding. See FEATURE_MAP §4.4.
export async function chatComplete(
  args: ChatCompleteArgs
): Promise<ChatCompleteResult> {
  const lastUser = [...args.messages]
    .reverse()
    .find((m) => m.role === 'user');
  const echo = lastUser?.content.slice(0, 120) ?? '(no user turn)';
  return {
    content:
      `Mock response — the real Protocol Brain will answer in Phase 4. ` +
      `Your last question was: "${echo}"`,
    model: 'mock/echo-v0',
    finish_reason: 'mock',
  };
}
