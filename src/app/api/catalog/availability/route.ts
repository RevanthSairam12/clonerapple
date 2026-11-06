import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/platform/api-guard';
import { getSql } from '@/lib/platform/db';
import { toPublicAvailability } from '@/lib/storefront/availability-rules';
import { readAvailabilityUsing } from '@/lib/storefront/availability-server';
import { requireStorefrontOpen } from '@/lib/storefront/maintenance-guard';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import { clientIpFromRequest } from '@/lib/platform/client-ip';

/**
 * Click-time availability.
 *
 * Called when a customer presses Add to Bag / Buy, so the button does not act
 * on a page rendered before stock changed (or before a sale went live). The
 * response is advisory: checkout and Pay re-check under the stock row lock.
 *
 * Same-origin and rate-limited because it is a public endpoint that reads the
 * stock table. Never cached: the whole point is the current value.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_IDS = 50;


export async function GET(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const closed = await requireStorefrontOpen();
  if (closed) return closed;

  const ip = clientIpFromRequest(request);
  const limited = ip ? checkRateLimit(`catalog-availability:${ip}`, {
    limit: 60,
    windowMs: 60_000,
  }) : null;
  if (limited && !limited.allowed) {
    return NextResponse.json(
      { error: 'Too many availability checks. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  const params = new URL(request.url).searchParams;
  let lines: import('@/lib/storefront/availability-rules').AvailabilityLine[] = [];
  if (params.has('lines')) {
    try {
      const value: unknown = JSON.parse(params.get('lines')!);
      if (!Array.isArray(value) || !value.length || value.length > MAX_IDS || !value.every((line) =>
        line && typeof line.productId === 'string' && line.productId.trim().length > 0 && line.productId.length <= 128 &&
        (line.variantId === undefined || (typeof line.variantId === 'string' && line.variantId.trim().length > 0 && line.variantId.length <= 256)) &&
        Number.isSafeInteger(line.quantity) && line.quantity > 0 && line.quantity <= 50)) throw new Error('Invalid lines');
      lines = value.map((line) => ({ productId: line.productId.trim(), variantId: line.variantId, quantity: line.quantity }));
    } catch {
      return NextResponse.json({ error: 'Invalid availability selection.' }, { status: 400 });
    }
  }
  const raw = params.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 128);

  if (ids.length === 0 && lines.length === 0) {
    return NextResponse.json({ error: 'Name at least one product id.' }, { status: 400 });
  }
  if (ids.length > MAX_IDS) {
    return NextResponse.json(
      { error: `Check at most ${MAX_IDS} products at a time.` },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!sql) {
    return NextResponse.json(
      { error: 'Availability is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const availability = await readAvailabilityUsing(sql, ids, lines);
    return NextResponse.json(toPublicAvailability(availability), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    console.warn('[catalog/availability] could not read stock');
    return NextResponse.json(
      { error: 'Availability is temporarily unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
