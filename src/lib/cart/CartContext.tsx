'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { buildCartLineId, normalizeCartLineId } from './cart-id';
import { verifyAvailabilityLines } from '@/lib/storefront/use-availability';
import { verifySelections, priceNeedsReview, type SelectionPrice } from '@/lib/storefront/selection';

export type AddItemResult =
  | { status: 'added' }
  | { status: 'price_changed'; price: SelectionPrice; message: string }
  | { status: 'unavailable' | 'verification_failed' | 'invalid_quantity' | 'stale'; message: string };

export interface CartItem {
  variantId?: string;
  variantSku?: string;
  variantLabel?: string;
  id: string; // Composite key: `${productId}::${color || ''}::${model || ''}`
  productId: string;
  name: string;
  subtitle?: string;
  price: number;
  priceDisplay?: string;
  /** The regular price shown struck through while a sale is live. */
  regularPrice?: number;
  wasPriceDisplay?: string;
  image: string;
  color?: string;
  model?: string;
  quantity: number;
  href?: string;
}

export type CartItemInput = Omit<CartItem, 'id' | 'quantity'> & {
  quantity?: number;
  id?: string;
};

/** An authoritative price for one product, in integer paise. */
export interface CartPriceUpdate {
  variantId?: string;
  /** The product id (any line id is normalised to its base id). */
  id: string;
  unitPaise: number;
  regularPricePaise?: number | null;
}

interface CartContextValue {
  items: CartItem[];
  totalCount: number;
  stockNotice: string | null;
  totalAmount: number;
  addItem: (item: CartItemInput, options?: { signal?: AbortSignal }) => Promise<AddItemResult>;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
  /**
   * Replace stored line prices with the server's authoritative ones. Used
   * after a `price_changed` conflict; the server still charges its own value.
   */
  syncPrices: (updates: CartPriceUpdate[]) => void;
  clearCart: () => void;
  isBagOpen: boolean;
  setIsBagOpen: (open: boolean) => void;
  toggleBag: () => void;
  lastAddedItem: CartItem | null;
  badgeBouncing: boolean;
  /** True once the cart has been read from localStorage on the client. */
  isHydrated: boolean;
}

/**
 * Cart persistence keys.
 *
 * `gadzio_cart_v1` is current. `gadzio_apple_cart_v1` is the key used before
 * the de-brand rename; a cart saved under it is migrated forward on first
 * mount (and adopted if a still-open older tab writes to it), then the old key
 * is deleted so it cannot resurface. No saved cart is lost by the rename.
 */
const STORAGE_KEY = 'gadzio_cart_v1';
const LEGACY_STORAGE_KEY = 'gadzio_apple_cart_v1';

/** Read the pre-rename cart, or null when there is none / storage is blocked. */
function readLegacyCart(): string | null {
  try {
    return localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Write a cart forward to the current key, then drop the pre-rename key. */
function retireLegacyCart(value: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, value);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

type CartStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function migrateStoredItems(value: unknown): CartItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is CartItem => item && typeof item === 'object')
    .map((item) => {
      const normalized = normalizeCartLineId(item.id || item.productId);
      return {
        ...item,
        id: item.variantId ? buildCartLineId({ productId: item.productId || normalized.baseId || '', variantId: item.variantId }) : item.id || normalized.baseId || '',
        productId: item.productId || normalized.baseId || '',
        color: item.color || normalized.color,
        model: item.model || normalized.model,
        subtitle: item.subtitle || normalized.variantLabel,
      };
    })
    .filter((item) => item.id && item.productId);
}

/**
 * The cart JSON to restore on mount, migrating a pre-rename cart forward when
 * the current key is empty. Returns null when there is nothing usable.
 *
 * The legacy value is only promoted once it has proved to be a JSON array, so
 * a corrupt old cart can never overwrite a good current one — and it is deleted
 * either way, so it cannot resurface later. Exported so the migration can be
 * exercised directly.
 */
