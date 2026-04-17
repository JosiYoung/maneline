# Mane Line — Integrations Guide

**Audience:** future-Cedric (and any new engineer) who needs to flip an integration from mock to live without a tour guide.

All four integrations below are **scaffolded as mocks in Phase 0** so the UI and data flow can be built against real-looking shapes. Each has a dedicated file in `app/src/integrations/` with the same function signatures the live version will expose. Flipping any of them from mock → live is a **self-contained swap**: you edit the function bodies in that one file (and add the corresponding secret in Cloudflare), nothing else.

To check status at any time:

```bash
curl https://maneline.co/api/_integrations-health
```

The response reports `"mock"` for every not-yet-flipped integration and a `secrets_present` map showing which env keys Cloudflare sees.

---

## Placeholder model, in plain English

- **Phase 0 = mocks.** Every integration file returns hard-coded but correctly-typed data. Nothing hits the network. The rest of the SPA calls them normally, so when we flip, call-sites don't change.
- **One file per integration.** `app/src/integrations/shopify.ts`, `hubspot.ts`, `workers-ai.ts`, `stripe.ts`. Each function has a `TODO(Phase N)` marker at the top so you know when to come back.
- **Secrets are documented but empty.** `wrangler.toml` lists every secret name and which Phase it belongs to. We do **not** set values until we're ready to flip — storing unused secrets in CF is harmless but makes audit trails noisy.
- **The health endpoint is the smoke test.** `GET /api/_integrations-health` is the one-stop way to see which integrations are mock vs live and which secrets are present.

---

## Shopify (Phase 3)

### What it does
Serves the Silver Lining Herbs product catalog inside the owner portal (`/app/shop`), powers the "Add to cart → hosted checkout" flow, and eventually carries attribution back to the protocol that recommended the product.

### Where to get credentials
1. Log in to Shopify admin → **Apps → Develop apps → Create an app**.
2. Under **Configuration**, enable the **Storefront API** and grant read scopes for `products`, `collections`, `checkouts`.
3. **Install** the app. You'll see:
   - **Storefront API access token** — a single opaque string. Copy it.
   - **Store domain** — `silver-lining-herbs.myshopify.com` (or whatever the subdomain is).
4. Only if we need server-side order mutations: under **API credentials**, create an **Admin API access token** with the narrow scopes we document when Phase 3 lands.

### Env var mapping
| Secret name | What it is | Where it's set |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | `*.myshopify.com` hostname | Public; can move to `[vars]` in `wrangler.toml` |
| `SHOPIFY_STOREFRONT_TOKEN` | Storefront API access token | `npx wrangler secret put SHOPIFY_STOREFRONT_TOKEN` |
| `SHOPIFY_ADMIN_API_TOKEN` | Admin API access token (optional) | `npx wrangler secret put SHOPIFY_ADMIN_API_TOKEN` |

### Flip from mock to live
Edit `app/src/integrations/shopify.ts`:
1. Replace `getProducts()` body with a `fetch` to `https://${SHOPIFY_STORE_DOMAIN}/api/2024-10/graphql.json` carrying the `X-Shopify-Storefront-Access-Token` header.
2. Do the same for `getProduct(sku)` (filter by SKU) and `createCheckout(lineItems)` (call the `cartCreate` mutation; return the web URL).
3. Delete the `TODO(Phase 3)` comments and the `MOCK_PRODUCTS` constant.
4. Flip `shopify: 'mock'` → `shopify: 'live'` in `worker.js` under `handleIntegrationsHealth`.

### Verify once live
```bash
# From a logged-in browser session (protected-route data):
curl -s https://maneline.co/api/_integrations-health | jq '.shopify'
# → "live"

# Hit Shopify directly (sanity check — use a test SKU from the store):
curl -H "X-Shopify-Storefront-Access-Token: $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ products(first:1){ edges{ node{ id title } } } }"}' \
  "https://${SHOPIFY_STORE_DOMAIN}/api/2024-10/graphql.json"
```

