'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { nextSaleRefreshDelay, type SaleRefreshClock } from './client-quote';

/** Refresh server props, not the coupon endpoint. Unchanged quotes cause no validation. */
export function useCheckoutRefresh(clock?: SaleRefreshClock) {
  const router = useRouter();
  const lastRefresh = useRef(-Infinity);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible' || performance.now() - lastRefresh.current < 1000) return;
      lastRefresh.current = performance.now();
      router.refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    const interval = window.setInterval(refresh, 60_000);
    const delay = nextSaleRefreshDelay(clock);
    const boundary = delay === null ? null : window.setTimeout(refresh, delay);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      window.clearInterval(interval);
      if (boundary !== null) window.clearTimeout(boundary);
    };
  }, [router, clock?.enabled, clock?.databaseNow, clock?.startsAt, clock?.endsAt]);
}
