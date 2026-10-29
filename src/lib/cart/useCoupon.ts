'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Client state for one applied coupon code.
 *
 * Only the code is persisted. The discount is never trusted from storage: it
 * is re-checked against `/api/coupons/validate` on load and whenever the cart
 * changes, and checked again right before Pay. If the server says no, the
 * discount disappears and the customer sees a message — the displayed total
 * and the charged total come from the same server rules.
 *
 * Validation calls are limited to cart changes (debounced) and an explicit
 * apply/Pay, never to keystrokes, because the endpoint rate-limits by IP and
 * account.
 */

const STORAGE_KEY = 'gadzio_coupon_v1';

export interface CouponCartLine {
  productId?: string;
  id: string;
  quantity: number;
  price: number;
}

export interface AppliedCoupon {
  code: string;
  subtotalPaise: number;
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
}

interface Args {
  items: CouponCartLine[];
  subtotalPaise: number;
  shippingPaise: number;
  email?: string;
  /** False while the cart is still hydrating or empty. */
  enabled: boolean;
}

interface CouponTotals {
  discountPaise: number;
  shippingPaise: number;
  totalPaise: number;
}

export interface UseCouponResult {
  /** The code that was accepted, or null. */
  appliedCode: string | null;
  /** What is typed in the box. */
  input: string;
  setInput: (value: string) => void;
  applied: AppliedCoupon | null;
  busy: boolean;
  message: string | null;
  isError: boolean;
  /** Totals after the applied coupon; equal to the inputs when none is set. */
  totals: CouponTotals;
  apply: () => Promise<AppliedCoupon | null>;
  remove: () => void;
  /** Called at Pay with the current cart and typed email. */
  revalidate: () => Promise<AppliedCoupon | null>;
}

interface ValidateResponse {
  valid?: boolean;
  code?: string;
  subtotalPaise?: number;
  discountPaise?: number;
  shippingPaise?: number;
  totalPaise?: number;
  message?: string;
}

function cartPayload(items: CouponCartLine[]) {
  return items.map((item) => ({
    id: item.productId || item.id,
    quantity: item.quantity,
    expectedUnitPaise: Math.round(item.price * 100),
  }));
}

function signatureOf(items: CouponCartLine[]): string {
  return items
    .map((item) => `${item.productId || item.id}:${item.quantity}:${Math.round(item.price * 100)}`)
    .join('|');
}

export function useCoupon({ items, subtotalPaise, shippingPaise, email = '', enabled }: Args): UseCouponResult {
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [applied, setApplied] = useState<AppliedCoupon | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  const emailRef = useRef(email);
  emailRef.current = email;
  const requestId = useRef(0);
  /** The last code+cart that a successful validation already covered. */
  const lastValidated = useRef('');

  // Restore the last accepted code, never its discount.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored && stored.trim()) {
        const code = stored.trim().toUpperCase();
        setAppliedCode(code);
        setInput(code);
      }
    } catch {
      // storage blocked
    }
  }, []);

  const validate = useCallback(
    async (rawCode: string, remember: boolean): Promise<AppliedCoupon | null> => {
      const code = rawCode.trim().toUpperCase();
      if (!code) {
        setMessage('Enter a coupon code.');
        setIsError(true);
        return null;
      }

      const id = requestId.current + 1;
      requestId.current = id;
      setBusy(true);
      setMessage(null);
      setIsError(false);

      try {
        const response = await fetch('/api/coupons/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code,
            items: cartPayload(itemsRef.current),
            email: emailRef.current.trim().toLowerCase(),
          }),
        });
        const data = (await response.json().catch(() => null)) as ValidateResponse | null;

        // A newer request has been made; drop this answer.
        if (id !== requestId.current) return null;

        if (!response.ok || !data?.valid) {
          setApplied(null);
          setMessage(data?.message || 'This code is not valid for your cart.');
          setIsError(true);
          return null;
        }

        const next: AppliedCoupon = {
          code: data.code || code,
          subtotalPaise: Number(data.subtotalPaise) || 0,
          discountPaise: Number(data.discountPaise) || 0,
          shippingPaise: Number(data.shippingPaise) || 0,
          totalPaise: Number(data.totalPaise) || 0,
        };
        setApplied(next);
        setAppliedCode(next.code);
        setInput(next.code);
        lastValidated.current = `${next.code}|${signatureOf(itemsRef.current)}`;
        setMessage(data.message || null);
        setIsError(false);
        if (remember) {
          try {
            window.localStorage.setItem(STORAGE_KEY, next.code);
          } catch {
            // storage blocked; the code still works for this page
          }
        }
        return next;
      } catch {
        if (id !== requestId.current) return null;
        setApplied(null);
        setMessage('Coupons are temporarily unavailable. You can still pay without the code.');
        setIsError(true);
        return null;
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    },
    [],
  );

  // Re-check when the cart changes. The email is read from a ref so typing it
  // does not spend the validation rate limit.
  const signature = signatureOf(items);

  useEffect(() => {
    if (!enabled) return;
    if (!appliedCode) return;
    if (itemsRef.current.length === 0) {
      setApplied(null);
      lastValidated.current = '';
      return;
    }
    if (lastValidated.current === `${appliedCode}|${signature}`) return;
    const timer = window.setTimeout(() => {
      void validate(appliedCode, true);
    }, 500);
    return () => window.clearTimeout(timer);
    // `signature` is the cart shape; `appliedCode` changes only on apply/remove.
  }, [enabled, appliedCode, signature, validate]);

  const apply = useCallback(async () => {
    const result = await validate(input, true);
    if (!result) {
      // A rejected code is never kept: the next page must not show a discount
      // the server has refused.
      setAppliedCode(null);
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    return result;
  }, [input, validate]);

  const remove = useCallback(() => {
    requestId.current += 1;
    lastValidated.current = '';
    setAppliedCode(null);
    setApplied(null);
    setInput('');
    setMessage(null);
    setIsError(false);
    setBusy(false);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const revalidate = useCallback(async () => {
    if (!appliedCode) return null;
    return validate(appliedCode, true);
  }, [appliedCode, validate]);

  const totals: CouponTotals = applied
    ? {
        discountPaise: applied.discountPaise,
        shippingPaise: applied.shippingPaise,
        totalPaise: applied.totalPaise,
      }
    : { discountPaise: 0, shippingPaise, totalPaise: subtotalPaise + shippingPaise };

  return {
    appliedCode,
    input,
    setInput,
    applied,
    busy,
    message,
    isError,
    totals,
    apply,
    remove,
    revalidate,
  };
}
