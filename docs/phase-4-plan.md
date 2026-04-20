# Mane Line — Phase 4 (Protocol Brain — Workers AI + Vectorize) Build Plan

**Owner:** Cedric / OAG
**Window:** Week of 2026-05-11 (per feature map §6 row Phase 4)
**Feature map reference:** `MANELINE-PRODUCT-FEATURE-MAP.md` §4.6.3 (Protocol Brain architecture), §6 row Phase 4, §1 bullet 11 (promotion to P0), `wrangler.toml` lines 150–167 (`[ai]` + `[[vectorize]]` bindings already declared from Phase 0).
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.4 (shadcn Card / Dialog patterns), §10 (error/loading states), Phase 3 `ProductCard` reused for in-chat SKU cards.
**Law references:** `playbooks/OAG_ARCHITECTURE_LAWS.md` §2 (admin reads via Worker + service_role), §4 (triple redundancy — L2 client-owned GitHub), §7 (RLS on every table day one), §8 (archive-never-delete — every chat turn is an audit row).
**Integrations reference:** `docs/INTEGRATIONS.md` §Workers AI.

---

## 0. What Phase 4 is, and what it isn't

**In scope (derived from feature map §4.6.3 + §6 Phase 4 row + §1 bullet 11):**

| # | Feature | Success criterion |
|---|---|---|
| 1 | **`protocols` table** — canonical numbered Silver Lining protocols (e.g., "#17 Colic Eaz → Protocol 17: Colic Recovery") with linked SKUs | Migration applied; 5–10 seed rows loaded from SLH-provided CSV; RLS policies (anon read for published + owner/trainer read; admin-only write via service_role) |
| 2 | **`maneline-protocols` Vectorize index** created + populated | `npx wrangler vectorize create maneline-protocols --dimensions=768 --metric=cosine` run once; Edge Function `seed-protocol-embeddings` embeds every `protocols` row where `embed_status='pending'` via `@cf/baai/bge-base-en-v1.5` and upserts vectors with metadata `{ protocol_id, sku_ids, category }` |
| 3 | **`POST /api/chat` Worker route** — RAG loop | Authenticated owner POSTs `{ message, conversation_id? }`; Worker embeds query → `env.VECTORIZE_PROTOCOLS.query(topK=5)` → fetches protocol text + linked SKUs from Supabase → composes RAG prompt → streams `env.AI.run('@cf/meta/llama-3.3-70b-instruct', { stream: true })` back as SSE; each turn recorded in `chatbot_runs` |
| 4 | **`/app/chat` owner surface** — streamed chat UI | Logged-in owner opens `/app/chat`, sees prior `conversations` list, starts a new one, types "my mare is off today, she isn't eating", tokens stream in; retrieved protocols render as inline shadcn `Card`s with **"Add to cart"** CTA (reuses Phase 3 `ProductCard`); conversation history persists across reloads |
| 5 | **Medical-emergency guardrail** | Client-side regex pre-check on submit AND server-side keyword match BEFORE the model runs; when triggered, a red shadcn `Alert` renders with "This sounds serious. Call your vet now." + tap-to-copy vet contact; model output is suppressed for that turn (`chatbot_runs.emergency_triggered=true`, `response_text=null`) |
| 6 | **In-chat one-click purchase** | "Add to cart" button on any in-chat SKU card reuses `useCart` from Phase 3; opens existing `CartSheet`; checkout flows through the existing `/api/shop/checkout` handler with `orders.source='chat'` (new enum value) |
| 7 | **Rate limit — 30 messages/user/day** | KV counter `chat:rate:{user_id}:{YYYY-MM-DD}` increments per turn; 31st turn returns `429 rate_limited` with a Sonner toast "Daily chat limit reached — resets at midnight UTC" |
| 8 | **Fallback when Workers AI is down** | If `env.AI.run` returns 5xx OR times out (> 8s), Worker falls through to a KV-indexed keyword match on `protocols.keywords_array`, returns top-3 protocols with a canned message "Our brain is warming up — here's what usually helps." Still logs a `chatbot_runs` row with `fallback='kv_keyword'` |
| 9 | **`chatbot_runs` + `conversations` tables** (audit per OAG §8) | Every user turn + model turn is an append-only row. `conversations` groups turns; `chatbot_runs` stores request/response pair, latency, model id, retrieval ids, rate-limit state, emergency flag |
| 10 | **Nightly backup extension** | `protocols`, `conversations`, `chatbot_runs` appear in `snapshots/YYYY-MM-DD/` JSON + CSV (per OAG §4) |

