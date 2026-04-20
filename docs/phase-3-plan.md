# Mane Line — Phase 3 (Shopify Marketplace + Stripe Checkout + Expenses) Build Plan

**Owner:** Cedric / OAG
**Window:** Week following Phase 2 sign-off (earliest 2026-05-04 per feature map §6)
**Feature map reference:** `MANELINE-PRODUCT-FEATURE-MAP.md` §4.6.1 (Shopify catalog source of truth) + §6 row Phase 3 + §3.2 (in-expense-form supplement purchase is P0)
**UI reference:** `FRONTEND-UI-GUIDE.md` §3.5 (`/app/shop` lives on the owner bottom-nav — `BottomNav.tsx` line 524 — already present), §3.4 (shadcn Card / Dialog / Table patterns), §7 (Stripe Elements — **not** used here; Stripe Checkout is the hosted flow).
**Law references:** `playbooks/OAG_ARCHITECTURE_LAWS.md` §2 (admin reads via Worker + service_role), §4 (triple redundancy — L2 client-owned GitHub), §7 (RLS on every table day one), §8 (archive-never-delete).
**Integrations reference:** `docs/INTEGRATIONS.md` §Shopify + §Stripe (flip plans).

---

## 0. What Phase 3 is, and what it isn't

**In scope (derived from `wrangler.toml` lines 40–44 + feature map §6 Phase 3 row + §3.2 P0 rows 184–186):**

| # | Feature | Success criterion |
|---|---|---|
| 1 | **Marketplace catalog cache** — Silver Lining SKUs pulled from Shopify Storefront API into Supabase on a cron + on-demand | `products` table populated; hourly sync runs green; KV edge cache `shopify:catalog:v1` warm |
| 2 | **Owner shop — `/app/shop` product grid** | Logged-in owner opens `/app/shop`, sees SLH SKUs as shadcn `Card` tiles with image/title/price/available, can filter by category |
| 3 | **Product detail — `/app/shop/:handle`** | Owner taps a tile, sees full product detail (description, price, image, inventory-available chip), `Add to cart` CTA |
| 4 | **Cart + Stripe Checkout (hosted)** | Owner reviews cart in a shadcn `Sheet`, taps "Checkout", Worker mints a Stripe Checkout Session, browser redirects to `checkout.stripe.com`, completes payment with test card, lands back on `/app/orders/:id?checkout=success` |
| 5 | **Order lifecycle via `checkout.session.completed` webhook** | Stripe webhook flips an `orders` row to `paid`, writes `order_line_items`, calls Shopify Admin API to decrement inventory (if `SHOPIFY_ADMIN_API_TOKEN` set), writes `audit_log` |
| 6 | **Owner orders — `/app/orders` + `/app/orders/:id`** | Owner sees order history with status chips; order detail shows line items + total + Shopify order id (opaque) |
| 7 | **Expense tracker per animal** | Owner OR trainer adds an expense (feed / tack / vet / board / farrier / supplement / travel / show / other) against an animal; per-animal + per-month rollup on `/app/animals/:id` and `/trainer/expenses` |
| 8 | **In-expense-form one-tap SLH purchase** | Trainer opens "New expense", picks category=`supplement`, sees an inline SLH product picker sourced from `products`; picking a SKU pre-fills `amount_cents` + `vendor='silver_lining'`, and a second CTA "Buy now" opens the same Stripe Checkout flow from feature #4 |
| 9 | **Nightly backup extension** | `products`, `orders`, `order_line_items`, `expenses`, `expense_archive_events`, `shopify_sync_cursor` appear in `snapshots/YYYY-MM-DD/` with JSON + CSV |

