'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { availabilityKey, stockBlocked, type AvailabilityLine, type PublicAvailabilityRead } from './availability-rules';

export interface AvailabilityState {
  saleLive: boolean;
  inStock: boolean;
  quantityAvailable: boolean;
  checked: boolean;
}
export interface UseAvailability extends AvailabilityState {
  blocked: boolean;
  variants: Record<string, boolean>;
  refresh: () => Promise<AvailabilityState | null>;
}

/** Stock validation, not presentation: sale mode never bypasses this check. */
export async function verifyAvailabilityLines(lines: AvailabilityLine[]): Promise<boolean | null> {
  if (!lines.length || lines.length > 50) return false;
  try {
    const response = await fetch(`/api/catalog/availability?lines=${encodeURIComponent(JSON.stringify(lines))}`, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json() as PublicAvailabilityRead;
    return lines.every((line) => {
      const row = (line.variantId ? body.variants : body.products)?.find((entry) =>
        availabilityKey(entry.id, entry.variantId) === availabilityKey(line.productId, line.variantId));
      return row?.quantityAvailable === true;
    });
  } catch { return null; }
}

export function useAvailability(
  productId: string,
  initial: { saleLive: boolean; inStock: boolean },
  selection?: { variantId?: string; quantity?: number; required?: boolean },
): UseAvailability {
  const key = availabilityKey(productId, selection?.variantId);
  const currentKey = useRef(key);
  currentKey.current = key;
  const [stored, setStored] = useState<{ key: string; state: AvailabilityState; variants: Record<string, boolean> }>({
    key, state: { saleLive: initial.saleLive, inStock: initial.inStock, quantityAvailable: initial.inStock, checked: false }, variants: {},
  });
  const state = stored.key === key ? stored.state
    : { saleLive: initial.saleLive, inStock: initial.inStock, quantityAvailable: initial.inStock, checked: false };
  const mounted = useRef(true);
  const variantId = selection?.variantId;
  const quantity = selection?.quantity ?? 1;
  const required = selection?.required ?? false;
  const refresh = useCallback(async (): Promise<AvailabilityState | null> => {
    if (!productId) return null;
    try {
      const lines = [{ productId, variantId, quantity }];
      const response = await fetch(`/api/catalog/availability?lines=${encodeURIComponent(JSON.stringify(lines))}`, { cache: 'no-store' });
      if (!response.ok) return null;
      const body = await response.json() as PublicAvailabilityRead;
      const row = (variantId ? body.variants : body.products)?.find((entry) =>
        availabilityKey(entry.id, entry.variantId) === key);
      if (!row || typeof row.inStock !== 'boolean') return null;
      const next = { saleLive: Boolean(body.saleLive), inStock: row.inStock,
        quantityAvailable: row.quantityAvailable === true, checked: true };
      if (mounted.current && currentKey.current === key) setStored({ key, state: next,
        variants: Object.fromEntries((body.variants ?? []).filter((entry) => entry.id === productId && entry.variantId).map((entry) => [entry.variantId!, entry.inStock])) });
      return next;
    } catch { return null; }
  }, [productId, variantId, quantity, key]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; };
  }, [refresh]);
  return { ...state, variants: stored.variants,
    blocked: (required && !variantId) ? false : stockBlocked(state.inStock, state.saleLive), refresh };
}
