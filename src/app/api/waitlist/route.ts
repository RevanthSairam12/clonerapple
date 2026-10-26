import { NextRequest, NextResponse } from 'next/server';

import { requireAccountSessionApi } from '@/lib/account/auth';
import { assertSameOrigin } from '@/lib/admin/api-guard';
import { checkRateLimit } from '@/lib/payu/rate-limit';
import {
  getWaitingListEntry,
  joinWaitingList,
  leaveWaitingList,
  listWaitingListForUser,
} from '@/lib/waitlist/store';

export const dynamic = 'force-dynamic';

function readProductId(request: NextRequest): string {
  return (request.nextUrl.searchParams.get('productId') ?? '').trim();
}

/**
 * The waiting list is per account. Every call requires a signed-in customer and
 * only ever reads or changes that customer's own entries.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const productId = readProductId(request);
  if (productId) {
    const entry = await getWaitingListEntry({ userId: auth.session.userId, productId });
    return NextResponse.json({ entry });
  }

  const entries = await listWaitingListForUser(auth.session.userId);
  return NextResponse.json({ entries });
}

export async function POST(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const limited = checkRateLimit(`waitlist-join:${auth.session.userId}`, {
    limit: 20,
    windowMs: 10 * 60 * 1000,
  });
  if (!limited.allowed) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
  if (!productId) {
    return NextResponse.json({ error: 'Choose a product first.' }, { status: 400 });
  }

  const result = await joinWaitingList({ userId: auth.session.userId, productId });
  if (!result.ok) {
    const status = result.reason === 'in-stock' ? 409 : result.reason === 'disabled' ? 403 : 404;
    return NextResponse.json({ error: result.message, reason: result.reason }, { status });
  }

  return NextResponse.json(
    {
      status: result.status,
      entryId: result.entryId,
      alreadyOnList: result.alreadyOnList,
      message: result.message,
    },
    { status: result.alreadyOnList ? 200 : 201 },
  );
}

export async function DELETE(request: NextRequest) {
  const originViolation = assertSameOrigin(request);
  if (originViolation) return originViolation;

  const auth = await requireAccountSessionApi();
  if (!auth.ok) return auth.response;

  const productId = readProductId(request);
  if (!productId) {
    return NextResponse.json({ error: 'Choose a product first.' }, { status: 400 });
  }

  const result = await leaveWaitingList({ userId: auth.session.userId, productId });
  if (!result.ok) {
    return NextResponse.json({ error: 'Could not leave the waiting list right now.' }, { status: 503 });
  }
  return NextResponse.json({ removed: result.removed });
}