**Explicitly out of scope (defer to later phases or v1.1):**
- **Tack Room Talk transcript ingestion** — feature map §4.6.3 mentions transcripts as a second corpus for RAG. Phase 4 ships protocols-only; transcripts are v1.1 once SLH provides the source files + podcast rights clearance.
- **Trainer + admin chat surfaces** — `/trainer/chat` and `/admin/chat-inspector` are v1.1. Phase 4 ships `/app/chat` for owners only.
- **Dog protocols** — feature map §3.2 row 232 dog parity is v1.1 unless SLH delivers dog protocols in the Phase 4 seed CSV. Schema + retrieval path are species-agnostic on day one so the v1.1 flip is data-only.
- **Conversation export** (PDF/email to vet) — v1.1 ops request.
- **Multi-turn context window management** (summarization of long chats) — Phase 4 ships a flat last-N-turn window (N=8). Summarization is v1.1 if chats routinely exceed 16 turns.
- **Custom fine-tune / embedding model swap** — stays on CF-hosted `@cf/baai/bge-base-en-v1.5` + `@cf/meta/llama-3.3-70b-instruct`. Model swap is a one-line change.
- **Voice input / TTS output** — out of scope.
- **HubSpot chat-engagement event push** — belongs to Phase 5 HubSpot flip.
- **Protocol Brain for expense justification** (trainer-side "why did you recommend this SKU?") — v1.1.

**Phase 4 gate to Phase 5:**

> *An owner opens `/app/chat`, types "my mare is dull today, isn't finishing her grain, and her manure is loose," sees tokens stream in within 2s, gets a natural-language response that surfaces **Protocol 17 — Gut Support** with an inline "Add to cart — Gut Formula $34.99" card, adds it, checks out via Stripe Checkout (Phase 3 flow), lands on `/app/orders/:id?checkout=success` with `orders.source='chat'`. A separate turn with the word "colic" triggers the red emergency banner BEFORE any model output streams, and the `chatbot_runs` row records `emergency_triggered=true` with `response_text=null`. 50 test conversations run end-to-end, guardrails pass red-team review, nightly backup the next morning contains all three new tables.*

If a prompt below lands outside this scope, push it to Phase 4.5 or v1.1.

---

## 1. Dependencies + prerequisites

Before any Phase 4 sub-prompt starts, verify:

| # | Prerequisite | Check |
|---|---|---|
| 1 | Phase 3 code-complete (✅ 2026-04-17) — RLS, cart, orders, expenses, `CartSheet` + `ProductCard` available for reuse | `docs/phase-3-plan.md` §4 drill results |
| 2 | Silver Lining delivers a **seed protocols CSV** — one row per protocol with `number`, `title`, `body_markdown`, `category`, `linked_sku[]` (Shopify SKU codes), `keywords[]` | Cedric confirms CSV received; stored at `supabase/seed/phase4_protocols.csv` |
| 3 | Workers AI `[ai]` binding active (no token required) — confirmed live from Phase 0 | `grep -n "\\[ai\\]" wrangler.toml` → line 149 |
| 4 | Vectorize index created: `npx wrangler vectorize create maneline-protocols --dimensions=768 --metric=cosine` | `npx wrangler vectorize list` shows `maneline-protocols` with `dimensions=768 metric=cosine` |
| 5 | KV namespace `FLAGS` has `feature:chat_v1` key (default unset = enabled; flip to `"false"` to kill-switch `/app/chat`) | `npx wrangler kv key get --binding=FLAGS feature:chat_v1 --remote` |
| 6 | `orders` table `source` CHECK constraint extended to include `'chat'` in addition to `'shop'` and `'in_expense'` (Phase 3 values) | Migration 00012 ALTER TABLE step |
| 7 | Cedric + SLH signs off on the **red-team emergency keyword list** (starter: `colic`, `not breathing`, `choke`, `tying up`, `down and can't get up`, `blood`, `seizure`, `foal not nursing`). Server-side list is source of truth; client mirrors for instant UX. | `supabase/seed/phase4_emergency_keywords.txt` committed |
| 8 | Vet-contact field on `animals` exists so "tap to copy vet contact" has a real number | Column did **not** exist in Phase 1 — added in migration 00012 as `animals.vet_phone text`. Owners can populate via `/app/animal/:id` edit surface (Phase 4.5 UI addition, deferred; for dev-smoke Cedric sets the value via SQL). |
| 9 | Phase 2 `stripe_webhook_events` idempotency table reused for chat-initiated checkouts — no new table | Phase 3 pattern |
| 10 | Daily cron for embedding drift-check (re-embed any `protocols.updated_at > embed_synced_at` row) — new pg_cron row `seed-protocol-embeddings-hourly` | SQL Editor; runs after Phase 4.2 ships |

If any row is red, **do not start Phase 4 sub-prompts** — fix first. Rows 2, 7 are client deliverables and can arrive during the phase as long as they land before Prompt 4.2 (seed) and 4.5 (guardrail) respectively.

---

## 2. Phase 4 sub-prompts (copy/paste into Claude Code, one at a time)

Same discipline as Phase 3: run each verify block, stop on red, fix before moving on.

### 4.1 — Data model: `protocols` extension, `conversations`, `chatbot_runs`, `animals.vet_phone`, `orders.source` extension

**Scope.** Migration `supabase/migrations/00012_phase4_protocol_brain.sql`. Two new tables + four ALTERs. RLS day one. Archive-never-delete.

**Reconciliation with Phase 3.5 (2026-04-19).** Phase 3.5 migration `00011_phase3_5_protocols.sql` already created `public.protocols` with a slightly different shape than this plan originally specified. Phase 4 keeps 3.5 field names and **adds** the embedding / retrieval columns via ALTER rather than re-creating the table. Name mapping:

| Plan spec (original) | Actual column (kept) |
|---|---|
| `number int UNIQUE` | `number text UNIQUE` (3.5 allows `'#17'` style) |
| `title text` | `name text` |
| `body_markdown text` | `body_md text` |
| `linked_sku_codes text[]` | `linked_sku_codes text[]` (added in 00012) |
| `category`, `keywords`, `published`, `embed_status`, `embed_synced_at` | added in 00012 |

Worker + seed code must use the 3.5 names (`name`, `body_md`, `number`) — not the original plan names.

**Tables (exact shape):**
- `protocols` (ALTER, not CREATE) — add columns: `category text`, `keywords text[] not null default '{}'`, `linked_sku_codes text[] not null default '{}'`, `published boolean not null default true`, `embed_status text not null default 'pending' check in ('pending','synced','failed')`, `embed_synced_at timestamptz`. Existing RLS (authenticated SELECT) is sufficient: the `/api/chat` Worker queries via service_role per OAG Law 2, and the SPA never selects protocols directly. No anon policy added.
- `conversations` — `id uuid PK`, `owner_id uuid REFERENCES auth.users`, `title text` (auto-set to first user message, 60 char), `created/updated/archived_at`. RLS: owner sees own.
- `chatbot_runs` — `id uuid PK`, `conversation_id uuid REFERENCES conversations`, `turn_index int`, `role text check in ('user','assistant','system')`, `user_text text`, `response_text text`, `retrieved_protocol_ids uuid[]`, `model_id text`, `latency_ms int`, `fallback text check in ('none','kv_keyword','emergency')`, `emergency_triggered boolean`, `rate_limit_remaining int`, `created_at timestamptz`. RLS: owner sees own via `conversation_id` join; writes service_role only.
- ALTER `orders.source` CHECK to include `'chat'`.