---

## HubSpot (Phase 5)

### What it does
Syncs every user from Supabase into HubSpot as a Contact (lifecycle = `lead` at signup, `customer` after first purchase), and pushes custom behavioral events (`maneline_signup`, `first_protocol_saved`, `referral_shared`, …) so the SLH marketing team can segment + automate.

### Where to get credentials
1. In HubSpot: **Settings ⚙ → Integrations → Private Apps → Create a private app**.
2. Give it read+write scopes on `crm.objects.contacts` and `crm.schemas.custom`. Add `events.send` for behavioral events.
3. On creation, HubSpot shows the **access token** exactly once — copy it. It starts with `pat-na1-`.
4. The **Portal ID** (a.k.a. "Hub ID") is visible in the URL when you're logged into HubSpot: `app.hubspot.com/contacts/<PORTAL_ID>/...`.

### Env var mapping
| Secret name | What it is | Where it's set |
|---|---|---|
| `HUBSPOT_PRIVATE_APP_TOKEN` | `pat-na1-…` private-app token | `npx wrangler secret put HUBSPOT_PRIVATE_APP_TOKEN` |
| `HUBSPOT_PORTAL_ID` | 8-digit hub id | Public; can move to `[vars]` |

### Flip from mock to live
Edit `app/src/integrations/hubspot.ts`:
1. `upsertContact()` → `POST https://api.hubapi.com/crm/v3/objects/contacts` with `idProperty=email` so it creates-or-updates in one call.
2. `trackEvent()` → `POST https://api.hubapi.com/events/v3/send` with the portal id and event name.
3. Delete the `TODO(Phase 5)` comments.
4. Flip `hubspot: 'mock'` → `'live'` in `worker.js`.

### Verify once live
```bash
# After a real signup, confirm the contact landed:
curl -H "Authorization: Bearer $HUBSPOT_PRIVATE_APP_TOKEN" \
  "https://api.hubapi.com/crm/v3/objects/contacts/<EMAIL>?idProperty=email"

# Health check:
curl -s https://maneline.co/api/_integrations-health | jq '.hubspot'
# → "live"
```

---

## Workers AI (Phase 4 — the Protocol Brain)

### What it does
Three distinct jobs:
1. **`classifySymptom(text)`** — tags a free-text symptom report with canonical categories (`gut`, `hoof`, `soundness`, `respiratory`, …) so protocols can be retrieved.
2. **`embedText(text)`** — turns a protocol/document into a 768-dim vector for Vectorize (nearest-neighbour search).
3. **`chatComplete({ system, messages })`** — full LLM answer for "What's wrong with my horse?"-style questions, grounded on retrieved protocols.

### Where to get credentials
**None.** Workers AI uses the `env.AI` binding — it's account-scoped and wired by Cloudflare automatically once `[ai] binding = "AI"` is in `wrangler.toml`. No token to paste.

Vectorize needs a one-time index creation before the first deploy that binds it:

```bash
npx wrangler vectorize create maneline-protocols \
  --dimensions=768 --metric=cosine
```

768 dims matches `@cf/baai/bge-base-en-v1.5`. Change both if we swap embedding models.

### Env var mapping
| Binding name | What it is |
|---|---|
| `AI` | Workers AI runtime (`[ai]` in `wrangler.toml`) |
| `VECTORIZE_PROTOCOLS` | Vectorize index `maneline-protocols` |

No secrets.

### Flip from mock to live
Workers AI bindings only exist inside Worker runtime — not the SPA. The flip therefore has two moves:
1. In `worker.js`, add routes like `POST /api/ai/classify` and `POST /api/ai/chat` that call `env.AI.run(...)`.
2. In `app/src/integrations/workers-ai.ts`, replace the mock bodies with `fetch('/api/ai/classify', { body: JSON.stringify({ text }) })` calls.
3. Flip `workersAi: 'mock'` → `'live'` in `worker.js`.

