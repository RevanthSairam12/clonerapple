'use client';

import { useEffect, useRef, useState } from 'react';
import type { AddItemResult } from '@/lib/cart/CartContext';
import type { SelectionPrice } from './selection';

/** A rejected purchase is never replayed; another customer press must revalidate. */
export function usePurchaseAction(selectionKey: string) {
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState<{ key: string; price: SelectionPrice } | null>(null);
  const latestKey = useRef(selectionKey);
  const active = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Abort during the render that observes a new selection, not only after its
  // effect runs: the cart must see cancellation before a queued commit.
  if (latestKey.current !== selectionKey) {
    active.current?.abort();
    latestKey.current = selectionKey;
  }

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    if (timer.current) clearTimeout(timer.current);
    setPending(false);
    setAdded(false);
    setNotice(null);
    setReview(null);
    return () => {
      active.current?.abort();
      active.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [selectionKey]);

  async function run(
    action: (signal: AbortSignal) => Promise<AddItemResult>,
    onSuccess?: () => void,
    announceAdded = true,
  ) {
    if (active.current) return;
    const controller = new AbortController();
    const key = selectionKey;
    active.current = controller;
    setPending(true);
    setAdded(false);
    setNotice(null);
    if (timer.current) clearTimeout(timer.current);
    const current = () => !controller.signal.aborted && latestKey.current === key && active.current === controller;
    try {
      const result = await action(controller.signal);
      if (!current()) return;
      if (result.status === 'added') {
        if (announceAdded) {
          setAdded(true);
          timer.current = setTimeout(() => setAdded(false), 2500);
        }
        onSuccess?.();
      } else {
        if (result.status === 'price_changed') setReview({ key, price: result.price });
        setNotice(result.status === 'price_changed'
          ? `${result.message} Review the updated price and press again to continue.`
          : result.message);
      }
    } catch {
      if (current()) setNotice('Could not verify this selection. Please try again.');
    } finally {
      if (current()) {
        active.current = null;
        setPending(false);
      }
    }
  }

  return { pending, added, notice, setNotice, priceOverride: review?.key === selectionKey ? review.price : undefined, run };
}