### 4.2 — Seed pipeline: `supabase/functions/seed-protocol-embeddings/`

**Scope.** Edge Function + hourly pg_cron entry. Reads every `protocols` row where `embed_status='pending' and archived_at is null` (batched ≤20 per invocation); composes embedding input from `number + name + description + use_case + body_md + keywords` (3.5 column names per §4.1 reconciliation); POSTs each row to the Worker's `POST /api/protocols/embed-index` with an `X-Internal-Secret` header. That Worker endpoint wraps both `env.AI.run('@cf/baai/bge-base-en-v1.5')` *and* `env.VECTORIZE_PROTOCOLS.upsert` server-side — the Edge Function never talks to Cloudflare APIs directly — with metadata `{ protocol_id, number, category, linked_sku_codes }`. On 200 the Edge Function flips the row to `embed_status='synced'` + stamps `embed_synced_at=now()`; on non-200 it flips to `failed` and records the error in the `seed_run_log` append-only table. A `{mode:'drift'}` body first re-queues any `synced` row where `updated_at > embed_synced_at` — the hourly pg_cron uses drift mode.

Verify: after seed CSV imported + function run, `select count(*) from protocols where embed_status='synced';` = N, and a manual `npx wrangler vectorize query maneline-protocols --vector=...` returns the expected neighbour.

### 4.3 — Worker routes: `/api/ai/embed`, `/api/chat`

**Scope.** Two new public routes in `worker.js` + `worker/chat.js` helper module. Phase 4.2 already shipped two *internal* helpers (`POST /api/ai/embed` and `POST /api/protocols/embed-index`, both gated by `X-Internal-Secret` matched to `env.WORKER_INTERNAL_SECRET`, backed by `worker/workers-ai.js`). 4.3 adds the authenticated chat entry point.
- `POST /api/ai/embed` — already exists (Phase 4.2). Body `{ text }`, returns `{ vector: number[768] }`. Internal only. Reused here by the query-time embed path.
- `POST /api/chat` — auth required (Supabase JWT). Body `{ conversation_id?, message }`. Flow:
  1. Rate-limit check (KV counter). If exceeded → 429.
  2. Emergency keyword regex. If hit → insert `chatbot_runs(emergency_triggered=true, response_text=null)` + return `{ type: 'emergency', vet_phone, protocols: [] }`. Model is **not called**.
  3. Embed message.
  4. `env.VECTORIZE_PROTOCOLS.query(vector, { topK: 5, returnMetadata: 'all' })`.
  5. Fetch protocol rows + linked SKUs via Supabase REST (`products` table from Phase 3) using service_role.
  6. Compose system prompt (hardcoded safety frame — "framed as 'owners in similar situations have used…' not 'your horse has…'; never prescribe non-SLH dosage; redirect to vet for anything diagnostic") + retrieved context + last-8-turn history.
  7. `env.AI.run('@cf/meta/llama-3.3-70b-instruct', { messages, stream: true })` → SSE pipe to client.
  8. After stream closes, INSERT the full response into `chatbot_runs` with `latency_ms`.
- Fallback path triggers if step 7 throws or exceeds 8s timeout: KV keyword match → top-3 protocols → canned message → still logged.

### 4.4 — Chat UI: `/app/chat`, `/app/chat/:conversationId`

**Scope.** shadcn-pure. New files:
- `app/src/pages/app/chat/ChatIndex.tsx` — list of `conversations`, "Start new" CTA.
- `app/src/pages/app/chat/ConversationView.tsx` — SSE stream via `EventSource`/`fetch` ReadableStream; renders markdown turns; inline retrieved SKUs as `<ProductCard>` (reused from Phase 3) with quantity fixed at 1 and an "Add to cart" button that calls `useCart.add()`.
- `app/src/lib/chat.ts` — `sendMessage`, `streamConversation`, `listConversations` — all through `/api/chat` + Supabase SELECTs.
- Bottom nav entry in `BottomNav.tsx` → MessageCircle icon → `/app/chat`. Hidden when `feature:chat_v1=false`.

