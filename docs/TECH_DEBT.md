# TECH_DEBT marker convention

## What it is

When we knowingly ship a shortcut, hardcode, placeholder, or deferred
follow-up, we annotate the exact spot in source with a grep-friendly marker:

```
TECH_DEBT(<phase>): <one-line description>
```

Examples:

```ts
// TECH_DEBT(phase-1): replace with generated types once supabase CLI is wired.
```

```sql
-- TECH_DEBT(phase-5): admin RLS policies; replace with service-role worker path.
```

```js
// TECH_DEBT(phase-4): Google Apps Script payloads are unsigned — add HMAC
// once we have write access to the script project.
```

## Why this convention

1. **Greppable.** `grep -rn "TECH_DEBT"` across the repo gives a complete,
   sortable list of outstanding shortcuts. We can't scatter TODO / XXX / FIXME
   without losing signal among third-party dependencies' own comments.
2. **Phase-tagged.** Every marker carries the phase by which the debt must
   be paid. Phase gates can fail the release if any marker tagged with a
   prior phase is still present.
3. **No orphan tickets.** The comment IS the ticket. Anything worth tracking
   separately (design work, UX review) goes in the roadmap doc instead.

## Phase tags

- `phase-0` — must be resolved before Phase 0 is called done
- `phase-1` — owner portal MVP
- `phase-2` — multi-species / dog support
- `phase-3` — vet-share bundles
- `phase-4` — integrations hardening (Apps Script HMAC, etc.)
- `phase-5` — admin portal + service-role migration
- `eventually` — known nice-to-have, no committed phase yet

Use `eventually` sparingly — it's a last resort for real deferral. If you're
tempted to use it for something that will affect compliance or safety, pick
a concrete phase instead.

## What NOT to tag

- In-progress work in a feature branch — use a regular TODO and clean it up
  before merge.
- Style nitpicks — just fix them.
- "Could be faster" optimizations with no current pain — don't tag unless
  a real bottleneck has been measured.

## Current outstanding markers

As of Phase 3 sign-off (2026-04-17):

