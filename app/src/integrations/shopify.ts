/**
 * Shopify Storefront integration — Phase 0 PLACEHOLDER.
 *
 * These wrappers expose the shape the rest of the app will call
 * starting in Phase 3. Today everything is mocked in-process so the
 * store UI can be built and smoke-tested without touching real
 * Shopify credentials.
 *
 * Credentials this module will read once live:
 *   SHOPIFY_STORE_DOMAIN      (e.g. silver-lining-herbs.myshopify.com)
 *   SHOPIFY_STOREFRONT_TOKEN  (unauth'd Storefront API — read-only catalog)
 *   SHOPIFY_ADMIN_API_TOKEN   (Admin API — only if server-side mutations needed)
 *
 * Flip plan: see docs/INTEGRATIONS.md §Shopify.
 */

export interface ShopifyMoney {
  amount: number;         // dollars, not cents — matches Storefront API
  currency_code: string;  // ISO 4217, e.g. "USD"
}

export interface ShopifyProduct {
  id: string;
  sku: string;
  title: string;
  description: string;
  image_url: string | null;
  price: ShopifyMoney;
  available: boolean;
}

export interface ShopifyLineItem {
  sku: string;
  quantity: number;
}

export interface ShopifyCheckout {
  id: string;
  url: string;          // hosted checkout URL the browser redirects to
  subtotal: ShopifyMoney;
}

// TODO(Phase 3): replace mock with real Shopify Storefront API call.
// See FEATURE_MAP §4.6.1.
export async function getProducts(): Promise<ShopifyProduct[]> {
  return MOCK_PRODUCTS;
}

// TODO(Phase 3): replace mock with real Shopify Storefront API call.
// See FEATURE_MAP §4.6.1.
export async function getProduct(sku: string): Promise<ShopifyProduct | null> {
  return MOCK_PRODUCTS.find((p) => p.sku === sku) ?? null;
}

// TODO(Phase 3): replace mock with real Shopify Storefront API call.
// See FEATURE_MAP §4.6.1.
export async function createCheckout(
  lineItems: ShopifyLineItem[]
): Promise<ShopifyCheckout> {
  const subtotalAmount = lineItems.reduce((sum, li) => {
    const product = MOCK_PRODUCTS.find((p) => p.sku === li.sku);
    return sum + (product ? product.price.amount * li.quantity : 0);
  }, 0);

  return {
    id: `mock_checkout_${Date.now()}`,
    url: 'https://mock-shopify.invalid/checkout/mock',
    subtotal: { amount: subtotalAmount, currency_code: 'USD' },
  };
}

/* -------------------------------------------------------------
   Mock catalog — two sample SKUs so the UI has something to render.
   ------------------------------------------------------------- */
const MOCK_PRODUCTS: ShopifyProduct[] = [
  {
    id: 'mock-prod-001',
    sku: 'SLH-GUT-30',
    title: 'Silver Lining Gut Formula — 30 day',
    description: 'Mock product. Replace in Phase 3.',
    image_url: null,
    price: { amount: 64.0, currency_code: 'USD' },
    available: true,
  },
  {
    id: 'mock-prod-002',
    sku: 'SLH-IMM-30',
    title: 'Silver Lining Immune Formula — 30 day',
    description: 'Mock product. Replace in Phase 3.',
    image_url: null,
    price: { amount: 72.0, currency_code: 'USD' },
    available: true,
  },
];
