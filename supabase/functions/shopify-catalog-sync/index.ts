// ============================================================
// ManeLine — Shopify catalog sync (Phase 3.2)
// ------------------------------------------------------------
// Runs on Supabase Edge Functions (Deno runtime). Scheduled
// hourly via pg_cron (see README.md). Can also be triggered
// on-demand via the Worker's /api/admin/shop/sync route.
//
// What it does:
//   1. Paginates public products from the Shopify Storefront API
//      (first: 250, cursor-paginated — 2024-10).
//   2. Upserts each into public.products keyed by
//      shopify_product_id. Sets last_synced_at = now().
//   3. Soft-archives rows whose shopify_product_id did NOT appear
//      in this run: UPDATE ... SET available=false, archived_at=now().
//      (OAG §8 — never DELETE, so order_line_items keep resolving.)
//   4. Writes one row to shopify_sync_cursor (id=1 singleton) with
//      run timestamps + counts.
//   5. Best-effort POST to the Worker's
//      /api/_internal/shop/cache-invalidate so KV edge cache flips.
//
// Placeholder-safety: if SHOPIFY_STOREFRONT_TOKEN or
// SHOPIFY_STORE_DOMAIN is unset, we exit 200 with
// { skipped: 'shopify_not_configured' } — no mutations, no error log.
//
// ENV VARS:
//   SUPABASE_URL                (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY   (auto-injected)
//   SHOPIFY_STORE_DOMAIN        (secret or var — e.g. xxx.myshopify.com)
//   SHOPIFY_STOREFRONT_TOKEN    (secret — unauth'd storefront token)
//   MANELINE_WORKER_URL         (secret — https://.../, used for cache bust)
// ============================================================

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

const STOREFRONT_API_VERSION = "2024-10";

