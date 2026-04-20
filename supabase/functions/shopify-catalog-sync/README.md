# shopify-catalog-sync

Supabase Edge Function that pulls the Silver Lining Herbs catalog
from Shopify's Storefront API (2024-10) and upserts it into
`public.products`. Plan: `docs/phase-3-plan.md` Prompt 3.2.

Runs on Deno. Invoked two ways:
1. **Hourly cron** via `pg_cron` (see Schedule below).
2. **On-demand** by the Worker route `POST /api/admin/shop/sync`
   (silver_lining JWT required — Prompt 3.2).

## Deploy

```bash
supabase functions deploy shopify-catalog-sync
supabase secrets set \
  SHOPIFY_STORE_DOMAIN=silver-lining-herbs.myshopify.com \
  SHOPIFY_STOREFRONT_TOKEN=<storefront-token> \
  MANELINE_WORKER_URL=https://mane-line.<your-sub>.workers.dev
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected by
the Edge Function runtime.

## Schedule (pg_cron)

Supabase's dashboard "Schedules" tab is retired — paste into the SQL
Editor once. Replace `<PROJECT_REF>` and make sure
`service_role_key` is set as a Vault secret.

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net  with schema extensions;

select cron.schedule(
  'shopify-catalog-sync',
  '7 * * * *',  -- hourly at minute 7 (offset from sweep-stripe-events)
  $$
    select net.http_post(
      url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/shopify-catalog-sync',
      headers := jsonb_build_object(
                   'Authorization', 'Bearer ' ||
                     (select decrypted_secret
                      from vault.decrypted_secrets
                      where name = 'service_role_key'),
                   'content-type', 'application/json'
                 ),
      body    := '{}'::jsonb
    );
  $$
);
```

Verify:

```sql
select jobname, schedule, active from cron.job
where jobname = 'shopify-catalog-sync';
```

## Local smoke test

```bash
supabase functions serve shopify-catalog-sync --env-file .env
curl -X POST http://localhost:54321/functions/v1/shopify-catalog-sync \
  -H "Authorization: Bearer <service_role>"
```

## Behavior

- **Leg 1 (sync):** paginates `products(first: 250, after: cursor)` via
  the Storefront GraphQL endpoint. Each page upserts into
  `public.products` keyed by `shopify_product_id`. Price decimals
  are converted to integer cents. `category` is mapped from
  `productType` (lower-cased). `inventory_qty` comes from the default
  variant's `quantityAvailable` (null when Shopify hides it).
- **Leg 2 (soft-archive):** any row in `public.products` whose
  `shopify_product_id` did NOT appear in Leg 1 is flipped to
  `available=false, archived_at=now()`. OAG §8 — never `DELETE`.
  `order_line_items` keep resolving via the snapshot columns.
- **Leg 3 (cursor):** writes `shopify_sync_cursor` (singleton id=1)
  with `last_run_at`, `last_ok_at`, `last_error`, counts.
- **Leg 4 (cache bust):** best-effort POST to the Worker's
  `/api/_internal/shop/cache-invalidate` endpoint so the KV edge
  cache (`shop:v1:list`, `shop:v1:handle:<handle>`) refreshes.

## Placeholder-safe

If `SHOPIFY_STORE_DOMAIN` or `SHOPIFY_STOREFRONT_TOKEN` is unset, the
function exits 200 with `{ skipped: 'shopify_not_configured' }` after
stamping the cursor. No rows mutated. No cron alerts. Mirrors the
Phase 2 `sweep-stripe-events` placeholder.

The Worker's `/api/_integrations-health` reports `"shopify": "live"`
only when the tokens are set AND `shopify_sync_cursor.last_ok_at` is
within the last 2 hours.
