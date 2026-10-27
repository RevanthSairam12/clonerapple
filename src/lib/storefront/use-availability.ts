'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { stockBlocked } from './availability-rules';

export interface AvailabilityState {
  saleLive: boolean;
  inStock: boolean;
  /** True once the click-time endpoint has answered at least once. */
  checked: boolean;
}

export interface UseAvailability {
  saleLive: boolean;
  inStock: boolean;
  checked: boolean;
  /** The single rule every surface uses to disable a purchase. */
  blocked: boolean;
  /** Re-read the endpoint; returns the fresh state, or null when it failed. */
  refresh: () => Promise<AvailabilityState | null>;
}

/**
 * Click-time availability for one product.
 *
 * The server-rendered props are the initial truth; the endpoint refreshes them
 * on mount and again on press, so a sale that went live after the page was
 * rendered removes the block, and a unit taken by someone else restores it.
 * A failed check keeps the last known state rather than inventing stock.
 */
export function useAvailability(
  productId: string,
  initial: { saleLive: boolean; inStock: boolean },
): UseAvailability {
  const [state, setState] = useState<AvailabilityState>({
    saleLive: initial.saleLive,
    inStock: initial.inStock,
    checked: false,
  });
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<AvailabilityState | null> => {
    if (!productId) return null;
    try {
      const response = await fetch(
        `/api/catalog/availability?ids=${encodeURIComponent(productId)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) return null;
      const body = await response.json().catch(() => null);
      const row = Array.isArray(body?.products)
        ? body.products.find((entry: { id?: unknown }) => String(entry?.id) === productId)
        : null;
      if (!row || typeof row.inStock !== 'boolean') return null;

      const next: AvailabilityState = {
        saleLive: Boolean(body.saleLive),
        inStock: row.inStock,
        checked: true,
      };
      if (mounted.current) setState(next);
      return next;
    } catch {
      return null;
    }
  }, [productId]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  return {
    ...state,
    blocked: stockBlocked(state.inStock, state.saleLive),
    refresh,
  };
}
