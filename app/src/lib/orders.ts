import { supabase } from "./supabase";

// Owner-scope reads of orders + order_line_items. Proxied through
// the Worker (not supabase-js directly) so the Worker is a single
// point to add logging / rate limits / caching later. RLS on both
// tables (owner_id = auth.uid()) is the authorization backstop.

export type OrderStatus =
  | "pending_payment"
  | "paid"
  | "failed"
  | "refunded"
  | "awaiting_merchant_setup";

export interface OrderRow {
  id: string;
  status: OrderStatus;
  subtotal_cents: number;
  tax_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  source: "shop" | "in_expense";
  created_at: string;
  stripe_checkout_session_id: string | null;
  stripe_receipt_url: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

export interface OrderListRow {
  id: string;
  status: OrderStatus;
  subtotal_cents: number;
  tax_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  source: "shop" | "in_expense";
  created_at: string;
  stripe_receipt_url: string | null;
  line_count: number;
  unit_count: number;
}

export interface OrderLineItem {
  id: string;
  product_id: string | null;
  shopify_variant_id: string;
  sku_snapshot: string;
  title_snapshot: string;
  unit_price_cents: number;
  quantity: number;
  line_total_cents: number;
}

export type OrderRefundStatus = "pending" | "succeeded" | "failed" | "canceled";

export interface OrderRefundRow {
  id: string;
  amount_cents: number;
  reason: string | null;
  stripe_status: OrderRefundStatus;
  created_at: string;
}

export interface OrderDetailResponse {
  order: OrderRow;
  line_items: OrderLineItem[];
  refunds: OrderRefundRow[];
}

// Admin-scope shapes — service_role reads, so owner_id + owner_email +
// owner_display_name are hydrated Worker-side from user_profiles.
export interface AdminOrderListRow {
  id: string;
  owner_id: string;
  owner_email: string | null;
  owner_display_name: string | null;
  status: OrderStatus;
  source: "shop" | "in_expense";
  subtotal_cents: number;
  tax_cents: number;
  shipping_cents: number;
  total_cents: number;
  currency: string;
  created_at: string;
}

export interface AdminOrderRow extends AdminOrderListRow {
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  stripe_charge_id: string | null;
  stripe_receipt_url: string | null;
  failure_code: string | null;
  failure_message: string | null;
}

export interface AdminOrderRefundRow extends OrderRefundRow {
  order_id: string;
  stripe_refund_id: string | null;
  refunded_by: string | null;
  last_error: string | null;
  updated_at: string;
}

export interface AdminOrderDetailResponse {
  order: AdminOrderRow;
  line_items: OrderLineItem[];
  refunds: AdminOrderRefundRow[];
}

export interface AdminOrderListResponse {
  rows: AdminOrderListRow[];
  total: number;
  page: number;
  limit: number;
}

async function authHeader(): Promise<Record<string, string>> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  return { Authorization: `Bearer ${token}` };
}

export async function getOrder(orderId: string): Promise<OrderDetailResponse> {
  const headers = await authHeader();
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`, {
    headers,
  });
  if (res.status === 404) {
    throw new Error("Order not found.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Order read failed (${res.status})`);
  }
  return (await res.json()) as OrderDetailResponse;
}

export async function listMyOrders(): Promise<OrderListRow[]> {
  const headers = await authHeader();
  const res = await fetch("/api/orders", { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Orders list failed (${res.status})`);
  }
  const json = (await res.json()) as { orders: OrderListRow[] };
  return json.orders;
}

export const ORDER_QUERY_KEY = ["orders", "detail"] as const;
export const ORDERS_LIST_QUERY_KEY = ["orders", "list"] as const;
export const ADMIN_ORDERS_LIST_QUERY_KEY = ["admin", "orders", "list"] as const;
export const ADMIN_ORDER_QUERY_KEY = ["admin", "orders", "detail"] as const;

export interface AdminOrdersListParams {
  q?: string;
  status?: OrderStatus | "";
  page?: number;
}

export async function listAdminOrders(
  params: AdminOrdersListParams = {}
): Promise<AdminOrderListResponse> {
  const headers = await authHeader();
  const qs = new URLSearchParams();
  if (params.q) qs.set("q", params.q);
  if (params.status) qs.set("status", params.status);
  if (params.page) qs.set("page", String(params.page));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`/api/admin/orders${suffix}`, { headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Admin orders list failed (${res.status})`);
  }
  return (await res.json()) as AdminOrderListResponse;
}

export async function getAdminOrder(orderId: string): Promise<AdminOrderDetailResponse> {
  const headers = await authHeader();
  const res = await fetch(`/api/admin/orders/${encodeURIComponent(orderId)}`, {
    headers,
  });
  if (res.status === 404) {
    throw new Error("Order not found.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Admin order read failed (${res.status})`);
  }
  return (await res.json()) as AdminOrderDetailResponse;
}

export interface RefundOrderInput {
  amount_cents: number;
  reason: string;
}

export interface RefundOrderResponse {
  refund: AdminOrderRefundRow;
}

export async function refundAdminOrder(
  orderId: string,
  input: RefundOrderInput
): Promise<RefundOrderResponse> {
  const headers = await authHeader();
  const res = await fetch(
    `/api/admin/orders/${encodeURIComponent(orderId)}/refund`,
    {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(input),
    }
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error || `Refund failed (${res.status})`) as Error & {
      code?: string;
      status?: number;
      message_from_stripe?: string | null;
    };
    err.code = body?.error;
    err.status = res.status;
    err.message_from_stripe = body?.message ?? null;
    throw err;
  }
  return body as RefundOrderResponse;
}
