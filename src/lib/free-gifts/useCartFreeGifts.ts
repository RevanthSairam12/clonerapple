'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCartLineBaseId } from '@/lib/cart/cart-id';
import type { CartFreeGiftEvaluateResponse } from '@/lib/free-gifts/rules';

export interface CartFreeGiftInputLine {
  id: string;
  productId?: string;
  variantId?: string | null;
  quantity: number;
}

export function readStoredCouponCode(): string | null {
  try {
    const raw = window.localStorage.getItem('gadzio_coupon_v1');
    const clean = raw ? raw.trim().toUpperCase() : '';
    return clean || null;
  } catch {
    return null;
  }
}

export function useCartFreeGifts({
  items,
  couponCode = null,
  email = '',
  enabled = true,
}: {
  items: readonly CartFreeGiftInputLine[];
  couponCode?: string | null;
  email?: string | null;
  enabled?: boolean;
}) {
  const [data, setData] = useState<CartFreeGiftEvaluateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const normalizedItemsJson = JSON.stringify(
    items
      .map((item) => {
        const id = getCartLineBaseId(item.productId || item.id) || item.id;
        return {
          id,
          variantId: item.variantId ?? null,
          quantity: Math.max(1, Math.min(50, Math.trunc(Number(item.quantity) || 1))),
        };
      })
      .filter((item) => Boolean(item.id)),
  );
  const cleanCoupon = couponCode ? couponCode.trim().toUpperCase() : '';
  const cleanEmail = email ? email.trim().toLowerCase() : '';
  const signature = `${enabled ? '1' : '0'}|${cleanCoupon}|${cleanEmail}|${normalizedItemsJson}`;

  const payload = useMemo(
    () => ({
      items: JSON.parse(normalizedItemsJson) as Array<{
        id: string;
        variantId: string | null;
        quantity: number;
      }>,
      couponCode: cleanCoupon || null,
      email: cleanEmail || null,
    }),
    [normalizedItemsJson, cleanCoupon, cleanEmail],
  );

  const refresh = useCallback(async () => {
    if (!enabled) return;
    if (payload.items.length === 0 && !payload.couponCode) {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setData(null);
      setLoading(false);
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const response = await fetch('/api/free-gifts/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      if (controller.signal.aborted) return;
      const body = (await response.json().catch(() => null)) as CartFreeGiftEvaluateResponse | null;
      if (response.ok && body && body.ok) {
        setData(body);
      }
    } catch {
      /* Advisory cart evaluation silently ignores aborted/transient calls */
    } finally {
      if (controllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, [enabled, payload]);

  useEffect(() => {
    if (!enabled) {
      controllerRef.current?.abort();
      return;
    }
    const timer = window.setTimeout(() => {
      void refresh();
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controllerRef.current?.abort();
    };
  }, [enabled, signature, refresh]);

  return { evaluation: data, loading, refresh };
}

