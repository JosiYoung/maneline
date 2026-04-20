/**
 * RateLimiter — Durable Object for deterministic per-bucket rate limits.
 *
 * Phase 6.3. Replaces the KV-based `rateLimitKv` whose eventual
 * consistency + 1-write/sec-per-key cap meant a burst could slip through
 * before the counter caught up. Each DO instance is keyed off the
 * bucket name (e.g. `ratelimit:vet_token:<token>`), so contention is
 * local to that one key and `state.blockConcurrencyWhile` gives us a
 * hard serialization around the read-modify-write.
 *
 * Request shape (POSTed from the Worker via the DO stub):
 *   { limit: number, windowMs: number }
 *
 * Response shape:
 *   { ok: boolean, remaining: number, resetMs: number }
 *
 * State model:
 *   - `count`   — integer, attempts seen in the current window.
 *   - `resetAt` — epoch-ms when the window closes and `count` resets.
 *
 * A fresh or expired window starts at `now + windowMs`. We persist
 * only after the increment so a crash between read and put just drops
 * the attempt — fail-open toward the caller, but the DO still corrects
 * itself on the next request.
 *
 * Scope: in-DO storage only; no alarm, no hibernation-sensitive state.
 * Throughput ceiling ~1000 req/s per DO — well above any bucket cap
 * we ship (VET_READ is 60/min per token, upload sign is 20/min per user).
 */

export class RateLimiter {
  constructor(state, env) {
    this.state = state;
    this.env   = env;
  }

  async fetch(request) {
    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_body' }, 400);
    }

    const limit    = Number(body?.limit);
    const windowMs = Number(body?.windowMs);
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(windowMs) || windowMs <= 0) {
      return jsonResponse({ error: 'invalid_args' }, 400);
    }

    let result;
    // blockConcurrencyWhile serializes every in-flight request against this
    // DO instance. A 65-parallel burst queues behind a single mutex inside
    // the DO — first 60 land count=1..60 (ok), next 5 see count=61..65 and
    // return ok=false. Deterministic.
    await this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const stored = (await this.state.storage.get('window')) || null;
      let win = stored;
      if (!win || typeof win.resetAt !== 'number' || win.resetAt <= now) {
        win = { count: 0, resetAt: now + windowMs };
      }
      win.count += 1;
      const ok = win.count <= limit;
      await this.state.storage.put('window', win);

      result = {
        ok,
        remaining: Math.max(0, limit - win.count),
        resetMs:   Math.max(0, win.resetAt - now),
      };
    });

    return jsonResponse(result, 200);
  }
}

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
