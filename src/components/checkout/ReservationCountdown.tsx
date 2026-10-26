'use client';

import { useEffect, useState } from 'react';

/**
 * A countdown for the stock reservation shown to the customer.
 *
 * The deadline is computed on the server, and only the remaining seconds are
 * handed to the browser. The browser cannot extend the hold by changing its
 * clock, and the database still owns the real expiry: when this reaches zero
 * the page says the reservation has ended and the next checkout is a new one.
 */
export function ReservationCountdown({
  seconds,
  label = 'Stock held for you',
}: {
  seconds: number;
  label?: string;
}) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.floor(seconds)));

  useEffect(() => {
    setRemaining(Math.max(0, Math.floor(seconds)));
    if (seconds <= 0) return;
    const deadline = Date.now() + seconds * 1000;
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  if (remaining <= 0) {
    return (
      <p className="text-sm font-medium text-amber-700" role="status">
        This reservation has ended. Start a new checkout to buy the item while stock lasts.
      </p>
    );
  }

  const minutes = Math.floor(remaining / 60);
  const secondsPart = remaining % 60;
  const display = `${minutes}:${String(secondsPart).padStart(2, '0')}`;

  return (
    <p className="text-sm text-[#1d1d1f]" role="timer" aria-live="polite">
      {label}: <span className="font-mono font-semibold">{display}</span>
      <span className="block text-xs text-[#86868b] mt-1">
        Stock is held only until this ends. Completing payment before then keeps the unit.
      </span>
    </p>
  );
}