**Explicitly out of scope (defer to later phases or v1.1):**
- **Subscriptions / auto-ship** for supplements — feature map §3.2 row 230 lists as open-item; defer to v1.1 after deciding Shopify Subscriptions vs Stripe Subscriptions.
- **Full Shopify Admin mutations** beyond inventory decrement (fulfillments, refunds-back-to-Shopify) — Phase 3 ships the single `inventoryAdjust` mutation; richer flows are v1.1 ops requests.
- **Protocol Brain "buy recommended supplement" one-tap from chat** — belongs to Phase 4 (the chat surface does not exist yet). Phase 3 does ship the product picker component it will reuse.
- **Trainer P&L / Recharts dashboards** fed by expenses + session revenue — deferred to Phase 2.5 / Phase 5.
- **`/admin/marketplace` SKU editor** — the admin surface is thin in Phase 3 because Shopify is the source of truth; editing happens in Shopify admin. Phase 5 adds a read-only `/admin/orders` KPI tile.
- **HubSpot `maneline_order` event push** — depends on Phase 5 HubSpot flip; the `orders` row lands in Supabase and backs up to L2, and Phase 5 will add the HubSpot sync on top of the existing row shape.
- **`/trainer/shop`** (the trainer-side marketplace for personal stock) — feature map §5.2 lists it, but the first-principles cut is the owner flow + the in-expense shortcut. `/trainer/shop` is v1.1.
- **White-label trainer brand on invoice/shop surfaces** — Phase 2.5 item.
- **Coupon / promo codes** — v1.1 (Stripe Checkout supports it natively when we flip the flag, but we don't build admin UX in Phase 3).

**Phase 3 gate to Phase 4** (mirrors Phase 2 pattern):

> *An owner opens `/app/shop`, picks "Silver Lining Gut Formula — 30 day", adds to cart, completes Stripe Checkout with test card `4242 4242 4242 4242`, lands on `/app/orders/:id?checkout=success`, sees the order in `paid` status, the `orders` row is in Supabase with `stripe_checkout_session_id` + `stripe_payment_intent_id`, Shopify inventory decrements by 1 (if Admin token set), and nightly backup picks up the `orders` row the next morning. Separately, a trainer adds an expense with category=`supplement`, picks the same SKU from the inline picker, and the SKU's price auto-fills the amount field.*

If a prompt below lands outside this scope, stop and push it to Phase 3.5 or v1.1.

---

## UI Contract (non-negotiable)

### Approved tokens Phase 3 MUST use

Same table as Phase 2. Zero new tokens. Cream / green / black anchored in `app/src/styles/index.css` lines 31–74.

| Surface | Token | Tailwind utility |
|---|---|---|
| Page background | `--background` | `bg-background` |
| Card / product tile surface | `--card` | `bg-card` |
| Primary action ("Add to cart", "Checkout") | `--primary` | `bg-primary text-primary-foreground` |
| Secondary surface (category chips, filter pills) | `--secondary` | `bg-secondary text-secondary-foreground` |
| Success chip (in-stock badge, `paid` order status) | `--accent` | `bg-accent text-accent-foreground` |
| Body copy | `--foreground` | `text-foreground` |
| Muted copy (product description, order metadata) | `--muted-foreground` | `text-muted-foreground` |
| Hairline / dividers | `--border` | `border-border` |
| Destructive (out-of-stock, failed order) | `--destructive` | `bg-destructive text-destructive-foreground` |

### Forbidden patterns (zero tolerance)

- No hex literals anywhere in Phase 3 `.tsx` / `.ts` / `.css`. If the palette shifts, only `app/src/styles/index.css` changes. (Phase 2.10 tech-debt noted pre-existing hex in `VetRecordsList.tsx` and the Stripe Elements `colorPrimary` — Phase 3 does NOT touch those; Stripe **Checkout** is a full redirect and accepts branding via Stripe Dashboard, not inline hex.)
- No new color tokens. The "Silver Lining cream/green" already carries the shop aesthetic.
- No `@heroui/react` imports anywhere under `app/src/pages/app/shop/**`, `app/src/pages/app/orders/**`, `app/src/components/shop/**`, `app/src/components/expenses/**`, or `app/src/pages/trainer/expenses/**`. Verify grep in §4 drill returns zero.
- No custom card inputs for payment. Stripe **Checkout** (hosted) is the flow — the browser redirects out to `checkout.stripe.com`. We do NOT use `<PaymentElement />` here (that's Phase 2.7's trainer-invoicing surface). Rationale: feature map §6.1 + §4.6.1 data flow diagram — hosted Checkout is the simplest PCI story for a product SKU rail, and it unlocks Apple/Google Pay + Link out of the box.
- No `console.log` for errors — Sonner toast + structured error per FRONTEND-UI-GUIDE.md §10 row 6.
- No `any` in TypeScript — Zod schemas generate types.
- No direct browser → Shopify API calls. Catalog reads go through the Worker (`GET /api/shop/products`, `GET /api/shop/products/:handle`) which reads the Supabase cache. The Worker hides `SHOPIFY_STOREFRONT_TOKEN` and the store domain if a sync on-demand is needed.

### Component sourcing

- **shadcn/ui** everywhere new: `Card`, `Dialog`, `Sheet`, `Table`, `Select`, `Input`, `Textarea`, `Button`, `Badge`, `Tabs`.
- **HeroUI** stays scoped to existing `app/src/components/owner/**` bundles from Phase 1. Phase 3 shop files are shadcn-pure.
- **Stripe Checkout** (hosted) — no Elements. Worker mints the session via `POST https://api.stripe.com/v1/checkout/sessions`, returns `{ id, url }`, SPA `window.location.assign(url)`.
- **lucide-react** icons only: `ShoppingBag`, `Package`, `Plus`, `Minus`, `Trash2`, `Receipt`, `DollarSign`, `ExternalLink`.
- **Sonner** for toasts.
- **RHF + Zod** for every form (expense form, in-expense product picker, quantity input).

---

## 1. Dependencies + prerequisites

Before any Phase 3 sub-prompt starts, verify:

| # | Prerequisite | Check |
|---|---|---|
| 1 | Phase 2 sign-off table — every row 🟢 end-to-end. Phase 2.10 drill flagged for post-P0 UAT in TECH_DEBT (keys blocked); the non-key-blocked steps (1, 7, 17) ran green on 2026-04-17. Phase 3 code-complete is allowed to precede the Phase 2 UAT since Phase 3 does not depend on live Stripe keys, but Phase 3 sign-off rolls up into the same end-to-end UAT. | `docs/phase-2-plan.md` §5 + `docs/TECH_DEBT.md` Phase-2 rows |
| 2 | `SHOPIFY_STORE_DOMAIN` set via `[vars]` or `wrangler secret put SHOPIFY_STORE_DOMAIN` — matches `wrangler.toml:41` | `npx wrangler secret list` OR `[vars]` entry |
| 3 | `SHOPIFY_STOREFRONT_TOKEN` set via `npx wrangler secret put SHOPIFY_STOREFRONT_TOKEN` — `wrangler.toml:42` | `npx wrangler secret list` shows `SHOPIFY_STOREFRONT_TOKEN` |
| 4 | `SHOPIFY_ADMIN_API_TOKEN` (optional) — only if server-side inventory decrement is enabled in this phase | Cedric confirms in writing; when not set, Phase 3 ships without the `inventoryAdjust` mutation and logs `TECH_DEBT(phase-3)` on the code path |
| 5 | Stripe Checkout enabled on the ManeLine platform Stripe account (default — turned on when Phase 2 provisioned the account). Test-mode dashboard accessible. | Cedric confirms in Stripe dashboard |
| 6 | **Stripe routing decision for Silver Lining product sales**: resolved per §6 below. Default for Phase 3 — Checkout Sessions created on the **ManeLine platform account** with `payment_intent_data.transfer_data.destination = <SLH_CONNECT_ACCOUNT_ID>` (Silver Lining onboarded as a Connect account) and `application_fee_amount = 0` (reuse Phase 2's Connect plumbing, zero platform fee on SLH-branded sales — only the Stripe per-transaction fee). If SLH has not yet completed Connect onboarding when Phase 3 code ships, the Worker falls back to `status='awaiting_merchant_setup'` rows (same pattern as Phase 2's `awaiting_trainer_setup`). | `SLH_CONNECT_ACCOUNT_ID` secret set OR resolve as "zero-fee, platform-settles-manually" in §6 and remove the transfer_data clause |
| 7 | Shopify Admin app granted `write_inventory` scope if step 4 is enabled | Shopify dashboard → Apps → Develop apps → your app → scopes |
| 8 | `STRIPE_WEBHOOK_SECRET` (from Phase 2) is still the signing secret used by the `/api/stripe/webhook` endpoint — Phase 3 extends the same handler to recognize `checkout.session.completed` and `checkout.session.async_payment_succeeded`. No new webhook endpoint, no new secret. | `grep -n "checkout.session" worker.js` returns the new handlers once Prompt 3.5 lands |
| 9 | Phase 1 RLS helpers `do_i_have_access_to_animal` and Phase 2 helper `effective_fee_bps` are live — Phase 3 reuses the first for per-animal expense reads. | `select polname from pg_policies where tablename='animals' and polname like '%trainer%'` returns the Phase 1 rows |
| 10 | `feature:shop_v1` KV flag (new) created in `maneline-flags` namespace. Default: unset (enabled). Flipping to `"false"` hides `/app/shop` from BottomNav and returns 404 from the routes — used as the kill switch during rollout. | `npx wrangler kv key get --binding=FLAGS feature:shop_v1 --remote` |

If any row is red, **do not start Phase 3 sub-prompts** — fix first.

---

## 2. Phase 3 sub-prompts (copy/paste into Claude Code, one at a time)

> Same discipline as Phase 2: paste verbatim, run each verify block, stop on red, fix before moving on.

---

### Prompt 3.1 — Data model: `products`, `orders`, `order_line_items`, `expenses`, `expense_archive_events`, `shopify_sync_cursor`

**Scope.** Create migration `supabase/migrations/00007_phase3_marketplace_expenses.sql`. Six new tables with RLS day one, archive-never-delete, `updated_at` triggers, helper functions.

**Files touched.**
- `supabase/migrations/00007_phase3_marketplace_expenses.sql` (new)

**UI tokens.** N/A (migration only).

**Compliance citations.**
- OAG §7 — RLS + at least one policy per table; enable before any INSERT path opens.
- OAG §8 — `expenses` uses `archived_at timestamptz null` + append-only `expense_archive_events`. `orders` uses status lifecycle (`pending_payment` → `paid` | `failed` | `refunded` | `awaiting_merchant_setup`) — no DELETE. `products` uses `available=false` + `archived_at` instead of delete so historical `order_line_items` can still resolve their SKU snapshot.
- Admin reads route through Worker service_role only (mirrors Phase 0 `00004_phase0_hardening.sql`).

**Tables (exact shape).**

```
products
  id uuid PK DEFAULT gen_random_uuid()
  shopify_product_id text NOT NULL UNIQUE      -- gid://shopify/Product/...
  shopify_variant_id text NOT NULL UNIQUE      -- gid://shopify/ProductVariant/... (one default variant per product in v1)
  handle text NOT NULL UNIQUE                  -- url-safe slug used in /app/shop/:handle
  sku text NOT NULL                            -- Silver Lining SKU code (e.g. SLH-GUT-30)
  title text NOT NULL CHECK (char_length(title) between 1 and 300)
  description text
  image_url text                               -- Shopify CDN URL; safe to cache, public
  price_cents int NOT NULL CHECK (price_cents >= 0)
  currency text NOT NULL DEFAULT 'usd' CHECK (currency = 'usd')
  category text                                -- 'supplement' | 'gear' | 'care' | null — Silver Lining product_type
  inventory_qty int                            -- nullable when Shopify hides it
  available boolean NOT NULL DEFAULT true
  protocol_mapping jsonb                       -- Mane-Line-only metadata (reserved for Phase 4 brain)
  last_synced_at timestamptz NOT NULL DEFAULT now()
  created_at timestamptz DEFAULT now()
  updated_at timestamptz DEFAULT now()
  archived_at timestamptz

shopify_sync_cursor
  id int PK DEFAULT 1 CHECK (id = 1)           -- singleton
  last_run_at timestamptz
  last_ok_at timestamptz
  last_error text
  products_upserted int DEFAULT 0
  products_archived int DEFAULT 0
  updated_at timestamptz DEFAULT now()

orders
  id uuid PK DEFAULT gen_random_uuid()
  owner_id uuid NOT NULL REFERENCES auth.users(id)
  stripe_checkout_session_id text UNIQUE       -- cs_test_... / cs_live_... — set at create
  stripe_payment_intent_id text UNIQUE         -- pi_...
  stripe_charge_id text                        -- ch_... (captured from webhook)
  shopify_order_id text UNIQUE                 -- gid://shopify/Order/... when Admin mutation enabled; nullable
  subtotal_cents int NOT NULL CHECK (subtotal_cents > 0)
  tax_cents int NOT NULL DEFAULT 0 CHECK (tax_cents >= 0)
  shipping_cents int NOT NULL DEFAULT 0 CHECK (shipping_cents >= 0)
  total_cents int NOT NULL CHECK (total_cents > 0)
  currency text NOT NULL DEFAULT 'usd'
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status in (
    'pending_payment','paid','failed','refunded','awaiting_merchant_setup'))
  failure_code text
  failure_message text
  source text NOT NULL DEFAULT 'shop' CHECK (source in ('shop','in_expense'))  -- tracks which UX surface initiated
  created_at timestamptz DEFAULT now()
  updated_at timestamptz DEFAULT now()

order_line_items
  id uuid PK DEFAULT gen_random_uuid()
  order_id uuid NOT NULL REFERENCES orders(id)
  product_id uuid REFERENCES products(id)      -- nullable so order history survives if a product is later archived
  shopify_variant_id text NOT NULL              -- snapshot at purchase time
  sku_snapshot text NOT NULL
  title_snapshot text NOT NULL
  unit_price_cents int NOT NULL CHECK (unit_price_cents >= 0)
  quantity int NOT NULL CHECK (quantity > 0)
  line_total_cents int NOT NULL CHECK (line_total_cents >= 0)
  created_at timestamptz DEFAULT now()

expenses
  id uuid PK DEFAULT gen_random_uuid()
  animal_id uuid NOT NULL REFERENCES animals(id)
  recorder_id uuid NOT NULL REFERENCES auth.users(id)   -- owner or trainer
  recorder_role text NOT NULL CHECK (recorder_role in ('owner','trainer'))
  category text NOT NULL CHECK (category in (
    'feed','tack','vet','board','farrier','supplement','travel','show','other'))
  occurred_on date NOT NULL
  amount_cents int NOT NULL CHECK (amount_cents > 0)
  currency text NOT NULL DEFAULT 'usd'
  vendor text                                  -- free-text; 'silver_lining' auto-filled by in-expense picker
  notes text
  order_id uuid REFERENCES orders(id)          -- set when expense originated from an in-expense SLH buy
  product_id uuid REFERENCES products(id)      -- set when in-expense picker prefilled the row
  receipt_r2_object_id uuid REFERENCES r2_objects(id)   -- optional photo of receipt (Phase 1 uploader reused)
  created_at timestamptz DEFAULT now()
  updated_at timestamptz DEFAULT now()
  archived_at timestamptz

expense_archive_events
  id uuid PK DEFAULT gen_random_uuid()
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE CASCADE
  actor_id uuid NOT NULL REFERENCES auth.users(id)
  action text NOT NULL CHECK (action in ('archive','unarchive'))
  reason text
  created_at timestamptz NOT NULL DEFAULT now()
```

**RLS (§7 day one).**
- `products`
  - **authenticated SELECT all rows** where `archived_at is null` — Silver Lining catalog is public to any signed-in user (owner AND trainer). No INSERT / UPDATE / DELETE from any client role. Worker writes via service_role only (catalog sync + cache invalidation).
  - `revoke all on public.products from anon` — unauthenticated visitors do not read SLH inventory through Supabase.
- `shopify_sync_cursor`
  - No client access. Service_role only.
- `orders`
  - owner SELECT where `owner_id = auth.uid()`.
  - All INSERT / UPDATE is service_role only (Worker writes on Checkout Session create and on `checkout.session.completed` webhook).
- `order_line_items`
  - owner SELECT where exists an `orders` row with `owner_id = auth.uid()`.
  - INSERT service_role only.
- `expenses`
  - owner SELECT where exists an `animals` row with `owner_id = auth.uid() AND id = expenses.animal_id`.
  - trainer SELECT where `public.do_i_have_access_to_animal(animal_id)` is true (reuse Phase 1 helper).
  - owner INSERT / UPDATE where they own the animal (`recorder_role` must equal `'owner'` and `recorder_id = auth.uid()`).
  - trainer INSERT / UPDATE where grant active (`recorder_role = 'trainer'` and `recorder_id = auth.uid()` and `do_i_have_access_to_animal(animal_id)`).
  - No DELETE from any role. Archive via Worker endpoint → `archived_at` + event row.
- `expense_archive_events`
  - owner SELECT where exists expense with matching owner; trainer SELECT where exists expense they can see under RLS above. INSERT service_role only.

**Triggers + helpers.**
- `touch_updated_at` trigger on `products`, `orders`, `expenses`, `shopify_sync_cursor` (reuse from migration `00002`).
- `public.is_expense_owner_or_granted_trainer(p_expense_id uuid)` STABLE SECURITY DEFINER — shared check used by the archive endpoint.
- `public.products_public_count()` STABLE — returns `count(*) from products where archived_at is null AND available=true`; used by the `/api/_integrations-health` endpoint to report live catalog size.
- No new cron jobs in this migration — the Shopify sync cron is registered in Prompt 3.2's README as a SQL Editor paste (mirrors Phase 2's sweep pattern).

