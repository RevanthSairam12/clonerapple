'use client';

import { priceCartLines, type PriceRef } from '@/lib/checkout/client-quote';
import { verifyAvailabilityLines } from './use-availability';
import type { AvailabilityLine } from './availability-rules';

export interface SelectionPrice {
  price: number;
  priceDisplay: string;
  regularPrice?: number;
  wasPriceDisplay?: string;
}
export type SelectionResult =
  | { status: 'ready'; prices: SelectionPrice[] }
  | { status: 'unavailable' | 'verification_failed' | 'stale'; message: string };

export function selectionPrice(unitPaise: number, regularPaise?: number | null): SelectionPrice {
  const price = unitPaise / 100;
  const regularPrice = regularPaise && regularPaise > unitPaise ? regularPaise / 100 : undefined;
  return { price, priceDisplay: `₹${price.toLocaleString('en-IN')}`, regularPrice,
    wasPriceDisplay: regularPrice === undefined ? undefined : `₹${regularPrice.toLocaleString('en-IN')}` };
}

/** Fresh advisory prices + quantity checks. Only transactional checkout reserves units. */
export async function verifySelections(lines: AvailabilityLine[], signal?: AbortSignal): Promise<SelectionResult> {
  if (signal?.aborted) return { status: 'stale', message: 'Selection changed. Please try again.' };
  if (!lines.length || lines.length > 50 || lines.some(line => !line.productId ||
    (line.variantId !== undefined && (typeof line.variantId !== 'string' || !line.variantId.trim() || line.variantId.length > 256)) ||
    !Number.isSafeInteger(line.quantity) || line.quantity < 1 || line.quantity > 50)) {
    return { status: 'unavailable', message: 'Review your bag quantities (1–50 per line).' };
  }
  try {
    const response = await fetch('/api/catalog/summary?fresh=1', { cache: 'no-store', signal });
    if (!response.ok) throw new Error('Catalogue unavailable');
    const body = await response.json();
    if (body.source !== 'db' || typeof body.saleLive !== 'boolean' || !Array.isArray(body.products)) throw new Error('Invalid catalogue');
    const priced = priceCartLines(lines.map(line => ({ ...line, id: line.productId })), body.products as PriceRef[], body.saleLive);
    if (priced.some(line => !line.available)) return { status: 'unavailable', message: 'This selection is no longer available. Choose options again.' };
    const valid = await verifyAvailabilityLines(lines);
    if (signal?.aborted) return { status: 'stale', message: 'Selection changed. Please try again.' };
    if (valid !== true) return { status: valid === false ? 'unavailable' : 'verification_failed',
      message: valid === false ? 'Stock not available for the requested quantity.' : 'Could not verify stock. Please try again.' };
    return { status: 'ready', prices: priced.map(line => selectionPrice(line.unitPaise, line.regularPrice ? Math.round(line.regularPrice * 100) : null)) };
  } catch {
    return { status: signal?.aborted ? 'stale' : 'verification_failed', message: signal?.aborted ? 'Selection changed. Please try again.' : 'Could not verify current pricing. Please try again.' };
  }
}

export function priceNeedsReview(offered: Pick<SelectionPrice, 'price' | 'regularPrice'>, current: SelectionPrice): boolean {
  return !Number.isFinite(offered.price) || Math.round(offered.price * 100) !== Math.round(current.price * 100) ||
    (offered.regularPrice ?? null) !== (current.regularPrice ?? null);
}
