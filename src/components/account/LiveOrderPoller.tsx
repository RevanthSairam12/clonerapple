'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import {
  liveSignature,
  shouldPollAccountOrder,
  type AccountOrderLiveStatus,
  type AccountOrderStatus,
} from '@/lib/account/order-live';

export const LIVE_ORDER_POLL_MS = 30_000;

export interface LiveOrderPollerProps {
  txnid: string;
  /** The status the server rendered. The first poll compares against this. */
  initialStatus: AccountOrderStatus;
}

/**
 * Keeps an in-flight order fresh: a no-store read every 30 seconds while the
 * tab is visible, immediately on tab focus or when it becomes visible again,
 * and never once the order reaches a final state.
 *
 * The first read only decides "is the rendered status still true?"; later
 * reads compare the full customer-visible signature (status, delivery,
 * requests, refunds). A change re-renders the server components through
 * `router.refresh()` so the timeline and buttons re-read the database without
 * a manual reload.
 */
export function LiveOrderPoller({ txnid, initialStatus }: LiveOrderPollerProps) {
  const router = useRouter();
  const statusRef = useRef<AccountOrderStatus>(initialStatus);
  const signatureRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    if (!shouldPollAccountOrder(statusRef.current, document.visibilityState)) return;
    try {
      const response = await fetch(
        `/api/account/orders/${encodeURIComponent(txnid)}/live`,
        { cache: 'no-store' },
      );
      if (!response.ok) return;
      const body = await response.json().catch(() => null);
      const next = body?.order as AccountOrderLiveStatus | undefined;
      if (!next || next.txnid !== txnid) return;

      const previousSignature = signatureRef.current;
      const statusChanged = next.status !== statusRef.current;
      const signatureChanged =
        previousSignature !== null && previousSignature !== liveSignature(next);

      statusRef.current = next.status;
      signatureRef.current = liveSignature(next);

      if (statusChanged || signatureChanged) router.refresh();
    } catch {
      // A failed poll keeps the last known state; the next tick retries.
    }
  }, [txnid, router]);

  useEffect(() => {
    // A different order (or a fresh server render) resets the comparison.
    statusRef.current = initialStatus;
    signatureRef.current = null;
    void poll();
  }, [txnid, initialStatus, poll]);

  useEffect(() => {
    const timer = window.setInterval(() => void poll(), LIVE_ORDER_POLL_MS);
    const onWake = () => void poll();
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [poll]);

  return null;
}