### 4.5 — Emergency guardrail (client + server)

**Scope.** Client-side: `app/src/lib/emergencyKeywords.ts` imports the same list as the Worker (shared via a committed JSON the Worker also reads — no runtime RPC). On submit, regex-match. If hit, render red `Alert` + tap-to-copy `animals.vet_phone` + still POST to `/api/chat` so the audit row exists. Server-side (already in 4.3): authoritative match. Response type `'emergency'` suppresses the assistant bubble entirely; UI shows the banner.

Red-team review gate: 20 variations per keyword (typos, synonyms, context edges) must trigger. Cedric + SLH review list before Phase 4 sign-off.

### 4.6 — One-click purchase from chat

**Scope.** Extend Phase 3 `orders.source` CHECK constraint to allow `'chat'` (in 4.1). Extend `/api/shop/checkout` handler to accept a `source='chat'` request body and record it on the `orders` row. UI: in-chat `ProductCard` "Add to cart" calls `useCart.add({ from: 'chat', conversation_id })`; the `conversation_id` is stashed in sessionStorage so the eventual checkout request can forward it to the Worker. On webhook success, insert an `expense` row (mirroring Phase 3.8 in-expense pattern) optionally if the owner has flipped `auto_log_chat_purchases_as_expense` preference (new user-setting; default off for v1).

### 4.7 — Rate limit + fallback

**Scope.** KV counter `chat:rate:{user_id}:{YYYY-MM-DD}` with TTL = 48h. Incremented atomically inside `/api/chat` before the embed call. When 30 is reached, return `429 rate_limited`. UI catches and Sonner-toasts "Daily limit reached — resets at midnight UTC." Fallback path from 4.3 step 7 is exercised by a KILL_AI integration test that sets a `env.AI_DISABLED=true` local-only flag.

### 4.8 — Audit + backup

**Scope.** `nightly-backup` Edge Function extended to include `protocols`, `conversations`, `chatbot_runs` in the snapshot (JSON + CSV, per OAG §4). Add column-level redaction for `chatbot_runs.user_text` and `response_text` only if SLH requests; default is full capture since it's their IP + liability. Verify: next morning's `snapshots/YYYY-MM-DD/` contains all three files + `LATEST/` symlinks updated.

### 4.9 — Observability

**Scope.** Add three metrics to `/api/_integrations-health`:
- `workersAi.chat_p50_latency_ms` (last-hour moving average from `chatbot_runs.latency_ms`)
- `workersAi.emergency_rate_1h` (count of `emergency_triggered=true` / total runs last hour)
- `vectorize.protocols_indexed` (count of `protocols.embed_status='synced'`)
Wire Cedric's Grafana (Phase 5 infra, but stubbed JSON endpoint here) to the health response.

### 4.10 — Verification drill (20 steps)

Mirrors the Phase 3.10 pattern. Steps include: migration applies clean, Vectorize index dimensions match, seed function idempotent, rate-limit boundary at turn 30 vs 31, emergency keyword catches all 20 red-team variants, fallback kicks in when AI disabled, streamed response feels < 2s TTFT, in-chat "Add to cart" lands in Phase 3 cart, Stripe Checkout via chat records `orders.source='chat'`, nightly backup contains all three tables, static grep: zero `@heroui/react` in `pages/app/chat/**` + `components/chat/**`, zero hex literals, zero `console.log` error paths.

---

## 3. UI Contract (non-negotiable)

Same tokens as Phase 2/3. Zero new tokens. Chat surface is shadcn-pure. Streaming renders token-by-token via shadcn `Skeleton` shimmer while awaiting first SSE chunk, then a simple `whitespace-pre-wrap` div for the streamed text; `react-markdown` for the finalized turn. In-chat SKU cards re-use the exact `ProductCard` Phase 3 shipped — zero fork.

