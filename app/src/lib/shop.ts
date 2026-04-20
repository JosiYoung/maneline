import { supabase } from "./supabase";

// Shop data layer — thin wrapper over the Worker's
// /api/shop/products and /api/shop/products/:handle endpoints.
//
// We go through the Worker (not supabase-js directly) because the
// Worker owns the KV edge cache for the catalog (5-min TTL, keys
// shop:v1:list + shop:v1:handle:<handle>) and also handles the
// on-demand fallback to Shopify when a handle hasn't been synced
// yet. See worker.js handleShopProductsList / handleShopProductByHandle.

export interface ShopProduct {
  id: string | null;                // null when served from Shopify fallback
  shopify_variant_id: string;       // stable id used as cart key + checkout payload
  handle: string;
  sku: string;
  title: string;
  description: string | null;
  image_url: string | null;
  price_cents: number;
  currency: string;                 // 'usd'
  category: string | null;
  inventory_qty: number | null;
  available: boolean;
  last_synced_at: string;
}

export interface ShopListResponse {
  products: ShopProduct[];
  categories: string[];
}

export const SHOP_PRODUCTS_QUERY_KEY = ["shop", "products"] as const;
export const SHOP_PRODUCT_QUERY_KEY = ["shop", "product"] as const;

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return { Authorization: `Bearer ${token}` };
}

export async function listProducts(category?: string): Promise<ShopListResponse> {
  const headers = await authHeader();
  const res = await fetch("/api/shop/products", { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Shop list failed (${res.status})`);
  }
  const json = (await res.json()) as ShopListResponse;
  if (!category) return json;
  return {
    products: json.products.filter((p) => p.category === category),
    categories: json.categories,
  };
}

export async function getProduct(handle: string): Promise<ShopProduct> {
  const headers = await authHeader();
  const res = await fetch(`/api/shop/products/${encodeURIComponent(handle)}`, {
    headers,
  });
  if (res.status === 404) {
    throw new Error("Product not found.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Shop product failed (${res.status})`);
  }
  const json = (await res.json()) as { product: ShopProduct };
  return json.product;
}

const PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatPrice(cents: number): string {
  return PRICE_FORMATTER.format((cents ?? 0) / 100);
}

export interface CheckoutItemPayload {
  variant_id: string;
  qty: number;
}

export interface CheckoutResponse {
  url: string;
  order_id: string;
  status: "pending_payment" | "awaiting_merchant_setup";
}

// Mints a hosted Stripe Checkout Session via the Worker and returns
// the redirect URL. Owner JWT required. The Worker re-resolves each
// variant_id against `products` server-side, so prices can't be
// spoofed from the SPA.
export async function createCheckout(
  items: CheckoutItemPayload[]
): Promise<CheckoutResponse> {
  const headers = {
    ...(await authHeader()),
    "content-type": "application/json",
  };
  const res = await fetch("/api/shop/checkout", {
    method: "POST",
    headers,
    body: JSON.stringify({ items }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Checkout failed (${res.status})`);
  }
  return body as CheckoutResponse;
}

// Phase 3.8 — in-expense one-tap purchase. The SPA sends a single
// cart item plus an `expense_draft` payload. The Worker validates
// trainer access to the animal (if recorder_role='trainer') before
// minting the Checkout Session, stamps `source='in_expense'`, and on
// webhook completion auto-creates the matching `expenses` row with
// `order_id` + `product_id` stamped in. See phase-3-plan.md §3.8.
export interface ExpenseDraftPayload {
  animal_id: string;
  recorder_role: "owner" | "trainer";
  category: "supplement";
  occurred_on: string;          // YYYY-MM-DD
  notes?: string | null;
}

export async function createExpenseDraftCheckout({
  variantId,
  expenseDraft,
}: {
  variantId: string;
  expenseDraft: ExpenseDraftPayload;
}): Promise<CheckoutResponse> {
  const headers = {
    ...(await authHeader()),
    "content-type": "application/json",
  };
  const res = await fetch("/api/shop/checkout", {
    method: "POST",
    headers,
    body: JSON.stringify({
      items: [{ variant_id: variantId, qty: 1 }],
      expense_draft: expenseDraft,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body?.error || `Checkout failed (${res.status})`);
  }
  return body as CheckoutResponse;
}