### Verify once live
```bash
# End-to-end smoke (after Phase 4 Worker routes exist):
curl -s -X POST https://maneline.co/api/ai/classify \
  -H 'content-type: application/json' \
  -d '{"text":"My mare has been off feed and her manure is loose."}'
# → { "labels":["gut"], "confidence":0.78, "model":"@cf/meta/llama-3.1-..." }

curl -s https://maneline.co/api/_integrations-health | jq '.workersAi'
# → "live"
```

---

## Stripe (Phase 2)

### What it does
Two flows:
1. **Customer checkout** — `createCheckoutSession()` mints a hosted Stripe Checkout URL for a product SKU so owners can pay without leaving `maneline.co`. This runs **before** Shopify is wired in Phase 3, so Phase 2 is our first revenue rail.
2. **Trainer payouts** — `createConnectedAccount()` onboards a vetted trainer into Stripe Connect Express. Once they're approved, owners can charge them through the platform and Stripe handles payout splits.

### Where to get credentials
1. Log in at <https://dashboard.stripe.com>.
2. **Developers → API keys** → copy the **Secret key** (`sk_live_...` for prod, `sk_test_...` for non-prod).
3. **Developers → Webhooks → Add endpoint** → point at `https://maneline.co/webhook/stripe` → copy the **Signing secret** (`whsec_...`). This is what `STRIPE_WEBHOOK_SECRET` holds.
4. For Connect: **Settings → Connect settings → Enable Express accounts**. No separate secret — the same `STRIPE_SECRET_KEY` drives both.

### Env var mapping
| Secret name | What it is | Where it's set |
|---|---|---|
| `STRIPE_SECRET_KEY` | `sk_live_…` / `sk_test_…` | `npx wrangler secret put STRIPE_SECRET_KEY` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` — verifies inbound event POSTs | `npx wrangler secret put STRIPE_WEBHOOK_SECRET` |

### Flip from mock to live
1. Move the integration body out of `app/src/integrations/stripe.ts` and into a Worker route (`/api/stripe/checkout`, `/api/stripe/connect/onboard`) because `STRIPE_SECRET_KEY` must NOT ship to the browser.
2. Add a `POST /webhook/stripe` handler in `worker.js` that verifies the signature with `STRIPE_WEBHOOK_SECRET` and updates Supabase (`orders`, `trainer_payouts` tables — TBD in Phase 2 migration).
3. Replace the mock bodies in `stripe.ts` with `fetch` calls to those Worker routes.
4. Flip `stripe: 'mock'` → `'live'` in `worker.js`.

### Verify once live
```bash
# Customer checkout flow:
curl -s -X POST https://maneline.co/api/stripe/checkout \
  -H 'content-type: application/json' \
  -d '{"sku":"SLH-GUT-30","priceCents":6400}'
# → { "id":"cs_test_...", "url":"https://checkout.stripe.com/..." }

# Webhook round-trip (from Stripe CLI, recommended):
stripe listen --forward-to https://maneline.co/webhook/stripe
stripe trigger checkout.session.completed
# Check Worker logs: `npx wrangler tail`

curl -s https://maneline.co/api/_integrations-health | jq '.stripe'
# → "live"
```

---

## Phase → Integration cheat-sheet

| Phase | Flipping | Unblocks |
|---|---|---|
| **0** (now) | — | Signup, auth, SPA scaffold, mock integrations |
| **2** | Stripe | First revenue; trainer Connect onboarding |
| **3** | Shopify | Product catalog + hosted checkout |
| **4** | Workers AI + Vectorize | Protocol Brain (symptom classify, chat, retrieval) |
| **5** | HubSpot | CRM lifecycle sync, behavioral events, marketing automation |

When in doubt: `curl https://maneline.co/api/_integrations-health | jq`. That one endpoint is the source of truth.
