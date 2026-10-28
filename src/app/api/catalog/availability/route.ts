import { NextResponse } from 'next/server';

import { assertSameOrigin } from '@/lib/admin/api-guard';
import { getSql } from '@/lib/admin/db';
import { toPublicAvailability } from '@/lib/storefront/availability-rules';
import { readAvailabilityUsing } from '@/lib/storefront/availability-server';
import { checkRateLimit } from '@/lib/payu/rate-limit';

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

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip')?.trim() || '127.0.0.1';
}

export async function GET(request: Request) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const limited = checkRateLimit(`catalog-availability:${clientIp(request)}`, {
    limit: 60,
    windowMs: 60_000,
  });
  if (!limited.allowed) {
    return NextResponse.json(
      { error: 'Too many availability checks. Please try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } },
    );
  }

  const raw = new URL(request.url).searchParams.get('ids') ?? '';
  const ids = raw
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0 && id.length <= 128);

  if (ids.length === 0) {
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
    const availability = await readAvailabilityUsing(sql, ids);
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
