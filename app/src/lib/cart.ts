import { useEffect, useState, useCallback } from "react";

// Cart lives in sessionStorage — abandoned carts are not auditable
// data, so we deliberately skip the Supabase round-trip. See
// docs/phase-3-plan.md Prompt 3.4.
//
// Shape on disk:
//   { items: [{ variantId: string, qty: number }] }
//
// Cross-tab sync: we emit both the native `storage` event (fires in
// OTHER tabs when sessionStorage writes) and a custom "ml:cart"
// event on window so the SAME tab can subscribe too. Same-tab
// writes don't trigger `storage`, hence the custom event.

const STORAGE_KEY = "ml:cart:v1";
const CUSTOM_EVENT = "ml:cart";

export interface CartItem {
  variantId: string;
  qty: number;
}

export interface CartState {
  items: CartItem[];
}

function readRaw(): CartState {
  if (typeof window === "undefined") return { items: [] };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [] };
    const parsed = JSON.parse(raw) as CartState;
    if (!parsed || !Array.isArray(parsed.items)) return { items: [] };
    return {
      items: parsed.items
        .filter(
          (i): i is CartItem =>
            !!i &&
            typeof i.variantId === "string" &&
            i.variantId.length > 0 &&
            Number.isFinite(i.qty) &&
            i.qty > 0
        )
        .map((i) => ({ variantId: i.variantId, qty: Math.floor(i.qty) })),
    };
  } catch {
    return { items: [] };
  }
}

function writeRaw(next: CartState) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(CUSTOM_EVENT));
}

export function getCart(): CartState {
  return readRaw();
}

export function addItem(variantId: string, qty = 1): CartState {
  const state = readRaw();
  const existing = state.items.find((i) => i.variantId === variantId);
  const next: CartState = existing
    ? {
        items: state.items.map((i) =>
          i.variantId === variantId ? { ...i, qty: i.qty + qty } : i
        ),
      }
    : { items: [...state.items, { variantId, qty }] };
  writeRaw(next);
  return next;
}

export function setQty(variantId: string, qty: number): CartState {
  if (qty <= 0) return removeItem(variantId);
  const state = readRaw();
  const next: CartState = {
    items: state.items.map((i) =>
      i.variantId === variantId ? { ...i, qty: Math.floor(qty) } : i
    ),
  };
  writeRaw(next);
  return next;
}

export function removeItem(variantId: string): CartState {
  const state = readRaw();
  const next: CartState = {
    items: state.items.filter((i) => i.variantId !== variantId),
  };
  writeRaw(next);
  return next;
}

export function clearCart(): CartState {
  const next: CartState = { items: [] };
  writeRaw(next);
  return next;
}

export function cartLineCount(state: CartState): number {
  return state.items.reduce((sum, i) => sum + i.qty, 0);
}

export function useCart() {
  const [state, setState] = useState<CartState>(() => readRaw());

  useEffect(() => {
    const refresh = () => setState(readRaw());
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CUSTOM_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CUSTOM_EVENT, refresh);
    };
  }, []);

  return {
    items: state.items,
    lineCount: cartLineCount(state),
    addItem: useCallback((variantId: string, qty = 1) => addItem(variantId, qty), []),
    setQty: useCallback((variantId: string, qty: number) => setQty(variantId, qty), []),
    removeItem: useCallback((variantId: string) => removeItem(variantId), []),
    clear: useCallback(() => clearCart(), []),
  };
}