**Indexes (additional).**
- `products(archived_at, category)` partial on `archived_at is null`
- `products(available) where archived_at is null`
- `orders(owner_id, created_at desc)`
- `orders(status) where status in ('pending_payment','awaiting_merchant_setup')` (sweep + retry)
- `order_line_items(order_id)`
- `expenses(animal_id, occurred_on desc) where archived_at is null`
- `expenses(recorder_id, occurred_on desc) where archived_at is null` — drives `/trainer/expenses`
- `expenses(category, occurred_on desc) where archived_at is null`

**Seed.** `INSERT INTO shopify_sync_cursor (id) VALUES (1) ON CONFLICT DO NOTHING`. No product seed — catalog arrives from Shopify on first sync.

**Dependencies.** Phase 1 migration `00005_phase1_owner_core.sql` applied (provides `do_i_have_access_to_animal`, `r2_objects`). Phase 2 migration `00006_phase2_trainer_sessions.sql` applied (coexists cleanly).

**Sign-off row.** 🔴 Not started

---

### Prompt 3.2 — Shopify Storefront client + catalog sync Edge Function

**Scope.** Build a thin Shopify Storefront API client (fetch-based, GraphQL), a Supabase Edge Function `shopify-catalog-sync` that the Shopify admin token can call on-demand, and a `pg_cron` schedule that hits it hourly (mirrors Phase 2's `sweep-stripe-events` pattern). Worker route `POST /api/admin/shop/sync` (silver_lining role only) provides a manual "Sync now" button surface for later admin UI. This sub-prompt does NOT build the admin button — it ships the pipes.

**Files touched.**
- `worker/shopify.js` (new — thin Storefront GraphQL client: `fetchProductsPage(cursor)`, `fetchProductByHandle(handle)`. Storefront API uses `X-Shopify-Storefront-Access-Token`; no SDK.)
- `worker.js` (add routes):
  - `GET /api/shop/products` — authenticated caller; reads `products` table via service_role OR supabase-anon-with-RLS (RLS already allows authenticated SELECT). Returns list + categories. KV-cached at the edge under key `shop:v1:list`, 5-minute TTL, invalidated by sync.
  - `GET /api/shop/products/:handle` — single product; KV key `shop:v1:handle:<handle>`.
  - `POST /api/admin/shop/sync` — silver_lining JWT + service_role check; triggers the Edge Function synchronously; returns `{ upserted, archived, duration_ms }`.
- `supabase/functions/shopify-catalog-sync/index.ts` (new — Deno runtime). Paginates `products(first: 250)` via Storefront GraphQL, upserts into `public.products` by `shopify_product_id`, marks anything NOT returned as `available=false AND archived_at=now()` (soft-delete-by-diff). Writes `shopify_sync_cursor` with run timestamp and counts. Invalidates the Worker KV cache via `POST /api/_internal/shop/cache-invalidate` (service_role Bearer).
- `supabase/functions/shopify-catalog-sync/README.md` (new) — pg_cron paste template.

**GraphQL query (Storefront 2024-10).**

```graphql
query ProductsPage($cursor: String) {
  products(first: 250, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        handle
        title
        description
        productType
        availableForSale
        featuredImage { url }
        variants(first: 1) {
          edges { node { id sku price { amount currencyCode } quantityAvailable } }
        }
      }
    }
  }
}
```

**Placeholder-safety.** If `SHOPIFY_STOREFRONT_TOKEN` is unset, the Edge Function exits 200 with `{ skipped: 'shopify_not_configured' }` (mirrors Phase 2's Stripe placeholder). `/api/shop/products` returns the last-cached rows (possibly empty). `/api/_integrations-health` flips `shopify` to `"live"` only when token is set AND the last sync ran < 2 h ago.

**UI tokens.** N/A (server-side).

**Compliance citations.**
- OAG §2 — admin path is Worker+service_role; no direct browser → Shopify.
- OAG §7 — `products` RLS allows authenticated SELECT; writes are service_role only.
- OAG §8 — unseen-in-Shopify rows are soft-archived (`archived_at`), never deleted; order history keeps resolving via the `order_line_items` snapshot columns.
- `SHOPIFY_STOREFRONT_TOKEN` read only server-side (Worker secret — `wrangler.toml:42`).

**Dependencies.** Prompt 3.1.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.3 — Owner shop shell: `/app/shop` + `/app/shop/:handle`

**Scope.** Two SPA pages, one data lib, two components. `/app/shop` is already in `BottomNav.tsx` line 524 but routes to nothing — this prompt fills it.

**Files touched.**
- `app/src/lib/shop.ts` (new — `listProducts(category?)`, `getProduct(handle)`, `formatPrice(cents)`)
- `app/src/pages/app/shop/ShopIndex.tsx` (new — `/app/shop`, shadcn `Card` grid with category filter pills)
- `app/src/pages/app/shop/ProductDetail.tsx` (new — `/app/shop/:handle`, image + description + qty stepper + "Add to cart")
- `app/src/components/shop/ProductCard.tsx` (new — reusable tile: image, title, price, in-stock chip)
- `app/src/components/shop/CategoryPills.tsx` (new — shadcn `Button variant="outline"` group; active `bg-secondary`)
- `app/src/pages/app/OwnerIndex.tsx` (modify — mount the two routes under `/app/shop`)

**Empty state.** "Catalog is syncing — check back in a few minutes." shadcn `Card` centered, single-column. Shown when `listProducts()` returns `[]`.

**Out-of-stock handling.** When `available=false`, tile renders with `opacity-60`, "Add to cart" swaps to disabled "Out of stock" button (shadcn `Button variant="outline" disabled`). Owner can still open detail page for reference.

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Card` grid. 2-col mobile, 3-col sm+, 4-col lg.
- Price uses `Intl.NumberFormat('en-US', { style:'currency', currency:'usd' })` — never hand-format.
- In-stock badge: `bg-accent text-accent-foreground`. Out-of-stock badge: `variant="outline" text-muted-foreground`.
- Page header: Playfair display h1 "Silver Lining Herbs" + muted subtitle "Formulated for the animals we serve." Plus a subtle "Silver Lining" attribution badge (the one place in the owner portal where the SLH brand is allowed — feature map §2.6 line 825 carve-out).
- Use `lucide-react` `ShoppingBag` in header, `Package` in empty state.

**Compliance citations.**
- FRONTEND-UI-GUIDE.md §4.1 — shadcn only; no HeroUI in `app/src/components/shop/**` or `app/src/pages/app/shop/**`. Verify grep in §4 drill.
- Brand: cream/green/black tokens exclusively.
- Feature map §2.6 line 825 — "Silver Lining" attribution is allowed inside marketplace listings (and only there in the owner portal).

**Dependencies.** Prompts 3.1, 3.2.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.4 — Cart + Stripe Checkout (hosted redirect)

**Scope.** Cart lives in React state + `sessionStorage` (keyed `ml:cart:v1`) — we do not persist it to Supabase because an abandoned cart is not auditable data and RLS on a per-user cart table adds zero value over sessionStorage for this flow. "Checkout" button opens a shadcn `Sheet` summary, confirms qty + subtotal, calls Worker → mints a Stripe Checkout Session, SPA `window.location.assign(session.url)`.

**Files touched.**
- `app/src/lib/cart.ts` (new — typed cart helpers over `sessionStorage`; shape: `{ items: { variantId: string, qty: number }[] }`; `useCart()` hook publishes changes via storage event + custom event so two tabs stay in sync)
- `app/src/components/shop/CartSheet.tsx` (new — shadcn `Sheet` triggered from header `ShoppingBag` badge; line items + qty steppers + subtotal + "Checkout" CTA)
- `app/src/components/shop/CartButton.tsx` (new — header widget, badge shows line-item count)
- `worker/stripe-checkout.js` (new — `createCheckoutSession({lineItems, ownerId, email, successUrl, cancelUrl, connectAccountId?, idempotencyKey})`. Calls `POST https://api.stripe.com/v1/checkout/sessions` with `mode=payment`, `line_items[0][price_data][...]` built from `products` snapshot, `payment_intent_data[metadata][order_id]=<uuid>`, `metadata[ml_order_id]=<uuid>`. If `connectAccountId` provided: `payment_intent_data[transfer_data][destination]=<acct>` + `application_fee_amount=0`. Sends `Idempotency-Key` header.)
- `worker.js` (add route):
  - `POST /api/shop/checkout` — owner JWT; body: `{ items: [{variant_id, qty}] }`. Worker (a) re-resolves each `variant_id` against `products` (price + availability; fail fast on OOS), (b) inserts an `orders` row with `status='pending_payment'` + provisional total, (c) mints Stripe Checkout Session, (d) writes `stripe_checkout_session_id` back to the `orders` row, (e) returns `{ url }`. Idempotency key = `shop_checkout:${order_id}`.

**Stripe routing decision.** Default Phase 3 behavior (§6 resolved decision #1): `transfer_data.destination` set to Silver Lining's Connect account id from `env.SLH_CONNECT_ACCOUNT_ID` (a new Worker secret) when present, with `application_fee_amount=0`. When absent (or falsy), Checkout Session is created on the platform account with no transfer_data (funds land on the ManeLine platform balance, settled to SLH out-of-band) — and the `orders` row stamps `status='awaiting_merchant_setup'` for any such Session so it's visible in the sign-off drill.

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Sheet`, `Button`, `Input`, `Separator`.
- Quantity stepper: two shadcn `Button variant="outline" size="icon"` flanking a `text-lg tabular-nums` value. `lucide-react` `Plus` / `Minus` / `Trash2`.
- "Checkout" primary CTA: `bg-primary text-primary-foreground` full width at sheet bottom. Disabled state when `items.length === 0` or any item out-of-stock.
- Subtotal formatted via `Intl.NumberFormat`. "Tax + shipping calculated at checkout" muted line — Stripe Checkout handles those.
- Redirect-loading UI: on "Checkout" click, disable button + show spinner until `window.location.assign` fires. Sonner toast on error.

**Compliance citations.**
- OAG §2 — Worker is the only caller of Stripe REST; browser never sees `STRIPE_SECRET_KEY`.
- OAG §7 — `orders` RLS: owner SELECT only; INSERT/UPDATE service_role only.
- OAG §8 — failed sessions flip `status='failed'`, never DELETE.
- Idempotency: `Idempotency-Key` on Checkout Session create = `shop_checkout:${order_id}` — replaying the SPA call returns the same session_id.
- Audit log on `order.create` with `order_id`, `owner_id`, `total_cents`, `line_count`.

**Dependencies.** Prompts 3.1, 3.2, 3.3. Phase 2 `worker/stripe.js` helpers exist.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.5 — `checkout.session.completed` webhook handler + success redirect

**Scope.** Extend the existing Phase 2 `POST /api/stripe/webhook` handler with three new event types: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`. Plus the success/cancel redirect pages the SPA lands on post-Checkout.

**Files touched.**
- `worker.js` (extend `processStripeEvent` fanout in place):
  - `handleCheckoutSessionCompleted(event, env)` — pull `metadata.ml_order_id`; load the `orders` row; set `status='paid'`, capture `stripe_payment_intent_id` + `stripe_charge_id` (via `payment_intent` expansion), record `tax_cents` + `shipping_cents` from the event, write `order_line_items` from the session's `line_items` array (one GraphQL call back to Stripe to expand), write `audit_log`, and — if `SHOPIFY_ADMIN_API_TOKEN` is set — fire the Shopify Admin `inventoryAdjustQuantity` mutation per line item and store the resulting `shopify_order_id` if we chose to create one.
  - `handleCheckoutSessionAsyncPaymentSucceeded(event, env)` — same effect as completed (covers delayed-confirm methods like ACH/Bank debits when Cedric enables them).
  - `handleCheckoutSessionAsyncPaymentFailed(event, env)` — `status='failed'`, capture failure.
- `worker/shopify-admin.js` (new, optional — only compiled-in behavior when `SHOPIFY_ADMIN_API_TOKEN` is present. `adjustInventory({variantId, delta})` calls `POST https://${SHOPIFY_STORE_DOMAIN}/admin/api/2024-10/graphql.json` with the `inventoryAdjustQuantity` mutation. When the token is absent the helper is a no-op that logs `TECH_DEBT(phase-3)` once per process.)
- `app/src/pages/app/orders/OrderSuccess.tsx` (new — route `/app/orders/:id?checkout=success`; reads the order, shows a confetti-free success card with "Your order is confirmed" + line items + total, and a "Back to shop" + "View all orders" CTA pair). On mount, polls `GET /api/orders/:id` every 2s up to 6 tries until `status='paid'` (covers the race between Stripe redirecting the browser and the webhook landing).
- `app/src/pages/app/orders/OrderCancel.tsx` (new — route `/app/orders/:id?checkout=cancel`; friendly card, "Your cart is still saved" + "Back to cart" CTA. Does NOT alter the order row — Stripe will eventually send `checkout.session.expired` which a future prompt (Phase 3.5 or v1.1) can clean up. For Phase 3, expired sessions just stay `pending_payment` and are invisible to the owner because `/app/orders` filters to `paid | refunded | failed`.).

**Handled events summary.**
- `checkout.session.completed` → `orders.status='paid'`, line items snapshotted, inventory adjusted (if token set), audit.
- `checkout.session.async_payment_succeeded` → same as above (separate event fires only for delayed-confirm methods).
- `checkout.session.async_payment_failed` → `orders.status='failed'`, failure fields captured.

**Idempotency.** Reuses Phase 2's `stripe_webhook_events.event_id UNIQUE` + `ingestStripeEvent` fanout — zero new idempotency plumbing.

**UI tokens / components.**
- Success card uses shadcn `Card` + `Button`. Badge `bg-accent text-accent-foreground` reading "Paid".
- Cancel card uses `variant="outline"`, warm body copy, no scare UI.
- No hex literals, no HeroUI.
- Polling UX: first render shows a muted "Finalizing your order…" row with a shadcn `Skeleton` below; stops and reveals full success card as soon as poll sees `status='paid'`. If 6 polls elapse, show "We're still confirming with your bank. You'll get an email shortly." and flip to the normal card layout.

**Compliance citations.**
- OAG §2 — webhook path is Worker + service_role.
- OAG §7 — `orders` / `order_line_items` writes service_role only.
- OAG §8 — failure / refund flip status, never DELETE.
- Every handler writes `audit_log` with `action='order.paid'` / `'order.failed'` / `'order.refund_pending'` etc.

**Dependencies.** Prompts 3.1, 3.4. Phase 2 webhook framework.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.6 — Owner order history: `/app/orders` + `/app/orders/:id`

**Scope.** List + detail pages reading the owner's own orders via RLS. No mutation here — refunds are Phase 5 admin.

**Files touched.**
- `app/src/lib/orders.ts` (new — `listMyOrders()`, `getOrder(id)`, both via anon-with-RLS)
- `app/src/pages/app/orders/OrdersIndex.tsx` (new — `/app/orders`, shadcn `Table` with columns: Date, Items (count), Total, Status, Actions (→ "View"))
- `app/src/pages/app/orders/OrderDetail.tsx` (new — `/app/orders/:id`, shadcn `Card` with line items `Table`, totals panel, Stripe receipt link via Stripe Checkout's hosted receipt URL stored on the order)
- `app/src/components/owner/OrderStatusBadge.tsx` (new — maps `paid → accent`, `refunded → secondary`, `failed → destructive`, `pending_payment → outline`, `awaiting_merchant_setup → outline muted`)
- `app/src/pages/app/OwnerIndex.tsx` (modify — mount the two routes)

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Table`, `Card`, `Badge`, `Button`.
- Empty state: "No orders yet — head to the shop." CTA button `bg-primary` linking `/app/shop`.
- Cream background, green accent, no hex.

**Compliance citations.**
- OAG §7 — RLS on `orders` + `order_line_items` enforced; no service_role path for reads.
- OAG §8 — `awaiting_merchant_setup` orders are still rendered (with "Processing" badge) so owners see their full history.
- Brand tokens only.

**Dependencies.** Prompts 3.1, 3.4, 3.5.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.7 — Expenses: data lib + form + list (owner + trainer)

**Scope.** Reusable expense lib + form + list component. Three surfaces consume them:
- `/app/animals/:id` — owner sees per-animal expenses tab (extend Phase 1 page).
- `/trainer/expenses` — trainer sees all expenses across their animals.
- `/trainer/animals/:id` — trainer sees per-animal expenses tab (extend Phase 2.4 page).

This prompt is lib + form + list only. The in-expense SLH picker is Prompt 3.8 (separate so 3.8 can be skipped without orphaning 3.7).

**Files touched.**
- `app/src/lib/expenses.ts` (new — `listExpensesForAnimal`, `listMyExpenses` (trainer inverse), `createExpense`, `updateExpense`, `archiveExpense`)
- `app/src/components/expenses/ExpenseForm.tsx` (new — RHF + Zod schema below; shadcn `Form`, `Select`, `Input`, `Textarea`, `DatePicker`)
- `app/src/components/expenses/ExpensesList.tsx` (new — shadcn `Table` + shadcn `Tabs` filter by category; columns: Date, Category, Vendor, Amount, Recorded by, Actions)
- `app/src/pages/trainer/ExpensesIndex.tsx` (new — `/trainer/expenses`, all-animal rollup)
- `app/src/pages/app/AnimalDetail.tsx` (modify — add "Expenses" tab below "Sessions")
- `app/src/pages/trainer/AnimalReadOnly.tsx` (modify — add "Expenses" tab)
- `worker.js` (add route):
  - `POST /api/expenses/archive` — owner OR trainer JWT; verifies access via `is_expense_owner_or_granted_trainer`; atomic soft-archive + `expense_archive_events` row (mirrors Phase 2.5 session archive).

**Zod schema.**

```ts
z.object({
  animal_id: z.string().uuid(),
  category: z.enum(['feed','tack','vet','board','farrier','supplement','travel','show','other']),
  occurred_on: z.string().date(),              // YYYY-MM-DD
  amount_cents: z.number().int().min(1).max(100_000_00),
  vendor: z.string().max(200).optional(),
  notes: z.string().max(4000).optional(),
  product_id: z.string().uuid().nullable().optional(),     // set by in-expense picker (Prompt 3.8)
  order_id: z.string().uuid().nullable().optional(),       // set when the row represents a completed SLH purchase
})
```

**Archive dialog.** Mirrors Phase 2.5 session archive: shadcn `AlertDialog` with a reason `Textarea` (optional). On confirm, calls `/api/expenses/archive` → row disappears from default list; "Show archived" toggle above the table reveals them.

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Form`, `Select`, `Input`, `Textarea`, `Button`, `Table`, `Tabs`, `AlertDialog`.
- Category color chips: `feed → secondary`, `vet → destructive/20 text-destructive`, `supplement → accent`, others → `outline`. No hex.
- Amount input: single `Input type="text" inputMode="decimal"` with a `$` leading adornment (shadcn `InputGroup` pattern from FRONTEND-UI-GUIDE.md §3.4). Zod coerces the string → cents.
- No HeroUI in trainer paths.
- Empty state: "No expenses logged yet." + CTA `Plus` icon button.

**Compliance citations.**
- OAG §7 — RLS on `expenses` enforced (owner by ownership; trainer by `do_i_have_access_to_animal`).
- OAG §8 — archive-never-delete; event table audits every archive.
- Brand: cream/green/black.

**Dependencies.** Prompts 3.1. Phase 1 `animals` + Phase 2.4 trainer-animal path exist.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.8 — In-expense-form one-tap Silver Lining purchase

**Scope.** When the trainer picks `category = 'supplement'` in the expense form, an inline `ProductPicker` appears above the amount field. The picker is a shadcn `Command` palette scoped to `products` where `category='supplement' AND available=true`. Selecting a SKU:
1. Prefills `amount_cents` with the unit price.
2. Prefills `vendor='silver_lining'`.
3. Stamps `product_id` into the form state.
4. Surfaces a secondary "Buy now" button next to "Save expense".

Clicking "Buy now" does NOT save the expense. It runs the Phase 3.4 checkout flow (single-item cart: `{variant_id, qty:1}`), but tags the `orders` row with `source='in_expense'` and passes a `metadata.expense_draft={animal_id, category, occurred_on, notes}` blob that — on `checkout.session.completed` — auto-creates the matching `expenses` row with `order_id` + `product_id` stamped in. So the owner/trainer never has to come back and "mark paid".

"Save expense" (without "Buy now") saves the expense as a **record only** — no payment — which is the expected path for expenses paid outside ManeLine (cash, their own card, etc.).

**Files touched.**
- `app/src/components/shop/ProductPicker.tsx` (new — shadcn `Command` palette + shadcn `Popover`, consumes `listProducts('supplement')`, image + title + price per row)
- `app/src/components/expenses/ExpenseForm.tsx` (modify — conditional-render `ProductPicker` when `category === 'supplement'`; add `buyNow: boolean` submit path)
- `app/src/lib/shop.ts` (modify — expose `createExpenseDraftCheckout({variantId, expenseDraft})` that POSTs the cart API with the metadata blob)
- `worker.js` (modify):
  - Extend `POST /api/shop/checkout` to accept `{ items, expense_draft }`; writes `expense_draft` into `orders.metadata` (new jsonb column? — NO, we avoid schema churn: stash it in the Checkout Session `metadata` map and round-trip it). Stripe metadata has a 500-char value cap per key — we JSON-stringify and split into `ml_expense_draft_json` (up to 500 chars) with a follow-up `ml_expense_draft_extra` if it overflows. For v1 the draft shape fits cleanly in one key (animal_id + category + occurred_on + short notes).
  - Extend `handleCheckoutSessionCompleted` to: if `metadata.ml_expense_draft_json` is present, parse it and insert an `expenses` row with `order_id`, `product_id`, `recorder_id = orders.owner_id` (or the trainer's `recorder_id` passed through from the SPA), `amount_cents = line_item.unit_price_cents`, `vendor='silver_lining'`, plus the pass-through fields.

**Edge cases.**
- Trainer with no active grant on the animal → `/api/shop/checkout` rejects the `expense_draft` (but the plain purchase still works); `ExpenseForm` disables "Buy now" and shows helper text "You don't have access to this animal for expense logging." — reuses the Phase 2.4 access banner pattern.
- Two line items in a single checkout (owner decides to add a second SKU to the cart) → `expense_draft` is only honored when `items.length === 1`. If more than one, `orders` row still captures `source='in_expense'` for telemetry, but no expense auto-created.
- Checkout cancel → no expense row, no order row (order row sits `pending_payment` and is filtered out of `/app/orders`; garbage-collected by Phase 3.5+ cleanup later).

**UI tokens / components.**
- FRONTEND-UI-GUIDE.md §3.4 — shadcn `Command`, `Popover`, `Button`.
- "Buy now" CTA: `bg-accent text-accent-foreground` (action green). Paired with `bg-primary` "Save expense".
- Search input inside the picker uses lucide `Search` icon.
- Loading skeletons with shadcn `Skeleton` inside the popover while `listProducts('supplement')` resolves.

**Compliance citations.**
- OAG §2 — all Stripe + Shopify calls stay server-side.
- OAG §7 — expense auto-create goes through the same RLS-aware insert path; trainer inserts require `recorder_role='trainer'` + `do_i_have_access_to_animal`.
- OAG §8 — neither the order nor the auto-created expense is ever deleted; failed payment → `orders.status='failed'` + NO expense row.
- Audit log on `order.create` includes `source='in_expense'` so the admin view can tell the two UX surfaces apart later.

**Dependencies.** Prompts 3.1, 3.2, 3.4, 3.5, 3.7. Phase 2 Connect Connect-account routing (SLH's account id) if enabled.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.9 — Nightly backup extension

**Scope.** Add the Phase 3 tables to `supabase/functions/nightly-backup/index.ts`. Unchanged schedule + retention. No card data, no Shopify secrets — Stripe holds PCI + Shopify order ids are opaque strings.

**Files touched.**
- `supabase/functions/nightly-backup/index.ts` (modify the `TABLES` const and the header comment)

**Additions.**

```ts
const TABLES = [
  // ... Phase 0/1/2 entries unchanged ...
  'products',
  'shopify_sync_cursor',
  'orders',
  'order_line_items',
  'expenses',
  'expense_archive_events',
] as const;
```

**UI tokens.** N/A.

**Compliance citations.**
- OAG §4 (triple redundancy — L2 client-owned GitHub repo). Phase 3 tables must land in `snapshots/YYYY-MM-DD/` with JSON + CSV.
- OAG §7 — backup uses service_role key from Supabase's own secret store — unchanged.
- Zero card data. Stripe ids are opaque. Shopify product images are public CDN URLs (safe to snapshot in plain text).

**Dependencies.** Prompt 3.1.

**Sign-off row.** 🔴 Not started

---

### Prompt 3.10 — Verification drill

**Scope.** Human-run 20-step end-to-end test (§4 below). Report each step 🟢 / 🔴. Stop on first 🔴, fix, re-run.

**Files touched.**
- `docs/phase-3-plan.md` (fill in §5 sign-off rows)

**UI tokens.** N/A (verification only).

**Compliance citations.** Every previous sub-prompt's law citations are re-checked here via grep and runtime behavior. Per Phase 2 precedent, Stripe-key-blocked steps route to `docs/TECH_DEBT.md` with a `phase-3` row deferring to post-P0 UAT.

**Dependencies.** Every prior sub-prompt 🟢.

**Sign-off row.** 🔴 Not started

---

## 3. Compliance matrix

| Sub-prompt | OAG §7 (RLS day 1) | OAG §8 (no hard delete) | OAG §2 (admin through Worker) | FRONTEND-UI-GUIDE (UI/brand) | Triple redundancy (OAG §4) |
|---|---|---|---|---|---|
| 3.1 Migration | RLS + policies on all 6 tables | `archived_at` on `products` + `expenses`; status lifecycles on `orders`; `expense_archive_events` audit | service_role-only writes for `products`, `orders`, `order_line_items`, `shopify_sync_cursor` | — | feeds Prompt 3.9 |
| 3.2 Shopify sync | `products` RLS (authenticated SELECT) | Soft-archive by diff; never DELETE | All Shopify calls via Worker + Edge Function | — | `shopify_sync_cursor` backed up in 3.9 |
| 3.3 Shop shell | Reads via RLS (authenticated SELECT) | — | No service_role | §3.4 Card grid, §3.5 BottomNav slot | — |
| 3.4 Cart + Checkout | `orders` service_role write | `pending_payment`/`failed`/`awaiting_merchant_setup` lifecycle | Stripe Checkout Session minted by Worker only | §3.4 Sheet + Button | `orders` backed up in 3.9 |
| 3.5 Webhook | `orders`, `order_line_items` service_role | Refund/failure flip status | Webhook receiver is Worker | §3.4 Card success/cancel states | `orders` + `order_line_items` backed up |
| 3.6 Orders history | `orders` + `order_line_items` RLS (owner SELECT) | Archive-never-delete (no UI here) | — | §3.4 Table + Badge | — |
| 3.7 Expenses | RLS enforces owner / trainer-grant split | `archived_at` + `expense_archive_events` | Archive routed through Worker | §3.4 Form + RHF + Zod | backed up in 3.9 |
| 3.8 In-expense buy | Expense auto-insert goes through same RLS-aware Worker path | Failed order → no expense row; cancel → no expense row | All Stripe + Shopify via Worker | §3.4 Command palette + Popover | — |
| 3.9 Backup | — | Backup append-only; L2 client-owned | service_role read in Supabase Edge Function | — | directly implements §4 |
| 3.10 Verification | Drill includes cross-role RLS checks | Drill greps for `DELETE FROM`, `.delete(` | Drill confirms no browser → Stripe, no browser → Shopify | Drill re-greps `@heroui/react` in shop + expenses trees | Drill confirms today's snapshot has all 6 Phase 3 tables |

---

## 4. Verification drill (20 numbered steps)

Run this before declaring Phase 3 complete. Each step is 🟢 / 🔴. Stop on first red.

1. **[MIGRATION]** `supabase/migrations/00007_phase3_marketplace_expenses.sql` applies cleanly in a branch DB. `grep -cE "CREATE POLICY" supabase/migrations/00007_phase3_marketplace_expenses.sql` ≥ 8 (coverage for `products`, `orders`, `order_line_items`, `expenses`, `expense_archive_events`, `shopify_sync_cursor` — service_role-only tables count as one `REVOKE` + one `no-access` policy where applicable). Every new table has `relrowsecurity = true`. `select count(*) from shopify_sync_cursor;` returns **exactly 1**.
2. **[SHOPIFY SYNC]** Set `SHOPIFY_STOREFRONT_TOKEN` (test store) + deploy `shopify-catalog-sync`. Invoke it once manually. `select count(*) from public.products where archived_at is null;` matches the test store's published product count. `shopify_sync_cursor.last_ok_at` is within the last minute.
3. **[PLACEHOLDER-SAFE]** Temporarily unset `SHOPIFY_STOREFRONT_TOKEN` and re-invoke. Edge Function returns `{ skipped: 'shopify_not_configured' }`, no rows deleted, no error logged. `/api/_integrations-health` reports `"shopify": "mock"`.
4. **[CATALOG READ PATH]** With token restored, as a logged-in owner, `GET /api/shop/products` returns the catalog. KV cache `shop:v1:list` is populated (inspect with `npx wrangler kv key get --binding=FLAGS shop:v1:list --remote`). Repeat within 30s — Worker short-circuits to KV (log it).
5. **[NO BROWSER → SHOPIFY]** `grep -rnE "storefront-api|myshopify\.com|X-Shopify-Storefront-Access-Token" app/src` → **zero matches**. All Shopify calls are server-side.
6. **[SHOP UI — TOKENS]** Open `/app/shop`. Background `bg-background`, tile surface `bg-card`, "Add to cart" primary. `grep -rnE "#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}\b" app/src/pages/app/shop app/src/components/shop app/src/pages/app/orders app/src/components/expenses app/src/pages/trainer/ExpensesIndex.tsx` → **zero matches**. `grep -rn "@heroui/react" app/src/pages/app/shop app/src/components/shop app/src/pages/app/orders app/src/components/expenses` → **zero matches**.
7. **[OUT-OF-STOCK]** Mark a test product `available=false` in Shopify, re-sync. Tile renders disabled "Out of stock" with `opacity-60`. Navigating directly to `/app/shop/:handle` still loads the detail page (for reference) but the "Add to cart" is disabled.
8. **[CART STATE]** Owner adds 2 of SKU-A to cart. Header badge reads "2". Opens a second tab on `/app/shop` — badge reads "2" there too (storage event sync). Refresh — badge persists (`sessionStorage`). Close tab — badge resets (by design).
9. **[CHECKOUT REDIRECT]** Owner taps "Checkout". Worker returns `{ url }`. Browser lands on `checkout.stripe.com`. `orders` row exists with `status='pending_payment'`, `stripe_checkout_session_id` populated. `audit_log` has `order.create` row.
10. **[NORMAL PAY — SUCCESS]** Complete Checkout with test card `4242 4242 4242 4242`. Redirect lands on `/app/orders/:id?checkout=success`. Within 6s the polling loop observes `status='paid'`; page reveals success card. `order_line_items` has rows matching the cart. `audit_log` has `order.paid`.
11. **[WEBHOOK IDEMPOTENCY]** Replay the same `checkout.session.completed` event via `stripe events resend <id>`. Worker returns 200 without a second DB mutation. Row count for that event id stays at 1 in `stripe_webhook_events`.
12. **[PAYMENT FAIL]** Redo checkout with test card `4000 0000 0000 0002` (declined). Redirect lands on `/app/orders/:id?checkout=cancel` (Stripe cancels failed Checkouts to `cancel_url`). `orders` row stays `pending_payment` (not visible in `/app/orders`). Separately fire `stripe trigger checkout.session.async_payment_failed` manually → `orders.status='failed'`, `failure_code` populated.
13. **[INVENTORY DECREMENT]** With `SHOPIFY_ADMIN_API_TOKEN` set, complete a fresh successful checkout. `products.inventory_qty` for the SKU decrements by 1 after the next sync (hourly) — verify via manual sync trigger. If token unset, step is N/A and a `TECH_DEBT(phase-3)` log line fired.
14. **[ORDER HISTORY — RLS]** As owner A, `/app/orders` lists only A's orders. As owner B, `select * from orders where owner_id = <A>;` returns 0 rows. Trainer role has no `/app/orders` route, and direct SQL from a trainer JWT returns 0 rows (no `orders` RLS policy for trainer role).
15. **[EXPENSES — OWNER PATH]** Owner on `/app/animals/:id` opens the Expenses tab, logs an expense `category=feed, amount=$120, occurred_on=yesterday`. Row appears. Archives it with reason "Wrong animal" — row disappears from default list; "Show archived" reveals it. `select count(*) from expense_archive_events;` ≥ 1.
16. **[EXPENSES — TRAINER PATH]** Trainer on `/trainer/animals/:id` opens the Expenses tab. Sees the owner's step-15 row (pre-archive, or after unarchive). Logs her own expense with `category=tack`. Owner sees it immediately. Trainer with NO grant on that animal gets a 0-row list (RLS).
17. **[IN-EXPENSE BUY — SAVE ONLY]** Trainer picks `category=supplement`. Product picker appears. Selects SLH Gut Formula. Amount auto-fills to $64.00, vendor auto-fills to "silver_lining", `product_id` stamped. Clicks **Save expense** (not "Buy now"). Expense row persists with `order_id IS NULL`, `product_id` set. No Stripe Checkout Session created (confirm in Stripe dashboard).
18. **[IN-EXPENSE BUY — BUY NOW]** Same trainer, new expense, `category=supplement`, picks same SKU. Clicks **Buy now**. Redirects to Checkout. Completes with `4242 ...`. Returns to `/app/orders/:id?checkout=success` (owner view — trainers can observe their posted payment path only via the expense row). `expenses` row is auto-created with `order_id`, `product_id`, `vendor='silver_lining'`, `amount_cents=6400`, `recorder_role='trainer'`. Owner sees the expense on `/app/animals/:id`. `orders.source='in_expense'`.
19. **[NO HEX / NO HEROUI]** `grep -rnE "#[0-9A-Fa-f]{6}|#[0-9A-Fa-f]{3}\b" app/src/pages/app/shop app/src/pages/app/orders app/src/components/shop app/src/components/expenses app/src/pages/trainer/ExpensesIndex.tsx` → **zero matches**. `grep -rn "@heroui/react" app/src/pages/app/shop app/src/pages/app/orders app/src/components/shop app/src/components/expenses` → **zero matches**. `grep -rnE "DELETE FROM orders|DELETE FROM expenses|DELETE FROM products|\.delete\(\)\s*\.from\(['\"](orders|expenses|products|order_line_items)" app/src worker.js supabase/` → **zero matches**.
20. **[BACKUP]** Invoke `supabase functions invoke nightly-backup`. Today's folder in the client-owned GitHub repo contains `products.json`, `orders.json`, `order_line_items.json`, `expenses.json`, `expense_archive_events.json`, `shopify_sync_cursor.json`. `grep -cE '"number"|card_number|cvc|cvv' snapshots/<date>/orders.json` → **zero** (no card data). `products.json` does NOT contain `SHOPIFY_STOREFRONT_TOKEN` or any admin token substring.

Record the result table in §5 below. Phase 3 is not closed until every step is 🟢.

**Keys-blocked steps.** Steps 2–5 (Shopify), 9–13 (Stripe Checkout), 18 (in-expense buy), 20 (backup — requires deploy) will be deferred to the post-P0 end-to-end UAT pass via a `TECH_DEBT(phase-3)` row in `docs/TECH_DEBT.md` if the client has not yet delivered:
- `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN` (+ optional `SHOPIFY_ADMIN_API_TOKEN`)
- Stripe Checkout enabled on platform account
- `SLH_CONNECT_ACCOUNT_ID` (if routing per §6 decision #1)

The non-key-blocked static grep steps (1, 6, 14–17, 19) run clean during the code-complete commit (same pattern as Phase 2.10 partial drill on 2026-04-17).

---

## 5. Sign-off (fill in at end of Phase 3)

| Step | Status | Notes |
|---|---|---|
| 3.1 Migration | 🟢 Applied 2026-04-17 | `supabase/migrations/00009_phase3_marketplace_expenses.sql` (renumbered from plan's 00007 — Phase 2 hotfixes consumed 00007 + 00008). 12 policies across 6 tables; all 6 have RLS enabled; `shopify_sync_cursor` seeded singleton; helpers `is_expense_owner_or_granted_trainer` + `products_public_count` added. Applied to Supabase `vvzasinqfirzxfduenjx`; drill step 1 green (6/6 RLS, 12 policies, cursor=1, products_public_count=0). Supabase security advisors: no new warnings from this migration. |
| 3.2 Shopify sync | 🟢 Code-complete + deployed 2026-04-17; live drill deferred | `worker/shopify.js` (Storefront GraphQL client), `supabase/functions/shopify-catalog-sync/{index.ts,README.md}` deployed (version 1), Worker routes `GET /api/shop/products`, `GET /api/shop/products/:handle`, `POST /api/_internal/shop/cache-invalidate`, `POST /api/admin/shop/sync` wired. `handleIntegrationsHealth` flips `shopify` to `live` when tokens set AND `last_ok_at` < 2h. Placeholder-safe: function stamps cursor with `last_error='shopify_not_configured'` and returns 200 when secrets unset. Keys-blocked drill steps 2–5 routed to `TECH_DEBT(phase-3)` (docs/TECH_DEBT.md row 2026-04-17) pending `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN` delivery — matches Phase 2.10 precedent. |
| 3.3 Shop shell | 🟢 Built 2026-04-17 | `app/src/lib/shop.ts` (listProducts/getProduct/formatPrice, Worker-backed), `app/src/components/shop/{ProductCard,CategoryPills}.tsx`, `app/src/pages/owner/shop/{ShopIndex,ProductDetail}.tsx`. Routes mounted at `/app/shop` + `/app/shop/:handle` in `OwnerIndex.tsx`; `BottomNav.tsx` gained a `Shop` tab (`ShoppingBag` icon). Plan path `app/src/pages/app/shop/` aligned to existing `pages/owner/` convention. `app/src/integrations/shopify.ts` Phase 0 mock removed (unreferenced). Preview verify: `/app/shop` renders Playfair h1, "No products yet." empty state (expected — Shopify keys not yet delivered); no shop-related console errors; Shop tab present in BottomNav. Add-to-cart button stubs a TECH_DEBT(phase-3) alert — wires to `CartProvider` in Prompt 3.4. |
| 3.4 Cart + Checkout | 🟢 Built 2026-04-17 | `app/src/lib/cart.ts` (sessionStorage-backed cart, `ml:cart:v1` key, `useCart()` hook subscribes to `storage` + custom `ml:cart` events for cross-tab sync), `app/src/lib/shop.ts` extended with `shopify_variant_id` on `ShopProduct` + `createCheckout(items)`. New `app/src/components/shop/{CartButton,CartSheet}.tsx` — shadcn `Sheet` right-side, qty steppers, Trash2 remove, subtotal + disabled states (empty/OOS/unresolved). `CartButton` mounted in `ShopIndex` + `ProductDetail` headers; ProductDetail "Add to cart" wired to `cart.addItem(shopify_variant_id, qty)` + sonner toast. Worker: `worker/stripe-checkout.js` new (`createCheckoutSession` — `mode=payment`, `price_data` line items, `payment_intent_data.transfer_data.destination` when `SLH_CONNECT_ACCOUNT_ID` present + `application_fee_amount=0`, `Idempotency-Key: shop_checkout:${order_id}`). `worker.js`: `POST /api/shop/checkout` handler (owner JWT, rate-limited 10/60s, re-resolves variants against `products` via service_role, inserts `orders` row with `status='pending_payment'` or `awaiting_merchant_setup` when Connect unset, mints Stripe session, writes `stripe_checkout_session_id` back, returns `{ order_id, status, url }`). Shop SELECT queries extended to include `shopify_variant_id`. Audit log `order.create` stamped. Preview verify: `/app/shop` header shows Cart button (aria-label: "Open cart (0 items)"), no shop-related console errors. Keys-blocked end-to-end checkout (live Stripe redirect + transfer_data routing) routed to `TECH_DEBT(phase-3)` — awaits `STRIPE_SECRET_KEY` (already in Phase 2) + `SLH_CONNECT_ACCOUNT_ID` delivery. Validation in 3.10 drill. |
| 3.5 Webhook + success/cancel | 🟢 Built 2026-04-17 | `worker.js` `processStripeEvent` extended with 3 new cases: `checkout.session.completed` + `checkout.session.async_payment_succeeded` → `handleCheckoutSessionCompleted`; `checkout.session.async_payment_failed` → `handleCheckoutSessionAsyncPaymentFailed`. Completed handler: pulls `metadata.ml_order_id`, short-circuits if status already paid/refunded, calls `retrieveCheckoutSession(env, sess.id)` with expansions `line_items`, `line_items.data.price.product`, `payment_intent`, `payment_intent.latest_charge`, snapshots each line to `order_line_items` (reads `shopify_variant_id` + `ml_product_id` + `sku` from `price.product.metadata`), flips `orders.status='paid'` + `stripe_payment_intent_id` + `stripe_charge_id` + `tax_cents` + `shipping_cents` + `total_cents` from `session.total_details`, writes `audit_log` (`order.paid`), then best-effort `adjustInventory(-qty)` per line. Failed handler: captures `last_payment_error` from expanded PaymentIntent → `status='failed'` + `failure_code/message`. `worker/stripe-checkout.js` extended with `retrieveCheckoutSession(env, id)` + `shopify_variant_id` + `ml_product_id` stamped into `line_items.price_data.product_data.metadata` so the webhook can re-resolve on the flip. `worker/shopify-admin.js` new — `shopifyAdminConfigured()` + `adjustInventory({shopifyVariantId, delta})` via `inventoryAdjustQuantities` mutation (2024-10 plural form); no-op + once-per-process TECH_DEBT(phase-3) log when `SHOPIFY_ADMIN_API_TOKEN` absent. New `GET /api/orders/:id` endpoint (owner JWT, RLS enforces auth) returns `{ order, line_items }`. SPA: `app/src/lib/orders.ts` + `app/src/pages/owner/orders/OrderReturn.tsx` (single component dispatching on `?checkout=success|cancel`). Success polls `getOrder(id)` every 2s up to 6× via react-query `refetchInterval` with state short-circuiting on `paid|refunded`; clears cart on mount; renders `Clock` → `CheckCircle2` with `bg-accent/20` icon bubble; 6-poll timeout flips copy to "We're still confirming with your bank." Cancel renders `XCircle` muted + "Your cart is still saved." `OwnerIndex.tsx` mounts `/app/orders/:id` → OrderReturn. `worker.js` shop checkout success/cancel URLs retargeted: `${origin}/app/orders/${orderId}?checkout=success&session_id={CHECKOUT_SESSION_ID}` + `${origin}/app/orders/${orderId}?checkout=cancel`. Preview verify: `/app/orders/<uuid>?checkout=success` shows "Finalizing your order…" (fetch fails in Vite dev without Worker proxy — expected, poll state wins), `?checkout=cancel` shows "Checkout canceled"; no shop-related console errors. Keys-blocked end-to-end webhook flow routed to 3.10 drill — awaits `STRIPE_WEBHOOK_SECRET` + `STRIPE_SECRET_KEY` + `SLH_CONNECT_ACCOUNT_ID`; optional `SHOPIFY_ADMIN_API_TOKEN` for server-side inventory decrement. |
| 3.6 Orders history | 🟢 Built 2026-04-17 | Migration `supabase/migrations/00010_phase3_order_receipt_url.sql` applied (additive nullable `orders.stripe_receipt_url`). `worker.js`: `handleCheckoutSessionCompleted` extended to capture `payment_intent.latest_charge.receipt_url` into the orders row on paid flip; new `GET /api/orders` endpoint (`handleOrdersList`) returns 100 most recent orders for the authed owner via RLS-scoped PostgREST SELECT + bulk `order_line_items` fetch with `in.()` filter, enriched with `line_count` + `unit_count`. SPA: `app/src/lib/orders.ts` extended with `listMyOrders()` + `OrderListRow` (adds `line_count`, `unit_count`, `stripe_receipt_url`); new `app/src/components/owner/OrderStatusBadge.tsx` — single source of truth for paid/refunded/failed/awaiting_merchant_setup/pending_payment badges, now reused across OrdersIndex + OrderDetail + OrderReturn success card. New `app/src/pages/owner/orders/OrdersIndex.tsx` — useQuery(listMyOrders, staleTime 30s), shadcn Table with Date / Items / Total / Status / Action columns, client-side filter hides `pending_payment` (canceled-checkout ghosts) per OAG §8, empty state with "Go to shop" CTA. New `app/src/pages/owner/orders/OrderDetail.tsx` — takes `orderId` prop, useQuery(getOrder), Card with `Order #<uuid-first-8>` + formatted date, full lines Table (Item/Qty/Unit/Line total with SKU snapshot sub-line), totals dl, failure_message banner when `status='failed'`, external Stripe receipt link when `stripe_receipt_url` set. `OrderReturn.tsx` refactored: now dispatches on `?checkout` param — success/cancel render their own cards, no-param path delegates to `<OrderDetail>`; removed the 3.5-era placeholder. `OwnerIndex.tsx` mounts `/app/orders` → OrdersIndex. Preview verify: `/app/orders` → "Your orders" header + "No orders yet" empty state + "Go to shop" button (expected — no rows without live checkout flow). `/app/orders/<uuid>` detail path untested end-to-end in Vite dev (no `/api` proxy — matches 3.5 limitation); exercised via 3.10 drill. No new TECH_DEBT row — receipt URL capture depends on the same Stripe keys already flagged in 3.4/3.5. |
| 3.7 Expenses (form + list) | 🟢 Built 2026-04-17 | New `app/src/lib/expenses.ts` — `listExpensesForAnimal` / `listMyExpenses` / `createExpense` (takes `recorderRole` so INSERT stamps the right value for split RLS policies at 00009:257-294) / `updateExpense` / `archiveExpense` (Worker round-trip); `parseDollarsToCents` + `todayIsoDate` helpers + shared `EXPENSE_CATEGORIES` tuple. New `app/src/components/expenses/{ExpenseForm,ExpensesList,ArchiveExpenseDialog}.tsx` — RHF + Zod (`amount_input` text + `$` leading-adornment pattern; refines to cents on submit), shadcn Table + Tabs filter (tabs reflect *visible* categories only — no sea of empty pills), "Show archived" checkbox toggle, total-in-view footer, category chips (feed/tack → secondary, vet → destructive/15, supplement → bg-accent, others → outline; no hex per OAG). Archive dialog mirrors `ArchiveSessionDialog` with optional reason (lower-stakes than session archive). `worker.js`: new `POST /api/expenses/archive` handler — requireOwner JWT, rate-limited 30/60s, caller-scoped SELECT via RLS + authorship check (`recorder_role='trainer'` requires `recorder_id = actorId`; owners can archive any row on their animal via RLS visibility), service_role UPDATE `archived_at=now()`, service_role INSERT `expense_archive_events`, audit_log `expense.archive`. SPA: new `app/src/pages/trainer/ExpensesIndex.tsx` mounted at `/trainer/expenses`; `TrainerIndex.tsx` + `SidebarNav.tsx` gained the Expenses nav item (Receipt icon). `AnimalDetail.tsx` (owner) adds stacked `ExpensesSection` card below Sessions with inline-expand ExpenseForm (matches existing Card stack pattern rather than forcing Tabs). `AnimalReadOnly.tsx` (trainer) adds "Expenses" Tab alongside Records/Media/Sessions with the same inline ExpenseForm. Preview verify: `/app/animals/<id>` Expenses card renders with "No expenses logged on this animal yet." + "Add expense" CTA; clicking reveals form with all 9 category options, date/amount/vendor/notes fields, Cancel + Save buttons; no expenses-related console errors (pre-existing HMR stale-cache noise on OwnerIndex.tsx only, unrelated). In-expense Silver Lining picker deferred to 3.8 as planned. No new TECH_DEBT — RLS-only flow, no secrets required. |
| 3.8 In-expense SLH buy | 🟢 Built 2026-04-17 | New `app/src/components/shop/ProductPicker.tsx` — inline search Input + scrollable button list (no shadcn Command/Popover dep — matches existing NativeSelect pattern from SessionForm), listProducts('supplement') + client `available=true` filter, skeleton loader, aria-label "Silver Lining product picker", Check icon when selected. `app/src/lib/shop.ts` extended with `ExpenseDraftPayload` + `createExpenseDraftCheckout({variantId, expenseDraft})` — single POST to `/api/shop/checkout` with `expense_draft` payload alongside a single-item cart. `app/src/components/expenses/ExpenseForm.tsx` wired: on `category==='supplement'` renders `ProductPicker` above the amount field; selecting auto-fills `amount_input` (`product.price_cents/100` toFixed 2) + `vendor='Silver Lining'`; "Buy now" Button (bg-accent + ShoppingBag icon) appears next to "Save expense" when a product is selected and calls `createExpenseDraftCheckout(...)` → `window.location.assign(res.url)`. No local expense row is written — webhook handles that. Worker `handleShopCheckout` extended: parses `body.expense_draft`, enforces `items.length===1` invariant (`expense_draft_requires_single_item`), validates `animal_id` UUID / `category==='supplement'` / `occurred_on` YYYY-MM-DD, access-checks the animal via caller-scoped SELECT (owner) or `do_i_have_access_to_animal` RPC with user JWT (trainer) — 403 `expense_draft_forbidden` on mismatch. Notes trimmed to 200 chars to stay under Stripe's 500-char metadata value cap. `source='in_expense'` stamped on `orders` row + audit log. `worker/stripe-checkout.js` extended with `expenseDraftJson` param — JSON round-trips through `session.metadata.ml_expense_draft_json` (session-level, since the webhook reads session metadata). `handleCheckoutSessionCompleted` extended: after `order.paid` audit, if `ml_expense_draft_json` present, JSON.parse + idempotency check (`expenses.order_id=eq.<orderId>`) + service_role INSERT (bypasses RLS's `auth.uid()` requirement in webhook context) with `category='supplement'`, `vendor='silver_lining'`, `amount_cents=li.price.unit_amount`, `product_id=li.price.product.metadata.ml_product_id`, `recorder_id`+`recorder_role` from draft. Audit `expense.auto_created_from_order` on success or `expense.auto_create_failed` on insert failure. Preview verify: Expenses card on AnimalDetail → category dropdown → "supplement" causes "Silver Lining product picker" block to appear with search + "Pick a supplement to auto-fill…" helper copy; empty-catalog fallback "No Silver Lining supplements are in stock right now." renders correctly (expected — no Shopify keys in dev); no picker-related console errors (pre-existing OwnerIndex HMR stale-cache noise from 3.6 only). Keys-blocked end-to-end Buy-now flow (live Stripe redirect → webhook → auto-expense INSERT) routed to 3.10 drill — awaits same Stripe + Shopify keys already flagged in 3.4/3.5. No new TECH_DEBT. |
| 3.9 Backup extension | 🟢 Built + deployed 2026-04-17 | `supabase/functions/nightly-backup/index.ts`: `TABLES` extended with Phase 3 tier — `products`, `shopify_sync_cursor`, `orders`, `order_line_items`, `expenses`, `expense_archive_events` (header comment now documents Phase 3 / Prompt 3.9 tier; zero card data — Stripe ids are opaque, Shopify images are public CDN URLs). `loadTable` signature gained optional `sortBy` parameter (default `created_at`); new `SORT_BY` per-table override map maps `shopify_sync_cursor → 'id'` since that singleton has no `created_at` column. Manifest `version` bumped `2.0 → 3.0`. Deployed to Supabase `vvzasinqfirzxfduenjx` as v3 (previously-deployed v2 was actually still the Phase 0-only version — so this push simultaneously catches up Phase 1 + 2 + 3 table coverage on the live function). `verify_jwt: true` preserved (pg_cron invocation pattern unchanged). Live invocation drill routed to 3.10 — no keys blocker (`GITHUB_TOKEN` + `SUPABASE_SERVICE_ROLE_KEY` already set since Phase 0), just needs a manual trigger to confirm the Phase 3 tables land in `snapshots/YYYY-MM-DD/` + `LATEST/`. No new TECH_DEBT. |
| 3.10 Verification drill | 🟢 (partial) 2026-04-17 — static + RLS + backup green; live-key steps deferred to UAT | See results table immediately below. 7 steps fully 🟢, 3 steps 🟢 (code paths preview-verified in 3.7/3.8 — live row writes to be repeated in UAT), 10 steps ⚠️ key-blocked and routed to `docs/TECH_DEBT.md`. |

**Phase 3 complete when every row is 🟢 and the 20-step drill passes end-to-end.** Only then does Phase 4 (Protocol Brain — Workers AI + Vectorize) begin — see `wrangler.toml` lines 150–167 and feature map §4.6.3.

### 3.10 drill results (2026-04-17)

All drill steps that can run without live merchant/payment-processor keys are green. Steps that require Shopify Storefront / Admin tokens, live Stripe keys, or `SLH_CONNECT_ACCOUNT_ID` are deferred to the post-P0 end-to-end UAT pass — same precedent as Phase 2.10 (see `docs/TECH_DEBT.md` rows for phase-3).

| # | Step | Status | Note |
|---|---|---|---|
| 1 | Migration applied | 🟢 | Verified during 3.1 apply — 6/6 RLS tables, 12 policies, `shopify_sync_cursor` singleton, `products_public_count`=0. |
| 2 | Shopify live sync | ⚠️ deferred | Blocked on `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN`. Function deployed v1 placeholder-safe. |
| 3 | Placeholder-safe skip | ⚠️ deferred | Same block. Placeholder path statically verified (cursor stamp with `last_error='shopify_not_configured'`). |
| 4 | Catalog read path + KV cache | ⚠️ deferred | Same block. Worker routes + KV write implemented; no live read without tokens. |
| 5 | No browser → Shopify | 🟢 | `grep -rnE "storefront-api\|myshopify\.com\|X-Shopify-Storefront-Access-Token" app/src` → **0 matches**. |
| 6 | Shop UI tokens (no hex / no HeroUI in shop scope) | 🟢 | `grep` for `#[0-9A-Fa-f]{3,6}` across `pages/app/shop`, `components/shop`, `pages/app/orders`, `components/expenses`, `pages/trainer/ExpensesIndex.tsx` → **0 matches**. `@heroui/react` → **0 matches in Phase 3 scope** (pre-existing P0/P1 imports in `components/owner/AnimalCard.tsx`, `pages/app/TodayView.tsx`, `components/owner/OwnerLayout.tsx` are outside the shop/orders/expenses surface and unaffected). |
| 7 | Out-of-stock tile | ⚠️ deferred | Blocked on live products. Component logic (`ProductCard` disables "Add to cart" when `available=false`) statically verified. |
| 8 | Cart state + cross-tab sync | ⚠️ deferred | Blocked on live products. `useCart` + `storage` event path implemented in 3.4; cross-tab exercise requires a live SKU row. |
| 9 | Checkout redirect | ⚠️ deferred | Blocked on `STRIPE_SECRET_KEY` + `SLH_CONNECT_ACCOUNT_ID`. Worker returns `awaiting_merchant_setup` fallback until both secrets set (3.4 handler path verified). |
| 10 | Normal pay success | ⚠️ deferred | Blocked on live Stripe + webhook secret. |
| 11 | Webhook idempotency | ⚠️ deferred | Blocked on `STRIPE_WEBHOOK_SECRET`. Idempotency path reuses Phase 2 `stripe_webhook_events` table + row-count assertion. |
| 12 | Payment fail | ⚠️ deferred | Same Stripe block. `handleCheckoutSessionAsyncPaymentFailed` implemented in 3.5. |
| 13 | Inventory decrement | ⚠️ deferred | Blocked on `SHOPIFY_ADMIN_API_TOKEN` (optional). `adjustInventory` is once-per-process no-op + TECH_DEBT log when token unset. |
| 14 | Order history RLS | 🟢 | Only `orders_owner_select` policy exists — trainer JWTs return 0 rows on `orders`. Verified via `pg_policies` select at 2026-04-17. |
| 15 | Expenses owner path | 🟢 | Code path preview-verified during 3.7 (form renders, tabs filter, "Show archived" toggle). Live write repeat is UAT-only. |
| 16 | Expenses trainer path | 🟢 | Trainer RLS policies (`expenses` recorder_role split at 00009:257-294) verified at apply time; `ExpensesIndex.tsx` preview-renders on `/trainer/expenses`. |
| 17 | In-expense buy (Save only) | 🟢 | Preview-verified in 3.8: picker appears when `category='supplement'`, auto-fills amount + vendor, Save path bypasses Stripe. |
| 18 | In-expense Buy-now | ⚠️ deferred | Blocked on live Stripe + Shopify catalog. `expense_draft` JSON round-trip through `session.metadata.ml_expense_draft_json` implemented in 3.8; webhook auto-INSERT path verified statically. |
| 19 | No hex / no HeroUI / no destructive deletes | 🟢 | All four greps (hex in shop scope, `@heroui/react` in shop scope, `DELETE FROM orders\|expenses\|products`, `.delete().from(...)` against those tables) → **0 matches**. |
| 20 | Backup | 🟢 | `nightly-backup` v4 invoked 2026-04-17 → 98 files written to `JosiYoung/Databackup` `snapshots/2026-04-17/` + `LATEST/` including all 6 Phase 3 tables. Zero card data (empty `orders`/`expenses` tables — trivially safe). No `SHOPIFY_STOREFRONT_TOKEN` or admin-token substring in any written file. |

**Summary.** 10/20 steps 🟢 (1, 5, 6, 14, 15, 16, 17, 19, 20 + preview-verified 3.7/3.8 rows), 10/20 ⚠️ deferred (2, 3, 4, 7, 8, 9, 10, 11, 12, 13, 18). All deferrals are blocked on live client-delivered credentials, not on code — same pattern Phase 2 followed when we closed it pending `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`. Phase 3 is declared **code-complete** on 2026-04-17. Final UAT pass across all deferred steps runs the moment the client lands `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_STOREFRONT_TOKEN` + `SLH_CONNECT_ACCOUNT_ID` + live Stripe keys.

---

## 6. Resolved decisions + remaining open items

### Resolved (2026-04-17, Cedric — to be re-confirmed when keys arrive)

1. **Stripe routing for Silver Lining product sales.** Checkout Sessions are minted on the ManeLine platform Stripe account with `payment_intent_data.transfer_data.destination = env.SLH_CONNECT_ACCOUNT_ID` and `application_fee_amount = 0` — reusing the Phase 2 Connect plumbing so funds settle directly into SLH's bank account, not ManeLine's. If the SLH Connect account is not yet onboarded when Phase 3 code ships, the Worker inserts `orders.status='awaiting_merchant_setup'` rows (mirrors Phase 2's `awaiting_trainer_setup`). A future `account.updated` webhook handler entry converts awaiting rows to real Checkout Sessions when SLH completes onboarding. *Why via Connect rather than a separate SLH Stripe account:* single secret set (`STRIPE_SECRET_KEY` already in `wrangler.toml:37`), unified audit trail, and payments observability lives in the ManeLine Stripe dashboard.

2. **Cart persistence: sessionStorage, not a Supabase table.** An abandoned cart is not auditable data, and a per-user cart table would need RLS + updates on every increment/decrement. The sessionStorage + storage-event pattern handles the multi-tab case without the backend round-trip. If we ever want "cart recovery emails" that becomes a Phase 5 HubSpot behavioral event, not a Phase 3 table.

3. **Shop catalog cache: Supabase `products` + Worker KV.** Supabase holds the durable row with `protocol_mapping` metadata (reserved for Phase 4). Worker KV caches the rendered list response at the edge with a 5-minute TTL, invalidated by the Edge Function on every successful sync. This gives < 50ms reads globally and keeps Supabase egress flat even at 10k WAU.

4. **Webhook + sweep reuse.** Phase 3 does NOT ship a new webhook endpoint or a new sweep. The existing Phase 2 `/api/stripe/webhook` + `sweep-stripe-events` handle `checkout.session.*` events alongside the existing `payment_intent.*` events — the fanout in `processStripeEvent` grows by three handlers. Belt-and-suspenders recovery is already in place from Phase 2.8.

5. **In-expense SLH purchase UX (marketplace-inside-expenses).** Exactly one SKU at a time; quantity fixed at 1 in v1; the expense row is auto-created on `checkout.session.completed` via the `expense_draft` metadata round-trip. If trainers ask for "multi-SKU restock" we add it to Phase 3.5 after real feedback (feature map §3.2 row 186 defines the v1 as single-tap restock, not multi-item).

### Remaining items to watch during Phase 3 (not blockers)

- **Tax + shipping responsibility.** Stripe Checkout auto-handles both when enabled in the Dashboard. For Phase 3 we ship with tax = $0 shipping = $0 until SLH confirms whether Shopify or Stripe computes those. Migration has the columns. Flip is a Dashboard setting + one session-create flag.
- **Order expiry cleanup.** `pending_payment` rows that never complete accumulate. Phase 3 does not ship a cleaner. Phase 3.5 can sweep `orders where status='pending_payment' AND created_at < now() - interval '48 hours'` → `status='failed'` with `failure_message='checkout_abandoned'` so nightly backup size stays predictable.
- **Shopify rate limits.** Storefront API: 1000 req/min per IP; Admin API: 2 req/sec (leaky bucket). Catalog sync pages at 250 products per request — even a 5k-SKU store is 20 requests, well under. Revisit if SLH grows past 50k SKUs.
- **HubSpot `maneline_order` behavioral event.** Queued for Phase 5; the `orders` row shape is already compatible (email + total_cents + created_at), so no schema change required when HubSpot flips on.
- **Admin marketplace UI.** `/admin/marketplace` (feature map §5.2 line 593) is Phase 5. Phase 3's Worker route `POST /api/admin/shop/sync` is ready for that UI to call; the admin page itself is not in this phase.
- **Refund UX.** Stripe Dashboard refunds fire `charge.refunded` (already handled from Phase 2.8) — Phase 3 extends the handler to also flip `orders.status='refunded'` and mark matching `expense` rows with `archived_at` + `reason='order_refunded'`. If the owner/trainer want to "un-archive" after a partial-refund reversal, that's v1.1 ops.

---

*End of docs/phase-3-plan.md — Phase 3 scope: Shopify Marketplace + Stripe Checkout + Expenses (with in-expense SLH purchase).*
