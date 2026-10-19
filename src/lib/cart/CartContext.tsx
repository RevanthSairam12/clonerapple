'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';

export interface CartItem {
  id: string; // Composite key: `${productId}::${color || ''}::${model || ''}`
  productId: string;
  name: string;
  subtitle?: string;
  price: number;
  priceDisplay?: string;
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

interface CartContextValue {
  items: CartItem[];
  totalCount: number;
  totalAmount: number;
  addItem: (item: CartItemInput) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, qty: number) => void;
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
        setItems(parsed);
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
      if (value === null) return;
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          setItems(parsed);
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

  const addItem = useCallback(
    (input: CartItemInput) => {
      const lineId = input.id || `${input.productId}::${input.color || ''}::${input.model || ''}`;
      const qtyToAdd = input.quantity && input.quantity > 0 ? input.quantity : 1;

      setItems((prev) => {
        const existingIdx = prev.findIndex((i) => i.id === lineId);
        if (existingIdx >= 0) {
          const updated = [...prev];
          const curr = updated[existingIdx];
          const newQty = curr.quantity + qtyToAdd;
          updated[existingIdx] = {
            ...curr,
            quantity: newQty,
          };
          setLastAddedItem(updated[existingIdx]);
          return updated;
        }

        const newItem: CartItem = {
          id: lineId,
          productId: input.productId,
          name: input.name,
          subtitle: input.subtitle,
          price: input.price,
          priceDisplay: input.priceDisplay || `₹${input.price.toLocaleString('en-IN')}`,
          image: input.image,
          color: input.color,
          model: input.model,
          quantity: qtyToAdd,
          href: input.href || `/shop/product/${encodeURIComponent(input.productId)}`,
        };

        setLastAddedItem(newItem);
        return [newItem, ...prev];
      });

      triggerBadgeBounce();
      setIsBagOpen(true);
    },
    [triggerBadgeBounce]
  );

  const removeItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id: string, qty: number) => {
    if (qty <= 0) {
      setItems((prev) => prev.filter((i) => i.id !== id));
    } else {
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, quantity: Math.min(qty, 50) } : i))
      );
    }
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
      // Also drop the pre-rename key: otherwise a cart that was never migrated
      // (both keys present) would be restored on the next mount.
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

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
      totalAmount,
      addItem,
      removeItem,
      updateQuantity,
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
      totalAmount,
      addItem,
      removeItem,
      updateQuantity,
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