Forbidden:
- No streaming over WebSockets. SSE only — it goes through the same fetch path, auth cookies, and rate limit middleware without ceremony.
- No storing full prompts (system + history) on the client. The Worker rebuilds context on every turn from `chatbot_runs` rows so prompt drift can't creep in from a long-open tab.
- No direct `env.AI` calls from the SPA (there's no binding there anyway) — always through the Worker.
- No `console.log` on error paths — Sonner toast + structured `TECH_DEBT(phase-4)` if needed.
- No `any` — Zod types on request/response bodies for `/api/chat`.

---

## 4. Resolved decisions + open items

### Resolved (to be re-confirmed when seed CSV lands)

1. **Embedding model = `@cf/baai/bge-base-en-v1.5` (768 dim), NOT bge-large-en-v1.5 (1024 dim) as feature map §4.6.3 suggests.** Rationale: `wrangler.toml:167` already reserves `dimensions=768`; bge-base is 4× faster, its retrieval quality on domain-narrow corpora (a few hundred protocols) is within 2–3% of bge-large in public benchmarks, and the difference is invisible at `topK=5`. If we ever ingest Tack Room Talk (tens of thousands of chunks) we swap to large and re-create the index — the migration is `wrangler vectorize delete` + new create + full re-seed, well under an hour.

2. **Chat model = `@cf/meta/llama-3.3-70b-instruct`** per feature map. If CF promotes a newer flagship during Phase 4, swap in a one-line change. No fine-tune.

3. **Conversation context window: last 8 turns**, flat. Summarization is v1.1.

4. **Rate limit: 30 msg/user/day**, per feature map §4.6.3 "free tier." Paid tier is v1.1 and lives in Stripe as a subscription product.

5. **Emergency keywords are a committed file, not a DB table.** The list changes rarely and safety-critical config shouldn't be hot-swappable from a UI. Cedric + SLH co-own the file; changes flow through PR review.

6. **`orders.source='chat'` is the ONLY schema change** Phase 4 makes to existing tables. Cart + checkout + webhook paths are untouched — chat is just a third originator alongside shop and in_expense.

7. **SSE over REST streaming, not WebSockets.** One less protocol, reuses existing auth + rate-limit middleware, and CloudFlare Workers stream natively via `ReadableStream`.

### Open items to resolve during Phase 4 (not gating code-complete)

- **Who owns the protocols copy?** SLH writes v1; Mane Line edits for tone. Need an editorial loop when a new protocol is added (Phase 4.5 could add `/admin/protocols` read-write UI; for now it's SQL).
- **"Cite your sources" in chat** — should the assistant reply include links to each retrieved protocol's detail page (`/app/protocols/:number`)? Probably yes for trust, but that page doesn't exist yet. Plan: ship the chat without citation links in v1, add both the link and the `/app/protocols/:number` detail page in Phase 4.5.
- **Multilingual** — out of scope for v1; llama-3.3 handles Spanish zero-shot if we ever flip it on.
- **Hallucination budget** — set `temperature=0.2` in `AI.run` config. Monitor `chatbot_runs` for thumbs-down (new column in 4.1? — defer to 4.5 once we have live traffic).
- **COPPA / minor users** — not an issue (this is a B2C ranch app, adult owners) but document in case SLH ever adds a kid-owner flow.
- **Model failure budget** — alert Cedric if `emergency_rate_1h > 5%` (likely a keyword false-positive spike) or if `workersAi.chat_p50_latency_ms > 6000`. Wires into 4.9.

---

## 5. Phase 4 gate to Phase 5

Phase 4 is complete when the 20-step drill in 4.10 is 🟢 (with any ⚠️ deferred rows blocked only on client deliverables, same pattern as Phase 3). Phase 5 begins with:
- HubSpot flip (`maneline_chat_initiated`, `maneline_emergency_flagged`, `maneline_order` behavioral events)
- Admin surfaces: `/admin/protocols`, `/admin/chat-inspector`, `/admin/marketplace`
- Trainer chat surface (`/trainer/chat`) if SLH prioritizes it
- Dog parity flip once SLH delivers dog protocols

*End of docs/phase-4-plan.md — Phase 4 scope: Protocol Brain (Workers AI + Vectorize + streamed RAG chat + in-chat purchase + emergency guardrails).*
