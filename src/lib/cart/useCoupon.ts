'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createQuoteGeneration, validTotals, type QuoteTotals } from '@/lib/checkout/client-quote';
import type { CouponFreeGiftPreview } from '@/lib/free-gifts/rules';

const STORAGE_KEY = 'gadzio_coupon_v1';

export function saveCouponCodeForCheckout(code: string): void {
  const clean = code.trim().toUpperCase();
  if (!clean) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, clean);
  } catch {
    /* Storage may be blocked. */
  }
}

export interface CouponCartLine {
  variantId?: string;
  productId?: string;
  id: string;
  quantity: number;
  unitPaise: number;
}
export interface AppliedCoupon extends QuoteTotals {
  code: string;
  freeGift?: CouponFreeGiftPreview | null;
  blockedByFreeGiftMessage?: string | null;
}
interface Args {
  items: CouponCartLine[];
  subtotalPaise: number;
  shippingPaise: number;
  /** Includes all policy fields, even when a change leaves today's shipping unchanged. */
  policySignature: string;
  email?: string;
  enabled: boolean;
}
export interface UseCouponResult {
  appliedCode: string | null;
  input: string;
  setInput: (value: string) => void;
  applied: AppliedCoupon | null;
  busy: boolean;
  message: string | null;
  isError: boolean;
  totals: QuoteTotals;
  apply: () => Promise<AppliedCoupon | null>;
  remove: () => void;
  revalidate: () => Promise<AppliedCoupon | null>;
}

export function useCoupon({ items, subtotalPaise, shippingPaise, policySignature, email = '', enabled }: Args): UseCouponResult {
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [input, setInputValue] = useState('');
  const [result, setResult] = useState<{ value: AppliedCoupon; ticket: ReturnType<ReturnType<typeof createQuoteGeneration>['capture']> } | null>(null);
  const [busyTicket, setBusyTicket] = useState<ReturnType<ReturnType<typeof createQuoteGeneration>['capture']> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const gate = useRef(createQuoteGeneration());
  const signature = JSON.stringify({ items, subtotalPaise, shippingPaise, policySignature, enabled, code: input.trim().toUpperCase() });
  // Invalidate before effects/debounce: no render may expose an old discount.
  gate.current.update(signature);
  const latest = useRef({ items, email, enabled, subtotalPaise });
  latest.current = { items, email, enabled, subtotalPaise };
  const lastValidated = useRef('');

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)?.trim().toUpperCase();
      if (stored) { setAppliedCode(stored); setInputValue(stored); }
    } catch { /* Storage may be blocked. */ }
    return () => gate.current.invalidate();
  }, []);

  const validate = useCallback(async (rawCode: string): Promise<AppliedCoupon | null> => {
    const code = rawCode.trim().toUpperCase();
    if (!code || !latest.current.enabled) {
      setMessage(!code ? 'Enter a coupon code.' : 'Checkout pricing is unavailable. Please try again.');
      setIsError(true);
      return null;
    }
    // All request inputs and the generation are captured together, never read
    // from new refs when the response returns.
    const captured = latest.current;
    const ticket = gate.current.capture();
    const request = ++requestId.current;
    setBusyTicket(ticket);
    setMessage(null);
    setIsError(false);
    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, email: captured.email.trim().toLowerCase(),
          items: captured.items.map((item) => ({ id: item.productId || item.id, variantId: item.variantId, quantity: item.quantity, expectedUnitPaise: item.unitPaise })) }),
      });
      const data = await response.json().catch(() => null);
      if (request !== requestId.current || !gate.current.current(ticket)) return null;
      if (!response.ok || !data?.valid || !validTotals(data) || data.subtotalPaise !== captured.subtotalPaise) {
        setResult(null);
        setMessage((data as { message?: string } | null)?.message || 'Prices or coupon availability changed. Review your order and try again.');
        setIsError(true);
        return null;
      }
      const rawObj = (data && typeof data === 'object' ? data : null) as Record<string, unknown> | null;
      const rawGift = (rawObj?.freeGift ?? null) as CouponFreeGiftPreview | null;
      const blockedByFreeGiftMessage =
        typeof rawObj?.blockedByFreeGiftMessage === 'string'
          ? rawObj.blockedByFreeGiftMessage
          : null;
      const next: AppliedCoupon = {
        code,
        subtotalPaise: data.subtotalPaise,
        discountPaise: data.discountPaise,
        shippingPaise: data.shippingPaise,
        totalPaise: data.totalPaise,
        freeGift: rawGift,
        blockedByFreeGiftMessage,
      };
      setResult({ value: next, ticket });
      setAppliedCode(code);
      lastValidated.current = ticket.signature;
      const responseMessage = (data as { message?: unknown } | null)?.message;
      setMessage(typeof responseMessage === 'string' ? responseMessage : null);
      try { window.localStorage.setItem(STORAGE_KEY, code); } catch { /* optional */ }
      return next;
    } catch {
      if (request !== requestId.current || !gate.current.current(ticket)) return null;
      setResult(null);
      setMessage('Coupons are temporarily unavailable. Remove the code to pay without it.');
      setIsError(true);
      return null;
    } finally {
      if (request === requestId.current && gate.current.current(ticket)) setBusyTicket(null);
    }
  }, []);
  const requestId = useRef(0);

  useEffect(() => {
    if (!enabled || !appliedCode || lastValidated.current === signature) return;
    const timer = window.setTimeout(() => { void validate(appliedCode); }, 500);
    return () => window.clearTimeout(timer);
  }, [enabled, appliedCode, signature, validate]);

  const remove = useCallback(() => {
    gate.current.invalidate();
    requestId.current += 1;
    lastValidated.current = '';
    setAppliedCode(null); setResult(null); setInputValue(''); setBusyTicket(null);
    setMessage(null); setIsError(false);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* optional */ }
  }, []);
  const setInput = useCallback((value: string) => {
    gate.current.invalidate();
    requestId.current += 1;
    lastValidated.current = '';
    setInputValue(value); setAppliedCode(null); setResult(null); setBusyTicket(null);
    setMessage(null); setIsError(false);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* optional */ }
  }, []);
  const apply = useCallback(() => validate(input), [input, validate]);
  const revalidate = useCallback(() => appliedCode ? validate(appliedCode) : Promise.resolve(null), [appliedCode, validate]);
  const applied = enabled && result && gate.current.current(result.ticket) ? result.value : null;
  const busy = Boolean(busyTicket && gate.current.current(busyTicket));
  const totals = applied ?? { subtotalPaise, discountPaise: 0, shippingPaise, totalPaise: subtotalPaise + shippingPaise };
  return { appliedCode, input, setInput, applied, busy, message, isError, totals, apply, remove, revalidate };
}
