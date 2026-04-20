// ============================================================
// ManeLine — Shopify Admin GraphQL client (Phase 3.5, optional)
// ------------------------------------------------------------
// Thin wrapper for the Shopify Admin API, used ONLY when we want
// the Worker to decrement inventory after a successful checkout.
//
// Env (SECRET, optional):
//   SHOPIFY_ADMIN_API_TOKEN    — Admin access token with
//                                `write_inventory` scope
//   SHOPIFY_STORE_DOMAIN       — reused from the Storefront client
//
// Placeholder-safety: if SHOPIFY_ADMIN_API_TOKEN is unset, every
// exported function is a no-op that returns { ok: true, skipped: true }.
// We log a TECH_DEBT(phase-3) line once per process so the behavior
// is visible in `wrangler tail` without spamming.
//
// Until the Silver Lining Admin token is provisioned, Shopify
// continues to be the source of truth via the hourly catalog sync —
// i.e. inventory lag is bounded to ~1h. When the token lands, this
// module closes the loop end-to-end.
// ============================================================

const ADMIN_API_VERSION = '2024-10';

let warnedMissingToken = false;

export function shopifyAdminConfigured(env) {
  return (
    typeof env.SHOPIFY_ADMIN_API_TOKEN === 'string' &&
    env.SHOPIFY_ADMIN_API_TOKEN.length > 0 &&
    typeof env.SHOPIFY_STORE_DOMAIN === 'string' &&
    env.SHOPIFY_STORE_DOMAIN.length > 0
  );
}

function adminUrl(env) {
  const raw = env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${raw}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
}

async function adminFetch(env, query, variables = {}) {
  const res = await fetch(adminUrl(env), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_API_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      status: res.status,
      error: 'shopify_admin_http',
      message: text.slice(0, 300),
    };
  }
  const body = await res.json();
  if (body?.errors) {
    return {
      ok: false,
      status: 200,
      error: 'shopify_admin_graphql',
      message: JSON.stringify(body.errors).slice(0, 300),
    };
  }
  return { ok: true, status: 200, data: body?.data ?? null };
}

// ---------------------------------------------------------------
// Resolve a variant id → inventory_item_id + one location id.
// The 2024-10 inventory mutations require the InventoryItem gid,
// not the variant gid. We also need a Location id to scope the
// adjustment; for a single-location Silver Lining storefront we
// just pick the first (active) location.
// ---------------------------------------------------------------
const VARIANT_LOOKUP_QUERY = `
query VariantInventory($id: ID!) {
  productVariant(id: $id) {
    id
    inventoryItem { id }
  }
  locations(first: 1, query: "status:active") {
    edges { node { id } }
  }
}
`;

/**
 * Decrement a single variant's inventory by `delta` (positive int
 * for a sale — we pass a negative `delta` to the mutation).
 *
 * Returns { ok, skipped?, error?, message? }. Never throws.
 * Callers (the webhook) SHOULD await but MUST NOT let a Shopify
 * failure block the order.paid commit — webhook retries Stripe
 * but should not replay the paid flip.
 */
export async function adjustInventory(env, { shopifyVariantId, delta }) {
  if (!shopifyAdminConfigured(env)) {
    if (!warnedMissingToken) {
      warnedMissingToken = true;
      // TECH_DEBT(phase-3): logged once per process until
      // SHOPIFY_ADMIN_API_TOKEN is provisioned.
      console.log(
        'TECH_DEBT(phase-3): SHOPIFY_ADMIN_API_TOKEN unset — skipping inventory adjust. Hourly sync will reconcile.'
      );
    }
    return { ok: true, skipped: true };
  }
  if (!shopifyVariantId || !Number.isInteger(delta) || delta === 0) {
    return { ok: false, error: 'bad_args' };
  }

  const lookup = await adminFetch(env, VARIANT_LOOKUP_QUERY, { id: shopifyVariantId });
  if (!lookup.ok) return lookup;
  const inventoryItemId = lookup.data?.productVariant?.inventoryItem?.id;
  const locationId = lookup.data?.locations?.edges?.[0]?.node?.id;
  if (!inventoryItemId || !locationId) {
    return { ok: false, error: 'inventory_item_not_found' };
  }

  // 2024-10 uses `inventoryAdjustQuantities` (plural) with a delta.
  const MUTATION = `
    mutation InventoryAdjust($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) {
        userErrors { field message }
      }
    }
  `;
  const input = {
    reason: 'other',
    name: 'available',
    referenceDocumentUri: 'maneline://order',
    changes: [{
      delta,
      inventoryItemId,
      locationId,
    }],
  };
  const res = await adminFetch(env, MUTATION, { input });
  if (!res.ok) return res;
  const userErrors = res.data?.inventoryAdjustQuantities?.userErrors ?? [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      error: 'inventory_adjust_user_error',
      message: JSON.stringify(userErrors).slice(0, 300),
    };
  }
  return { ok: true };
}