| Tag | Location | Summary |
|---|---|---|
| phase-1 | `app/src/lib/database.types.ts` | Replace hand-rolled types with `supabase gen types` output |
| phase-2 | `worker/stripe.js`, `worker.js` (`handleStripeConnect*`) | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` are placeholders; Cedric is verifying the company's payment processor before we mint live keys. All `/api/stripe/*` endpoints return `501 stripe_not_configured` until secrets are added via `npx wrangler secret put`; the SPA renders a "waiting on keys" state in that case. Resolve by setting the secrets in production + preview environments. |
| phase-4 | `supabase-edge/apps-script/*` (future) | Add HMAC signing to Google Apps Script payloads |
| phase-5 | `supabase/migrations/00002_phase0_multirole_foundation.sql` | Admin RLS policies were dropped in 00004; this file's REVISIT block is superseded |
| phase-2 | `docs/phase-2-plan.md` §4 (Prompt 2.10) | 18-step Phase 2 verification drill deferred to the post-P0 end-to-end UAT pass. Steps 2–6, 8–16, 18 are blocked on live Stripe keys + deployed Worker + deployed `sweep-stripe-events` Edge Function + `pg_cron` schedule wired in SQL Editor. Static grep steps (1, 7, 17) ran clean on 2026-04-17 with the noted exceptions: `app/src/components/trainer/VetRecordsList.tsx:93` (vet-record warning badge — pre-existing Phase 1 hex) and `app/src/components/shared/PaymentForm.tsx` (Stripe Elements `colorPrimary` — required by Stripe SDK, not brand drift). Resolve by running the full drill once client delivers `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `VITE_STRIPE_PUBLIC_KEY`. |
| phase-3 | `docs/phase-3-plan.md` §4 (Prompt 3.10) — Shopify sync steps | Phase 3.2 drill steps 2–5 deferred to the post-P0 end-to-end UAT pass. Steps 2 (live sync populates `products`), 3 (placeholder-safe skip — re-runs cleanly without the token), and 4 (KV catalog read path + `shop:v1:list` warm cache) are blocked on `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN` + `MANELINE_WORKER_URL` delivery and the hourly `pg_cron` schedule being wired in SQL Editor per `supabase/functions/shopify-catalog-sync/README.md`. Edge Function deployed v1 on 2026-04-17 and is placeholder-safe (returns `{ skipped: 'shopify_not_configured' }` when tokens absent). `app/src/integrations/shopify.ts` Phase 0 mock was removed in Prompt 3.3 (SPA now reads `/api/shop/products` via `app/src/lib/shop.ts`). Resolve by running drill steps 2–4 end-to-end once the Silver Lining Storefront token is provisioned. |
| phase-3 | `worker/stripe-checkout.js`, `worker.js` (`handleShopCheckout`) | Phase 3.4 end-to-end checkout redirect blocked on `SLH_CONNECT_ACCOUNT_ID` Worker secret (Silver Lining's Stripe Connect account id). Until present, `POST /api/shop/checkout` takes the fallback path: inserts `orders.status='awaiting_merchant_setup'` and returns `{ status: 'awaiting_merchant_setup' }` without a Stripe session (SPA clears cart + shows info toast). With the secret set, handler mints a Checkout Session with `payment_intent_data.transfer_data.destination = <acct>` + `application_fee_amount = 0` + `Idempotency-Key: shop_checkout:${order_id}`. Also depends on Phase 2 `STRIPE_SECRET_KEY` (already TECH_DEBT-tagged above). Resolve by running the 3.10 drill's Stripe redirect steps once `SLH_CONNECT_ACCOUNT_ID` lands via `npx wrangler secret put`. |
| phase-3 | `worker.js` (`handleCheckoutSessionCompleted` + `handleCheckoutSessionAsyncPaymentFailed`), `worker/shopify-admin.js` (`adjustInventory`) | Phase 3.5 webhook + success/cancel UI is built but the live path is blocked on the same Stripe secrets as Phase 2 (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` already TECH_DEBT-tagged) plus `SLH_CONNECT_ACCOUNT_ID` (3.4 row). Server-side inventory decrement is further gated on the optional `SHOPIFY_ADMIN_API_TOKEN`; without it, `adjustInventory` is a no-op that logs once per process and the hourly Storefront sync reconciles inventory within ~1h. Resolve by running the 3.10 drill's Stripe Checkout + webhook steps once the Stripe keys + Connect account id (+ optional Admin token) land. |
| phase-3 | `docs/phase-3-plan.md` §4 (Prompt 3.10) | 20-step Phase 3 verification drill partially deferred to the post-P0 end-to-end UAT pass. Steps 1, 5, 6, 14, 15, 16, 17, 19, 20 ran 🟢 on 2026-04-17 (migration SQL, static greps across shop/orders/expenses scope, orders RLS verified via `pg_policies`, expense form flows preview-verified in 3.7/3.8, `nightly-backup` v4 invoked with 98 files written to `JosiYoung/Databackup` incl. all 6 Phase 3 tables and zero card data). Steps 2, 3, 4 (Shopify sync + catalog read + placeholder path) blocked on `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN`. Steps 7, 8 (out-of-stock tile + cart state) blocked on live product rows (no SKUs until sync runs). Steps 9–13 (checkout redirect, normal pay, webhook idempotency, payment fail, inventory decrement) blocked on `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `SLH_CONNECT_ACCOUNT_ID` (+ optional `SHOPIFY_ADMIN_API_TOKEN` for step 13). Step 18 (in-expense Buy-now end-to-end) blocked on the same Stripe + Shopify keys. Static grep exceptions: `@heroui/react` matches in `components/owner/AnimalCard.tsx`, `pages/app/TodayView.tsx`, `components/owner/OwnerLayout.tsx` are pre-existing Phase 0/1 imports outside the Phase 3 shop/orders/expenses scope — not drift from this phase. Resolve by running drill steps 2–4, 7–13, 18 end-to-end once the client lands the Shopify + Stripe secrets. |
| phase-3.5 | `supabase/migrations/00011_phase3_5_protocols.sql`, `app/src/components/owner/ProtocolsSection.tsx`, `app/src/pages/app/TodayView.tsx` | Phase 3.5 supplement protocol tracker (P0 catch-up before Phase 4) landed in code but the migration has NOT yet been applied to the remote Supabase. Until `supabase db push` runs, `/app/animals/:id` + `/trainer/animals/:id` render the Protocols empty state and background queries return 404 (graceful — no crash). `protocols` seed still carries 5 placeholder rows flagged in `supabase/seeds/protocols.sql`; real SLH content replaces these BEFORE Phase 4 public launch so Vectorize RAGs against production copy. Resolve by (1) `supabase db push` on remote, (2) running verification drill in `docs/phase-3.5-plan.md` §C, (3) replacing seed content with SLH's real protocol playbooks. |
| phase-5 | `app/src/pages/admin/AdminIndex.tsx` | **Trainer vetting admin queue** — `trainer_profiles` + `trainer_applications` exist (Phase 0) but `/admin/trainer-applications` is a "coming soon" stub. P0 per feature map §3.3. Until this ships, trainers who sign up land on `/trainer/pending-review` indefinitely; only a service-role SQL update flips `application_status='approved'`. Resolve by building the admin review UI with approve/reject + reason, writing `trainer_profiles.reviewed_by/reviewed_at/review_notes`, and clearing the pending-review gate. |
| phase-5 | `app/src/pages/VetView.tsx`, `supabase/migrations/*` (future) | **Vet View scoped magic link** — route exists at `/vet/:token` but token issuance + scoped-read are not wired. P0 per feature map §3.1 ("Share 12-month record with vet"). Requires: `vet_share_tokens` table (owner_id, animal_id, token, expires_at, scope jsonb, viewed_at), owner UI to generate/copy link from `/app/animals/:id/records`, Worker endpoint that validates token + serves scoped records without auth, and `audit_log` entries on view. |
| phase-5 | `app/src/integrations/hubspot.ts`, `worker.js` (future `/webhooks/hubspot-sync`) | **HubSpot CRM sync** — client-side integration stub exists; no Worker-side webhook or retry queue. P0 per feature map §3.3 + §4.6.2. Requires: Worker endpoint that upserts contacts/deals on `profiles.insert` / `trainer_applications.insert` / `orders.insert` (via Stripe webhook), `hubspot_sync_log` table for audit, `pending_hubspot_syncs` queue + 15-min retry cron. Blocked on `HUBSPOT_PRIVATE_APP_TOKEN` secret. |
| phase-5 | `app/src/pages/admin/AdminIndex.tsx` | **Admin KPI dashboard + user directory** — only `/admin/settings/fees` tab is live. P0 per feature map §3.3. Requires WAU/MAU/GMV/attach-rate tiles (service-role aggregation endpoint) and `/admin/users` searchable directory across `profiles` + `trainer_profiles` + `animals`. Every query logged to `audit_log` per §4.3. |
| phase-5 | `supabase/migrations/*` (future), `app/src/pages/admin/*` | **Support inbox** — no `support_tickets` table, no in-app help widget, no admin reader. P0 per feature map §3.3. Requires: `support_tickets` table (owner_id, category, body, status, resolved_at, assignee_id), widget that writes tickets from any portal, `/admin/support` inbox, Sheets L1 mirror (OAG Law 2). |
| phase-5 | `worker/stripe.js` (future refund handler), `app/src/pages/admin/*` | **Refunds + subscription management** — no admin refund UI and no subscription panel. P0 per feature map §3.3. Stripe dashboard is the fallback until this lands. Requires: `order_refunds` table, admin action on `/admin/orders/:id` that calls Stripe `refunds.create` via Connect + writes the refund row, and a `/admin/subscriptions` panel once auto-ship ships (currently open item in §3.4). |
| phase-4 | `public.products` row `JOINT-001`, `public.protocols` (Protocol #10) | **Dev-stub Joint Formula product + SKU link** — Phase 4.6 in-chat add-to-cart verification required a real `products` row and a `protocols.linked_sku_codes` entry. Products table was empty (no Shopify sync yet) and every seeded protocol had `linked_sku_codes = '{}'`. As a dev smoke, a stub product (`sku='JOINT-001'`, `title='Joint Formula (dev stub)'`, `shopify_variant_id='dev-stub-var-1'`, `price_cents=3499`, `available=true`) was inserted and linked to Protocol #10 (Joint Support). Resolve by: (1) wiring Shopify catalog sync with real tokens (blocks on `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN`), (2) deleting the stub row (`delete from products where sku='JOINT-001';` — `orders` never referenced it since the smoke stopped at cart), (3) populating `linked_sku_codes` on every published protocol from the SLH-provided CSV before the Phase 4.10 drill runs against production. |
| phase-4 | `app/src/components/landing/ScrollHero.tsx`, `app/public/Landing/` | **Landing hero video + poster frame** — current scrub source (`15439204_3840_2160_60fps.mp4`, 24 MiB) and companion B-roll (`8624835-hd_1920_1080_30fps.mp4`, 8 MiB) are stock Pexels clips. A larger 49 MiB portrait clip (`12016358_2160_3840_60fps.mp4`) was removed during Phase 4.4 deploy because it exceeded the Workers Assets 25 MiB per-file cap and was unreferenced. Poster is a temporary gradient SVG (`hero-poster.svg`). Resolve by: (1) commissioning real brand-shot horse footage from the SLH ranch, (2) re-encoding with every-frame keyframes (`-g 1 -keyint_min 1`) for smooth scrubbing, (3) extracting a proper first-frame poster (`ffmpeg -ss 0 -frames:v 1 -q:v 2 hero-poster.jpg`), and (4) if the final MP4 exceeds 25 MiB, hosting on R2 + fronting with a custom domain rather than bundling into the Worker asset package. |

| phase-5 | `worker.js` (`rateLimitKv`) | **KV-based rate limiter is best-effort under burst** — Workers KV has two caps that collide with rate-limiting: per-key writes max out at ~1/sec (a 65-parallel burst throws `KV PUT failed: 429 Too Many Requests`) and reads are edge-cached with a 60s minimum TTL (so counter reads stay stale for up to a minute after the write lands). Net effect on `/api/vet/:token`: during a true burst from one POP, reads see stale `state.count ≤ 60` → all requests pass 200 even past the 60/min cap. KV writes _are_ being throttled by the 1-write/sec cap, which indirectly limits sustained throughput to ~60/min per token, but the 429 response the 5.9 drill expects on "61st request" isn't reliably observed. `adminOrderRefund` and the support-ticket + upload-sign limiters share the same helper and have the same caveat. Resolve by migrating `rateLimitKv` to a Durable Object with atomic `state.blockConcurrencyWhile` — either a single `RateLimiter` DO class keyed by bucket or one DO instance per hot key. Unblocks tight 429s under burst and makes the 5.9 step 14 check deterministic. |
| phase-5 | `docs/phase-5-plan.md` §5.9 | **Admin drill partially deferred** — 5.9 ran 🟢 on 2026-04-20 across: step 1 (all Phase 5 migrations applied), step 2 (RLS enabled on all 6 new tables; service-role-only for `hubspot_sync_log` + `pending_hubspot_syncs`), step 3 (non-admin JWT returns 403 from `/api/admin/kpis`, verified with owner PIN), step 4 (`GET /api/admin/kpis` returns non-null mau/wau/gmv/attach_rate), step 5 (`GET /api/admin/users?q=cedric` returns 3 rows), step 6 (`GET /api/admin/users.csv` streams 200 + `content-type: text/csv`), step 7 (trainer approve hits `admin_decide_trainer` RPC and enqueues `maneline_trainer_decision` into `pending_hubspot_syncs`), step 9 (support ticket owner-create → admin-list → admin-claim → admin-resolve round-trip), steps 12–13 (vet share create → anon GET 200 → revoke → anon GET 410), step 17 (audit_log has 15 distinct `admin.*` actions with sane counts — proves the pipeline writes), step 18 (manual `nightly-backup` invocation v7 wrote 142 files including all 6 new tables; manifest `version: "5.0"`), step 19 (`/api/_integrations-health` returns the new `admin.audit_writes_24h` + `vet_view.scoped_reads_24h` blocks), step 20 (static grep: zero `@heroui/react`, zero hex literals, zero `console.log` under `app/src/pages/admin/**`). **Phase 6 code-progress (2026-04-20 / Prompt 6.8):** (a) Step 14 strict-429 — **code-closed** in 6.3 by the new `RateLimiter` Durable Object at `worker.js:rateLimitDO` + `worker/rate-limiter-do.js`; `state.blockConcurrencyWhile` serialises reads+writes so a 65-parallel burst splits deterministically. Live-traffic confirmation happens in 6.9 drill step 15; until then the 5.9 step-14 box stays amber. (b) Step 8 trainer-reject email — **still deferred**. `worker/resend.js:sendEmail` exists (6.2) and is called on invitation creation, but the reject branch in `worker.js:708` (`admin.trainer.reject`) does NOT yet call it; header comment on `worker/resend.js` explicitly lists trainer-reject as v1.1 scope. Resolve by wiring `sendEmail({subject: "Your Mane Line trainer application", ...})` into the `decision === 'rejected'` branch once SLH confirms reject-email copy. (c) Steps 10–11 (refund $1 + idempotency) — **still secrets-blocked** on `STRIPE_SECRET_KEY`. (d) Steps 15–16 (HubSpot drain + dead-letter) — **still secrets-blocked** on `HUBSPOT_PRIVATE_APP_TOKEN`. Row stays until live-secret drill pass lands steps 8/10/11/15/16 🟢; step 14 is provisionally green pending 6.9. |

When you add a new marker, also add the row here. When you resolve one,
delete the row in the same commit that removes the marker.