type Money = { amount?: string; currencyCode?: string };
type Variant = {
  id?: string;
  sku?: string | null;
  price?: Money;
  quantityAvailable?: number | null;
};
type ProductNode = {
  id: string;
  handle: string;
  title: string;
  description?: string | null;
  productType?: string | null;
  availableForSale?: boolean;
  featuredImage?: { url?: string } | null;
  variants?: { edges: { node: Variant }[] };
};
type ProductEdge = { node: ProductNode };
type ProductsPage = {
  edges: ProductEdge[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

type ProductRow = {
  shopify_product_id: string;
  shopify_variant_id: string;
  handle: string;
  sku: string;
  title: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  currency: string;
  category: string | null;
  inventory_qty: number | null;
  available: boolean;
  last_synced_at: string;
};

const PRODUCTS_QUERY = `
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
          edges {
            node {
              id
              sku
              price { amount currencyCode }
              quantityAvailable
            }
          }
        }
      }
    }
  }
}
`;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function storefrontUrl(domain: string): string {
  const raw = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${raw}/api/${STOREFRONT_API_VERSION}/graphql.json`;
}

async function storefrontFetch(
  domain: string,
  token: string,
  cursor: string | null,
): Promise<ProductsPage> {
  const res = await fetch(storefrontUrl(domain), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query: PRODUCTS_QUERY, variables: { cursor } }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`shopify_${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  if (body?.errors) {
    throw new Error(`shopify_graphql: ${JSON.stringify(body.errors).slice(0, 300)}`);
  }
  const conn = body?.data?.products;
  if (!conn) {
    throw new Error("shopify_malformed_response");
  }
  return {
    edges: Array.isArray(conn.edges) ? conn.edges : [],
    pageInfo: {
      hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
      endCursor: conn.pageInfo?.endCursor ?? null,
    },
  };
}

function nodeToRow(node: ProductNode): ProductRow | null {
  const variant = node.variants?.edges?.[0]?.node;
  if (!variant || !variant.id) return null;

  const amount = variant.price?.amount;
  if (amount == null) return null;
  const priceCents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(priceCents) || priceCents < 0) return null;

  const currency = (variant.price?.currencyCode ?? "USD").toLowerCase();

  return {
    shopify_product_id: node.id,
    shopify_variant_id: variant.id,
    handle: node.handle,
    sku: variant.sku ?? node.handle,
    title: node.title,
    description: node.description ?? null,
    image_url: node.featuredImage?.url ?? null,
    price_cents: priceCents,
    currency,
    category: node.productType ? node.productType.toLowerCase() : null,
    inventory_qty:
      typeof variant.quantityAvailable === "number" ? variant.quantityAvailable : null,
    available: Boolean(node.availableForSale),
    last_synced_at: new Date().toISOString(),
  };
}

async function invalidateWorkerCache(
  workerUrl: string,
  serviceRoleKey: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(
      `${workerUrl.replace(/\/$/, "")}/api/_internal/shop/cache-invalidate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ reason: "shopify_catalog_sync" }),
      },
    );
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error).message };
  }
}

async function writeCursor(
  client: SupabaseClient,
  patch: {
    last_run_at: string;
    last_ok_at: string | null;
    last_error: string | null;
    products_upserted: number;
    products_archived: number;
  },
): Promise<void> {
  await client.from("shopify_sync_cursor").update(patch).eq("id", 1);
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "method not allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const SHOPIFY_STORE_DOMAIN = Deno.env.get("SHOPIFY_STORE_DOMAIN") ?? "";
  const SHOPIFY_STOREFRONT_TOKEN = Deno.env.get("SHOPIFY_STOREFRONT_TOKEN") ?? "";
  const MANELINE_WORKER_URL = Deno.env.get("MANELINE_WORKER_URL") ?? "";

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ ok: false, error: "missing_supabase_env" }, 500);
  }

  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_STOREFRONT_TOKEN) {
    // Placeholder-safe: record the skip in the cursor so
    // /api/_integrations-health can report shopify as "mock" without
    // keeping a stale last_ok_at alive.
    const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await writeCursor(client, {
      last_run_at: new Date().toISOString(),
      last_ok_at: null,
      last_error: "shopify_not_configured",
      products_upserted: 0,
      products_archived: 0,
    });
    return json({ ok: true, skipped: "shopify_not_configured" });
  }

  const startedAt = Date.now();
  const client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Leg 1: paginate Shopify Storefront + upsert ---
  const seenProductIds = new Set<string>();
  let upserted = 0;
  let cursor: string | null = null;
  let pages = 0;

  try {
    while (true) {
      const page: ProductsPage = await storefrontFetch(
        SHOPIFY_STORE_DOMAIN,
        SHOPIFY_STOREFRONT_TOKEN,
        cursor,
      );
      pages += 1;

      const rows: ProductRow[] = [];
      for (const edge of page.edges) {
        const row = nodeToRow(edge.node);
        if (!row) continue;
        rows.push(row);
        seenProductIds.add(row.shopify_product_id);
      }

      if (rows.length > 0) {
        const { error } = await client
          .from("products")
          .upsert(rows, { onConflict: "shopify_product_id" });
        if (error) throw new Error(`upsert: ${error.message}`);
        upserted += rows.length;
      }

      if (!page.pageInfo.hasNextPage) break;
      cursor = page.pageInfo.endCursor;
      if (!cursor) break;

      // Safety rail: 40 pages * 250 = 10,000 products. Well past SLH.
      if (pages > 40) {
        throw new Error("too_many_pages");
      }
    }
  } catch (err) {
    const message = (err as Error).message || "shopify_sync_failed";
    await writeCursor(client, {
      last_run_at: new Date().toISOString(),
      last_ok_at: null,
      last_error: message.slice(0, 500),
      products_upserted: upserted,
      products_archived: 0,
    });
    return json({ ok: false, error: message, upserted }, 502);
  }

  // --- Leg 2: soft-archive rows that fell out of the Shopify feed ---
  let archived = 0;
  try {
    // Fetch live product ids in one shot (SLH catalog is small).
    const { data: liveRows, error: liveErr } = await client
      .from("products")
      .select("id,shopify_product_id")
      .is("archived_at", null);
    if (liveErr) throw new Error(`select_live: ${liveErr.message}`);

    const toArchive: string[] = [];
    for (const row of liveRows ?? []) {
      if (!seenProductIds.has(row.shopify_product_id)) {
        toArchive.push(row.id);
      }
    }

    if (toArchive.length > 0) {
      const { error: archErr } = await client
        .from("products")
        .update({ available: false, archived_at: new Date().toISOString() })
        .in("id", toArchive);
      if (archErr) throw new Error(`archive: ${archErr.message}`);
      archived = toArchive.length;
    }
  } catch (err) {
    const message = (err as Error).message || "archive_failed";
    await writeCursor(client, {
      last_run_at: new Date().toISOString(),
      last_ok_at: null,
      last_error: message.slice(0, 500),
      products_upserted: upserted,
      products_archived: archived,
    });
    return json({ ok: false, error: message, upserted, archived }, 500);
  }

  // --- Leg 3: cursor bookkeeping ---
  const finishedAt = new Date().toISOString();
  await writeCursor(client, {
    last_run_at: finishedAt,
    last_ok_at: finishedAt,
    last_error: null,
    products_upserted: upserted,
    products_archived: archived,
  });

  // --- Leg 4: best-effort Worker KV cache invalidation ---
  let cacheInvalidated: Record<string, unknown> = { attempted: false };
  if (MANELINE_WORKER_URL) {
    const bust = await invalidateWorkerCache(
      MANELINE_WORKER_URL,
      SUPABASE_SERVICE_ROLE_KEY,
    );
    cacheInvalidated = { attempted: true, ...bust };
  }

  return json({
    ok: true,
    upserted,
    archived,
    pages,
    duration_ms: Date.now() - startedAt,
    cache: cacheInvalidated,
  });
});