export function readStoredCart(storage: CartStorage): string | null {
  const current = storage.getItem(STORAGE_KEY);
  if (current !== null) return current;

  const legacy = storage.getItem(LEGACY_STORAGE_KEY);
  if (legacy === null) return null;

  let usable = false;
  try {
    usable = Array.isArray(JSON.parse(legacy));
  } catch {
    usable = false;
  }

  if (!usable) {
    try {
      storage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
    return null;
  }

  try {
    storage.setItem(STORAGE_KEY, legacy);
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore storage errors — the value is still returned and applied
  }
  return legacy;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [stockNotice, setStockNotice] = useState<string | null>(null);
  const currentItems = React.useRef(items);
  const quantityGeneration = React.useRef(0);
  // Synchronous source updates prevent a second completion from overwriting a commit.
  const commitItems = useCallback((next: CartItem[]) => {
    quantityGeneration.current += 1;
    currentItems.current = next;
    setItems(next);
  }, []);
  const [isBagOpen, setIsBagOpen] = useState(false);
  const [lastAddedItem, setLastAddedItem] = useState<CartItem | null>(null);
  const [badgeBouncing, setBadgeBouncing] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  // Hydrate cart from localStorage on client mount
  useEffect(() => {
    try {
      const raw = readStoredCart(window.localStorage);
      if (raw === null) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        commitItems(migrateStoredItems(parsed));
      }
    } catch {
      // ignore JSON errors
    } finally {
      setHasHydrated(true);
    }
  }, []);

  // Save cart to localStorage on changes
  useEffect(() => {
    if (!hasHydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore storage quota errors
    }
  }, [items, hasHydrated]);

  // Synchronize across tabs
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      let value: string | null = null;
      if (e.key === STORAGE_KEY) {
        value = e.newValue;
      } else if (e.key === LEGACY_STORAGE_KEY) {
        // A tab still running the pre-rename build wrote the old key — adopt
        // it rather than ignoring the change.
        value = readLegacyCart();
        if (value !== null) retireLegacyCart(value);
      }
      if (e.key === STORAGE_KEY && value === null) { commitItems([]); return; }
      if (value === null) return;
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
           commitItems(migrateStoredItems(parsed));
        }
      } catch {
        // ignore
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const triggerBadgeBounce = useCallback(() => {
    setBadgeBouncing(true);
    setTimeout(() => setBadgeBouncing(false), 800);
  }, []);

  const addItem = useCallback(async (input: CartItemInput, options?: { signal?: AbortSignal }): Promise<AddItemResult> => {
    const ticket = ++quantityGeneration.current;
    const source = currentItems.current;
    const productId = normalizeCartLineId(input.productId).baseId;
    const quantity = input.quantity ?? 1;
    const reject = (result: Exclude<AddItemResult, { status: 'added' }>): AddItemResult => {
      setStockNotice(result.message);
      return result;
    };
    if (options?.signal?.aborted) return { status: 'stale', message: 'Selection changed. Please try again.' };
    if (!productId || (input.variantId !== undefined && (typeof input.variantId !== 'string' || !input.variantId.trim() || input.variantId.length > 256)) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 50) {
      return reject({ status: 'invalid_quantity', message: 'Choose a whole quantity between 1 and 50.' });
    }
    const id = (!input.variantId && input.id) || buildCartLineId({ productId, variantId: input.variantId, color: input.color, model: input.model });
    const existing = source.find(item => item.id === id);
    const addition: CartItem = { ...input, id, productId, quantity: (existing?.quantity ?? 0) + quantity,
      href: input.href || `/shop/product/${encodeURIComponent(productId)}` };
    const prospective = existing ? source.map(item => item.id === id ? addition : item) : [addition, ...source];
    if (prospective.length > 50 || prospective.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 50)) {
      return reject({ status: 'invalid_quantity', message: 'Review your bag: up to 50 lines and 1–50 units per line.' });
    }
    setStockNotice(null);
    const checked = await verifySelections(prospective.map(item => ({ productId: item.productId, variantId: item.variantId, quantity: item.quantity })), options?.signal);
    if (ticket !== quantityGeneration.current || currentItems.current !== source || options?.signal?.aborted) {
      return { status: 'stale', message: 'Your bag or selection changed. Please try again.' };
    }
    if (checked.status !== 'ready') return reject(checked);
    const selectedPrice = checked.prices[prospective.findIndex(item => item.id === id)];
    if (priceNeedsReview(input, selectedPrice)) {
      return reject({ status: 'price_changed', price: selectedPrice, message: 'The price changed. Review the updated price, then add again.' });
    }
    const next = prospective.map((item, index) => ({ ...item, ...checked.prices[index] }));
    commitItems(next);
    setLastAddedItem(next.find(item => item.id === id)!);
    triggerBadgeBounce();
    setIsBagOpen(true);
    return { status: 'added' };
  }, [commitItems, triggerBadgeBounce]);

  const removeItem = useCallback((id: string) => {
    commitItems(currentItems.current.filter((i) => i.id !== id));
  }, [commitItems]);

  const updateQuantity = useCallback(async (id: string, qty: number) => {
    const ticket = ++quantityGeneration.current;
    if (!Number.isSafeInteger(qty) || qty > 50) return;
    const source = currentItems.current;
    const item = source.find((entry) => entry.id === id);
    if (!item) return;
    setStockNotice(null);
    if (qty > item.quantity) {
      const valid = await verifyAvailabilityLines(source.map((entry) => ({ productId: entry.productId,
        variantId: entry.variantId, quantity: entry.id === id ? qty : entry.quantity })));
      if (ticket !== quantityGeneration.current || currentItems.current !== source) return;
      if (valid !== true) {
        setStockNotice(valid === false ? 'Stock not available for the requested quantity.' : 'Could not verify stock. Please try again.');
        return;
      }
    }
    commitItems(qty <= 0 ? source.filter((entry) => entry.id !== id)
      : source.map((entry) => entry.id === id ? { ...entry, quantity: qty } : entry));
  }, [commitItems]);

  const syncPrices = useCallback((updates: CartPriceUpdate[]) => {
    if (!Array.isArray(updates) || updates.length === 0) return;
    const byId = new Map<string, CartPriceUpdate>();
    for (const update of updates) {
      const baseId = normalizeCartLineId(update?.id).baseId;
      if (!baseId) continue;
      const unitPaise = Number(update.unitPaise);
      if (!Number.isSafeInteger(unitPaise) || unitPaise < 0) continue;
      byId.set(JSON.stringify([baseId.toLowerCase(), update.variantId || null]), { ...update, unitPaise });
    }
    if (byId.size === 0) return;

    {
      let changed = false;
      const next = currentItems.current.map((item) => {
        const baseId = normalizeCartLineId(item.productId || item.id).baseId;
        const update = baseId ? byId.get(JSON.stringify([baseId.toLowerCase(), item.variantId || null])) : undefined;
        if (!update) return item;

        const price = update.unitPaise / 100;
        const regularPaise = Number(update.regularPricePaise);
        const regularPrice =
          Number.isSafeInteger(regularPaise) && regularPaise > update.unitPaise
            ? regularPaise / 100
            : undefined;

        if (
          item.price === price
          && item.regularPrice === regularPrice
        ) {
          return item;
        }
        changed = true;
        return {
          ...item,
          price,
          priceDisplay: `₹${price.toLocaleString('en-IN')}`,
          regularPrice,
          wasPriceDisplay: regularPrice !== undefined
            ? `₹${regularPrice.toLocaleString('en-IN')}`
            : undefined,
        };
      });
      if (changed) commitItems(next);
    }
  }, [commitItems]);

  const clearCart = useCallback(() => {
    commitItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      // Also drop the pre-rename key: otherwise a cart that was never migrated
      // (both keys present) would be restored on the next mount.
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [commitItems]);

  const toggleBag = useCallback(() => {
    setIsBagOpen((open) => !open);
  }, []);

  const totalCount = useMemo(() => {
    return items.reduce((sum, item) => sum + item.quantity, 0);
  }, [items]);

  const totalAmount = useMemo(() => {
    return items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      totalCount,
      stockNotice,
      totalAmount,
      addItem,
      removeItem,
      updateQuantity,
      syncPrices,
      clearCart,
      isBagOpen,
      setIsBagOpen,
      toggleBag,
      lastAddedItem,
      badgeBouncing,
      isHydrated: hasHydrated,
    }),
    [
      items,
      totalCount,
      stockNotice,
      totalAmount,
      addItem,
      removeItem,
      updateQuantity,
      syncPrices,
      clearCart,
      isBagOpen,
      toggleBag,
      lastAddedItem,
      badgeBouncing,
      hasHydrated,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
