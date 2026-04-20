// ============================================================
// ManeLine — Shopify Storefront GraphQL client (Phase 3.2)
// ------------------------------------------------------------
// Thin fetch-based wrapper around the Shopify Storefront API.
// Read-only (products, variants, inventory). No SDK.
//
// Called by:
//   • supabase/functions/shopify-catalog-sync (primary) — wraps the
//     same GraphQL shape in Deno for the cron sync.
//   • worker.js /api/shop/products/:handle (fallback) — if an owner
//     deep-links to a handle that hasn't been synced yet, the Worker
//     can fetch it on-demand from Shopify.
//
// Env:
//   SHOPIFY_STORE_DOMAIN      e.g. silver-lining-herbs.myshopify.com
//   SHOPIFY_STOREFRONT_TOKEN  unauth'd storefront token (read catalog)
//
// Placeholder-safety: callers MUST check shopifyConfigured(env)
// before calling. Missing env → throws `Error('shopify_not_configured')`.
// ============================================================

const STOREFRONT_API_VERSION = '2024-10';

export function shopifyConfigured(env) {
  return (
    typeof env.SHOPIFY_STORE_DOMAIN === 'string' &&
    env.SHOPIFY_STORE_DOMAIN.length > 0 &&
    typeof env.SHOPIFY_STOREFRONT_TOKEN === 'string' &&
    env.SHOPIFY_STOREFRONT_TOKEN.length > 0
  );
}

function storefrontUrl(env) {
  // Normalize: accept myshopify.com domain with or without scheme.
  const raw = env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${raw}/api/${STOREFRONT_API_VERSION}/graphql.json`;
}

async function storefrontFetch(env, query, variables = {}) {
  if (!shopifyConfigured(env)) {
    throw new Error('shopify_not_configured');
  }

  const res = await fetch(storefrontUrl(env), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Shopify-Storefront-Access-Token': env.SHOPIFY_STOREFRONT_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`shopify_${res.status}: ${text.slice(0, 200)}`);
  }

  const body = await res.json();
  if (body?.errors) {
    throw new Error(`shopify_graphql: ${JSON.stringify(body.errors).slice(0, 300)}`);
  }
  return body?.data ?? null;
}

// ---------------------------------------------------------------
// Products page (cursor-paginated, 250/page — Storefront max).
// ---------------------------------------------------------------
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

export async function fetchProductsPage(env, cursor = null) {
  const data = await storefrontFetch(env, PRODUCTS_QUERY, { cursor });
  const conn = data?.products ?? { edges: [], pageInfo: { hasNextPage: false, endCursor: null } };
  return {
    edges: conn.edges ?? [],
    hasNextPage: Boolean(conn.pageInfo?.hasNextPage),
    endCursor: conn.pageInfo?.endCursor ?? null,
  };
}

// ---------------------------------------------------------------
// Single product by handle. Used by the /api/shop/products/:handle
// fallback when the local cache hasn't seen the handle yet.
// ---------------------------------------------------------------
const PRODUCT_BY_HANDLE_QUERY = `
query ProductByHandle($handle: String!) {
  productByHandle(handle: $handle) {
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
`;

export async function fetchProductByHandle(env, handle) {
  const data = await storefrontFetch(env, PRODUCT_BY_HANDLE_QUERY, { handle });
  return data?.productByHandle ?? null;
}

// ---------------------------------------------------------------
// Shape helper — flattens a Shopify GraphQL product edge into the
// columns `public.products` expects. Shared between the Edge
// Function (Deno) and any Worker on-demand fallback.
// ---------------------------------------------------------------
export function shopifyNodeToProductRow(node) {
  if (!node) return null;
  const variantEdge = node.variants?.edges?.[0];
  const variant = variantEdge?.node ?? null;
  if (!variant) return null;

  const amount = variant.price?.amount;
  const currency = (variant.price?.currencyCode || 'USD').toLowerCase();
  // Shopify returns decimal strings ("18.50"). Convert to integer cents.
  const priceCents =
    typeof amount === 'string' || typeof amount === 'number'
      ? Math.round(Number(amount) * 100)
      : null;
  if (priceCents == null || Number.isNaN(priceCents)) return null;

  return {
    shopify_product_id: node.id,
    shopify_variant_id: variant.id,
    handle: node.handle,
    sku: variant.sku || node.handle,
    title: node.title,
    description: node.description ?? null,
    image_url: node.featuredImage?.url ?? null,
    price_cents: priceCents,
    currency,
    category: node.productType ? String(node.productType).toLowerCase() : null,
    inventory_qty: typeof variant.quantityAvailable === 'number' ? variant.quantityAvailable : null,
    available: Boolean(node.availableForSale),
    last_synced_at: new Date().toISOString(),
  };
}
